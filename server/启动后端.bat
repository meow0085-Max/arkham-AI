@echo off
chcp 65001 >nul

REM 切换到本 bat 所在目录（server 文件夹）
cd /d "%~dp0"

if not exist "package.json" (
  echo 错误：当前目录下没有 package.json，请确认本脚本在 server 文件夹内运行。
  pause
  exit /b 1
)

echo 正在检查并安装依赖...
call npm install
if errorlevel 1 (
  echo.
  echo 安装失败，请确认已安装 Node.js 并在本目录重试。
  pause
  exit /b 1
)

echo.
echo 正在启动 Arkham AI 后端...
echo 守秘人功能需配置 GEMINI_API_KEY：在 server 目录新建 .env 文件，内容写 GEMINI_API_KEY=你的密钥
echo 按 Ctrl+C 可停止服务。
echo.
node index.js
pause
