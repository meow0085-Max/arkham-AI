# 在 Vercel 上部署 Arkham AI

按下面步骤即可把项目部署到 Vercel，获得一个在线可访问的网址。

---

## 第一步：把代码推到 GitHub

若还没推过，在项目目录执行（路径、用户名、仓库名按你的改）：

```bash
cd C:\Users\25592\Desktop\arkhum-ai
git add .
git commit -m "支持 Vercel 部署"
git push
```

---

## 第二步：用 Vercel 导入 GitHub 仓库

1. 打开 https://vercel.com 并登录（可用 GitHub 账号）。
2. 点击 **Add New…** → **Project**。
3. 在 **Import Git Repository** 里选择你的 **arkhum-AI**（或你实际仓库名），点 **Import**。
4. **Root Directory** 保持默认（不要改）。
5. **Framework Preset** 选 **Other**（或不选）。
6. 不要改 **Build and Output Settings**，直接点 **Deploy**。

等一两分钟，部署完成后会给你一个地址，例如：`https://arkhum-ai-xxx.vercel.app`。

---

## 第三步：配置环境变量（API 密钥）

部署成功后，守秘人要能调用 AI 需要配置密钥：

1. 在 Vercel 里打开你的项目，顶部点 **Settings** → 左侧 **Environment Variables**。
2. 添加变量（二选一或都填）：
   - **Name**：`GEMINI_API_KEY`，**Value**：你的 Gemini API Key。
   - **Name**：`DEEPSEEK_API_KEY`，**Value**：你的 DeepSeek API Key（若用 DeepSeek，优先于 Gemini）。
3. 每个变量勾选 **Production**（以及 **Preview** 若需要），点 **Save**。
4. 回到 **Deployments**，最新一次部署右侧点 **⋯** → **Redeploy**，让新环境变量生效。

---

## 第四步：访问站点

- 首页（跑团前端）：`https://你的项目名.vercel.app/` 或 `https://你的项目名.vercel.app/app.html`。
- 健康检查：`https://你的项目名.vercel.app/api/health`，能返回 `{"ok":true,...}` 说明后端正常。

在首页打开跑团大厅，即可在线跑团（需已配置 GEMINI 或 DEEPSEEK 密钥）。

---

## 注意事项

- **角色卡存储**：Vercel 为无状态 Serverless，角色卡保存在本地文件里，**部署环境下不会持久化**，刷新或重新部署后可能丢失。跑团对话、守秘人、模组解析等功能正常。
- **密钥安全**：不要在前端代码或仓库里写 API Key，只在 Vercel 的 Environment Variables 里配置。
- 之后每次往 GitHub 推送代码，Vercel 会自动重新部署。

完成以上步骤后，你的 Arkham AI 就已在 Vercel 上运行。
