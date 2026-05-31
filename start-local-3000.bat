@echo off
chcp 65001 >nul
title Jimeng OpenAI Hub - Fresh
cd /d "%~dp0"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "ALL_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=127.0.0.1,localhost"
set "HOST=0.0.0.0"
set "PORT=3000"
echo [%date% %time%] starting on %HOST%:%PORT% >> server.out.log
node dist/index.js >> server.out.log 2>> server.err.log
pause
