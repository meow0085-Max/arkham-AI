# Arkham AI 后端

角色卡与跑团数据保存在 SQLite 数据库中，供跑团大厅读取。

## 使用方式

1. 在 `server` 目录下安装依赖并启动：

```bash
cd server
npm install
npm start
```

2. 后端默认运行在 **http://localhost:3000**。  
   - 角色卡建立页保存时会 **POST** 到 `/api/investigator` 写入数据库。  
   - 跑团大厅打开时会 **GET** `/api/investigator?clientId=xxx` 拉取当前设备的角色卡。

3. 同一浏览器通过 `clientId`（存在 localStorage 的 `arkham-ai-client-id`）区分，因此「本机保存的角色卡」会在跑团大厅自动显示。未启动后端时，两页仍会使用本地 localStorage，仅无法跨设备同步。

## API

- **POST /api/investigator**  
  Body: `{ "clientId": "字符串", "data": 角色卡对象 }`  
  将角色卡写入/更新到数据库。

- **GET /api/investigator?clientId=xxx**  
  按 `clientId` 读取最新角色卡，返回 `{ "ok": true, "data": 角色卡对象 }`，不存在时为 404。

## 数据库

- 文件：`server/arkham.db`（SQLite）  
- 表：`investigators (client_id, data, updated_at)`
