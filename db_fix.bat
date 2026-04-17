@echo off
chcp 65001 >nul
title 即梦 - 数据库结构修复

echo ============================================
echo   即梦 - 数据库迁移 + Prisma 客户端修复
echo ============================================
echo.
echo 脚本将在以下目录执行:
echo %~dp0
echo.
echo 请确认这是 jimeng 安装目录，然后按任意键继续...
pause >nul

cd /d "%~dp0"

:: 检测 prisma 位置（Windows 用 .cmd，Linux/Mac 无后缀）
set "PRISMA_BIN="
if exist "node_modules\.bin\prisma.cmd" set "PRISMA_BIN=node_modules\.bin\prisma.cmd"
if "%PRISMA_BIN%"=="" if exist "node_modules\.bin\prisma" set "PRISMA_BIN=node_modules\.bin\prisma"
if "%PRISMA_BIN%"=="" (
    echo [错误] 未找到 prisma 可执行文件
    echo        请确认脚本放在 jimeng 安装目录根目录下
    pause
    exit /b 1
)
echo [i] 使用 prisma: %PRISMA_BIN%

echo.
echo [1/2] 执行数据库迁移（只新增字段，不删数据）...
call "%PRISMA_BIN%" migrate deploy
if %errorlevel% neq 0 (
    echo [错误] 数据库迁移失败，错误码: %errorlevel%
    pause
    exit /b 1
)
echo [✓] 数据库迁移完成

echo.
echo [2/2] 重新生成 Prisma 客户端...
call "%PRISMA_BIN%" generate
if %errorlevel% neq 0 (
    echo [错误] Prisma 客户端生成失败，错误码: %errorlevel%
    pause
    exit /b 1
)
echo [✓] Prisma 客户端已更新

echo.
echo ============================================
echo   [✓] 修复完成！重启服务即可（运行 start.bat）
echo ============================================
pause

)
echo [✓] Prisma 客户端已更新

echo.
echo [✓] 修复完成，重启服务即可（运行 start.bat）
pause
