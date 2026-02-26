const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { saveInvestigator, getInvestigator } = require("./db");

// 从 server 目录下的 .env 文件读取环境变量（本地开发用；Vercel 上在项目设置里填环境变量）
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  });
}

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const KEEPER_MODEL = "gemini-2.0-flash";
const USE_DEEPSEEK = !!DEEPSEEK_API_KEY;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// 静态页面（本地用；Vercel 会单独托管前端）
app.use(express.static(path.join(__dirname, "..")));

// 健康检查：前端可请求此接口判断后端是否已启动
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Arkham AI 后端运行中" });
});

// 内置模组：返回 server/modules/builtin.txt 的文本，供打开跑团大厅时自动加载
const BUILTIN_MODULE_PATH = path.join(__dirname, "modules", "builtin.txt");
app.get("/api/keeper/builtin-module", (req, res) => {
  try {
    if (!fs.existsSync(BUILTIN_MODULE_PATH)) {
      return res.json({ ok: true, moduleText: "" });
    }
    const moduleText = fs.readFileSync(BUILTIN_MODULE_PATH, "utf8").trim();
    return res.json({ ok: true, moduleText: moduleText || "" });
  } catch (e) {
    console.error("GET /api/keeper/builtin-module", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ---------- 守秘人 API：支持 DeepSeek（优先）或 Gemini ----------
async function callDeepSeek(messages) {
  if (!DEEPSEEK_API_KEY) throw new Error("未配置 DEEPSEEK_API_KEY");
  const url = "https://api.deepseek.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.75,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || "DeepSeek API 请求失败");
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (content == null) throw new Error("DeepSeek 未返回有效内容");
  return String(content).trim();
}

async function callGemini(payload) {
  if (!GEMINI_API_KEY) throw new Error("未配置 GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${KEEPER_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Gemini API 请求失败");
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.[0]) throw new Error("Gemini 未返回有效内容");
  return candidate.content.parts[0].text || "";
}

// 属性中文名/英文名 → 角色卡 attributes 键（STR/CON/INT 等）
const ATTR_NAME_TO_KEY = {
  力量: "STR", 体质: "CON", 体型: "SIZ", 敏捷: "DEX", 外貌: "APP", 智力: "INT", 意志: "POW", 教育: "EDU",
  灵感: "INT",  // CoC 7 版灵感检定 = 智力
  STR: "STR", CON: "CON", SIZ: "SIZ", DEX: "DEX", APP: "APP", INT: "INT", POW: "POW", EDU: "EDU",
};
// 技能名别名：AI 可能用不同用词，统一到角色卡里的技能名
const SKILL_NAME_ALIAS = { 侦察: "侦查" };

function getSkillTotal(character, name) {
  const skills = character.skills || {};
  const key = SKILL_NAME_ALIAS[name] || name;
  const skill = skills[key];
  if (!skill) return null;
  if (skill.total !== undefined && skill.total !== null && !Number.isNaN(Number(skill.total)))
    return Math.max(0, parseInt(skill.total, 10) || 0);
  const occ = parseInt(skill.occ, 10) || 0;
  const interest = parseInt(skill.interest, 10) || 0;
  return occ + interest;
}

function getCheckValue(character, name) {
  const key = ATTR_NAME_TO_KEY[name];
  if (key && character.attributes && character.attributes[key]) {
    const v = character.attributes[key].value;
    return typeof v === "number" ? v : parseInt(v, 10) || 0;
  }
  const total = getSkillTotal(character, name);
  if (total !== null) return total;
  return 0;
}

function getCheckHalfAndFifth(character, name) {
  const key = ATTR_NAME_TO_KEY[name];
  if (key && character.attributes && character.attributes[key]) {
    return { half: character.attributes[key].half, fifth: character.attributes[key].fifth };
  }
  const val = getCheckValue(character, name);
  return { half: Math.floor(val / 2), fifth: Math.floor(val / 5) };
}

/** 将 AI 回复中的检定块替换为实际骰值 + 成功/失败对应的叙事（CoC 7th） */
function processCheckRolls(text, character) {
  if (!text || typeof text !== "string") return text;
  // 先处理「检定 + 成功后/失败后」整块；再处理仅【检定：名】的遗留
  const blockRe = /【检定：([^】]+)】\s*([\s\S]*?)(?=【检定：|$)/g;
  let out = text.replace(blockRe, (block, name, rest) => {
    const n = String(name).trim();
    const value = getCheckValue(character, n);
    const roll = Math.floor(Math.random() * 100) + 1;
    const { half, fifth } = getCheckHalfAndFifth(character, n);
    let result = "失败";
    if (roll <= value) {
      if (roll <= fifth && fifth > 0) result = "极难成功";
      else if (roll <= half && half > 0) result = "困难成功";
      else result = "成功";
    }
    const header = `${n}检定：${roll}/${value}，${result}\n`;
    const isSuccess = result !== "失败";
    let desc = "";
    const successM = rest.match(/【成功后】：\s*([\s\S]*?)(?=【失败后】：|$)/);
    const failM = rest.match(/【失败后】：\s*([\s\S]*?)(?=【检定：|$)/);
    if (isSuccess && successM && successM[1]) desc = successM[1].trim().replace(/\n+/g, " ");
    else if (!isSuccess && failM && failM[1]) desc = failM[1].trim().replace(/\n+/g, " ");
    return desc ? header + desc : header;
  });
  return out;
}

// 守秘人对话：角色卡 + 模组 + 历史 + 本条用户消息 → AI 回复
app.post("/api/keeper/chat", async (req, res) => {
  const { character = {}, moduleContext = "", chatHistory = [], userMessage = "" } = req.body || {};
  if (typeof userMessage !== "string") {
    return res.status(400).json({ ok: false, error: "需要 userMessage" });
  }
  const systemInstruction =
    "你现在是《克苏鲁的呼唤》(CoC 7th) 的守秘人 (KP)。你必须严格遵循以下模组逻辑进行带团。\n\n" +
    "--- 模组大纲 ---\n" +
    (moduleContext || "（暂无模组，请自由发挥阴郁神秘氛围。）") +
    "\n\n--- 当前调查员状态（用于数值检定：属性见 value/half/fifth，技能检定值 = occ+interest）---\n" +
    JSON.stringify(character, null, 2) +
    "\n\n要求：1. 保持阴郁、神秘的叙事风格。2. 当需要进行属性或技能检定时，请按以下格式输出（不要自己掷骰或写数值）：先写一行【检定：属性或技能名】，例如【检定：智力】【检定：侦查】；紧接着写【成功后】：后面跟检定成功时的具体结果描述（结合模组与 CoC 7 版规则）；再写【失败后】：后面跟检定失败时的具体结果描述。示例：\n【检定：侦查】\n【成功后】：你敏锐地注意到门缝下有尚未干涸的血迹。\n【失败后】：你扫过昏暗的走廊，并未发现明显异常。\n系统会按规则自动掷骰并只保留成功或失败对应的描述。3. 不要跳戏，始终保持在角色扮演状态。";
  try {
    if (USE_DEEPSEEK) {
      const messages = [{ role: "system", content: systemInstruction }];
      const history = (Array.isArray(chatHistory) ? chatHistory : [])
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content ?? m.text ?? "") }))
        .filter((m) => m.content);
      if (history.length > 0 && history[0].role === "assistant") {
        messages.push({ role: "user", content: "【跑团开始，请根据模组与调查员信息进行开场或等待玩家行动。】" });
      }
      messages.push(...history, { role: "user", content: userMessage });
      let lastErr;
      for (let retries = 5, delay = 1000; retries > 0; retries--, delay *= 2) {
        try {
          const rawText = await callDeepSeek(messages);
          const text = processCheckRolls(rawText, character);
          return res.json({ ok: true, text });
        } catch (e) {
          lastErr = e;
          if (retries > 1) await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastErr;
    }
    const contents = (Array.isArray(chatHistory) ? chatHistory : [])
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: String(m.content ?? m.text ?? "") }],
      }))
      .filter((m) => m.parts[0].text);
    contents.push({ role: "user", parts: [{ text: userMessage }] });
    if (contents.length > 0 && contents[0].role === "model") {
      contents.unshift({
        role: "user",
        parts: [{ text: "【跑团开始，请根据模组与调查员信息进行开场或等待玩家行动。】" }],
      });
    }
    let lastErr;
    for (let retries = 5, delay = 1000; retries > 0; retries--, delay *= 2) {
      try {
        const rawText = await callGemini({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.75, topP: 0.9, maxOutputTokens: 1024 },
        });
        const text = processCheckRolls(rawText, character);
        return res.json({ ok: true, text });
      } catch (e) {
        lastErr = e;
        if (retries > 1) await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  } catch (e) {
    console.error("POST /api/keeper/chat", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// 导入文案：根据模组 + 调查员背景生成简短开场
app.post("/api/keeper/intro", async (req, res) => {
  const { character = {}, moduleContext = "" } = req.body || {};
  if (!moduleContext || typeof moduleContext !== "string") {
    return res.status(400).json({ ok: false, error: "需要 moduleContext" });
  }
  const prompt =
    "请根据以下模组内容与调查员背景，写一段简短的跑团导入/开场文案（2～4 句话即可），阴郁神秘风格，用于《克苏鲁的呼唤》开场。只输出这段导入文案，不要加标题或说明。\n\n--- 模组内容（节选） ---\n" +
    (moduleContext.slice(0, 4000) || "（无）") +
    "\n\n--- 调查员背景 ---\n" +
    (character.background || character.name ? `姓名：${character.name || "未知"}；职业：${character.occupation || "未知"}；背景：${character.background || "（未填写）"}` : "（暂无调查员）");
  try {
    if (USE_DEEPSEEK) {
      const text = await callDeepSeek([
        { role: "system", content: "你是《克苏鲁的呼唤》守秘人，擅长写简短、有氛围的开场白。" },
        { role: "user", content: prompt },
      ]);
      return res.json({ ok: true, text: text || "" });
    }
    const text = await callGemini({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 512 },
    });
    return res.json({ ok: true, text: text || "" });
  } catch (e) {
    console.error("POST /api/keeper/intro", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// 模组 PDF 解析：JSON(pdfBase64) 或 multipart(file) → AI 提取大纲
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single("file");

app.post("/api/keeper/parse-module", (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.indexOf("multipart/form-data") !== -1) {
    uploadPdf(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message || "文件上传失败" });
      next();
    });
  } else {
    next();
  }
}, async (req, res) => {
  if (USE_DEEPSEEK) {
    return res.status(400).json({
      ok: false,
      error: "当前使用 DeepSeek，暂不支持 PDF 解析。请上传 .txt 或 .md 模组文件（跑团大厅左侧「上传模组」支持文本格式）。",
    });
  }
  let base64 = null;
  if (req.file?.buffer) {
    base64 = req.file.buffer.toString("base64");
  } else if (req.body?.pdfBase64 && typeof req.body.pdfBase64 === "string") {
    base64 = req.body.pdfBase64;
  }
  if (!base64) {
    return res.status(400).json({ ok: false, error: "请上传 PDF 文件或提供 pdfBase64" });
  }
  try {
    const prompt =
      "请阅读附件中的跑团模组 PDF，提取或总结其关键内容：场景、NPC、线索、规则要点、关键剧情等，用中文输出一份简洁的模组大纲（可直接用于守秘人带团参考）。只输出大纲文本，不要加标题或说明。";
    const text = await callGemini({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "application/pdf", data: base64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    });
    return res.json({ ok: true, moduleText: text || "" });
  } catch (e) {
    console.error("POST /api/keeper/parse-module", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post("/api/investigator", (req, res) => {
  const { clientId, data } = req.body || {};
  if (!clientId || typeof data !== "object") {
    return res
      .status(400)
      .json({ ok: false, error: "需要 clientId 与 data" });
  }
  try {
    saveInvestigator(clientId, data);
    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/investigator", e);
    return res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.get("/api/investigator", (req, res) => {
  const clientId = req.query.clientId;
  if (!clientId) {
    return res
      .status(400)
      .json({ ok: false, error: "需要查询参数 clientId" });
  }
  try {
    const raw = getInvestigator(clientId);
    if (!raw) {
      return res.status(404).json({ ok: false, data: null });
    }
    return res.json({ ok: true, data: JSON.parse(raw) });
  } catch (e) {
    console.error("GET /api/investigator", e);
    return res.status(500).json({ ok: false, error: String(e.message) });
  }
});

module.exports = app;
