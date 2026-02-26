const app = require("./app");
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const USE_DEEPSEEK = !!DEEPSEEK_API_KEY;

app.listen(PORT, () => {
  console.log(`Arkham AI 后端已启动: http://localhost:${PORT}`);
  console.log(`角色卡: POST/GET /api/investigator | 守秘人: POST /api/keeper/chat, POST /api/keeper/parse-module`);
  if (USE_DEEPSEEK) {
    console.log("当前使用 DeepSeek 作为守秘人（.env 中 DEEPSEEK_API_KEY 已配置）。PDF 解析仅支持 Gemini，请用 .txt/.md 上传模组。");
  } else if (GEMINI_API_KEY) {
    console.log("当前使用 Gemini 作为守秘人。");
  } else {
    console.warn("未设置 DEEPSEEK_API_KEY 或 GEMINI_API_KEY，守秘人将报错。请在 .env 中配置其一。");
  }
});
