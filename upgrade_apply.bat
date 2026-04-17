@echo off
chcp 65001 >nul
title 即梦 - 应用升级包

set "UPGRADE_DIR=%~dp0"
set "PAYLOAD_DIR=%UPGRADE_DIR%payload"
set "TARGET_DIR=%~1"

echo ============================================
echo   即梦 OpenAI 调度服务 - 应用升级包
echo ============================================
echo.

if not exist "%PAYLOAD_DIR%" (
    echo [错误] 未找到 payload 目录，请不要单独移动 upgrade_apply.bat
    pause
    exit /b 1
)

if "%TARGET_DIR%"=="" (
    echo 请输入服务器安装目录路径，例如: E:\jimeng-deploy
    set /p TARGET_DIR=安装目录: 
)

:: 清理输入：去掉首尾引号和结尾空格
set "TARGET_DIR=%TARGET_DIR:"=%"
if "%TARGET_DIR:~-1%"==" " set "TARGET_DIR=%TARGET_DIR:~0,-1%"

if "%TARGET_DIR%"=="" (
    echo [错误] 安装目录不能为空
    pause
    exit /b 1
)

if not exist "%TARGET_DIR%" (
    echo [错误] 目标目录不存在: %TARGET_DIR%
    pause
    exit /b 1
)

if not exist "%TARGET_DIR%\package.json" (
    echo [错误] 目标目录看起来不是 jimeng 安装目录（缺少 package.json）
    pause
    exit /b 1
)

echo.
echo [!] 请先停止正在运行的服务，再继续。
pause

echo [→] 覆盖程序文件（不会碰 data 目录）...
if exist "%PAYLOAD_DIR%\dist" robocopy "%PAYLOAD_DIR%\dist" "%TARGET_DIR%\dist" /e /njh /njs /ndl >nul
if exist "%PAYLOAD_DIR%\frontend\dist" robocopy "%PAYLOAD_DIR%\frontend\dist" "%TARGET_DIR%\frontend\dist" /e /njh /njs /ndl >nul
if exist "%PAYLOAD_DIR%\prisma" robocopy "%PAYLOAD_DIR%\prisma" "%TARGET_DIR%\prisma" /e /njh /njs /ndl >nul
if exist "%PAYLOAD_DIR%\bin" robocopy "%PAYLOAD_DIR%\bin" "%TARGET_DIR%\bin" /e /njh /njs /ndl >nul

if exist "%PAYLOAD_DIR%\package.json" copy /y "%PAYLOAD_DIR%\package.json" "%TARGET_DIR%\package.json" >nul
if exist "%PAYLOAD_DIR%\package-lock.json" copy /y "%PAYLOAD_DIR%\package-lock.json" "%TARGET_DIR%\package-lock.json" >nul
if exist "%PAYLOAD_DIR%\start.bat" copy /y "%PAYLOAD_DIR%\start.bat" "%TARGET_DIR%\start.bat" >nul
if exist "%PAYLOAD_DIR%\test_client.html" copy /y "%PAYLOAD_DIR%\test_client.html" "%TARGET_DIR%\test_client.html" >nul
if exist "%PAYLOAD_DIR%\docs" robocopy "%PAYLOAD_DIR%\docs" "%TARGET_DIR%\docs" /e /njh /njs /ndl >nul

echo [→] 更新运行依赖...
cd /d "%TARGET_DIR%"
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo [错误] 依赖更新失败
    pause
    exit /b 1
)

echo [→] 执行数据库迁移（只升级结构，不覆盖数据）...
call node_modules\.bin\prisma migrate deploy
if %errorlevel% neq 0 (
    echo [错误] 数据库迁移失败，请手动检查后再启动
    pause
    exit /b 1
)

echo [→] 重新生成 Prisma 客户端（同步新字段定义）...
call node_modules\.bin\prisma generate
if %errorlevel% neq 0 (
    echo [错误] Prisma 客户端生成失败
    pause
    exit /b 1
)

echo.
echo [✓] 升级完成
echo [✓] 未覆盖 data 目录和 jimeng.db
echo [→] 现在可到 %TARGET_DIR% 运行 start.bat 启动服务
pause