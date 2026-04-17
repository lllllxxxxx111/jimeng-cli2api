@echo off
chcp 65001 >nul
title 即梦 - 打包升级包（独立升级）

set "ROOT=%~dp0"
set "PACK_DIR=%ROOT%_upgrade_temp"
set "PAYLOAD_DIR=%PACK_DIR%\payload"
set "OUT_ZIP=%ROOT%jimeng-upgrade.zip"

echo ============================================
echo   即梦 OpenAI 调度服务 - 升级包
echo ============================================
echo.

echo [→] 构建前端...
cd /d "%ROOT%frontend"
if not exist "node_modules" call npm install
call npm run build
if %errorlevel% neq 0 (
		echo [错误] 前端构建失败
		pause
		exit /b 1
)

echo [→] 编译后端...
cd /d "%ROOT%"
call npm run build
if %errorlevel% neq 0 (
		echo [错误] 后端编译失败
		pause
		exit /b 1
)

echo [→] 清理旧升级包...
if exist "%PACK_DIR%" rmdir /s /q "%PACK_DIR%"
if exist "%OUT_ZIP%" del "%OUT_ZIP%"
mkdir "%PAYLOAD_DIR%"

echo [→] 复制升级文件...
robocopy "%ROOT%dist" "%PAYLOAD_DIR%\dist" /e /njh /njs /ndl >nul
robocopy "%ROOT%frontend\dist" "%PAYLOAD_DIR%\frontend\dist" /e /njh /njs /ndl >nul
robocopy "%ROOT%prisma" "%PAYLOAD_DIR%\prisma" /e /njh /njs /ndl >nul
robocopy "%ROOT%bin" "%PAYLOAD_DIR%\bin" /e /njh /njs /ndl >nul

copy "%ROOT%package.json" "%PAYLOAD_DIR%\" >nul
copy "%ROOT%package-lock.json" "%PAYLOAD_DIR%\" >nul
copy "%ROOT%start.bat" "%PAYLOAD_DIR%\" >nul
copy "%ROOT%test_client.html" "%PAYLOAD_DIR%\" >nul
if exist "%ROOT%docs" robocopy "%ROOT%docs" "%PAYLOAD_DIR%\docs" /e /njh /njs /ndl >nul
copy "%ROOT%upgrade_apply.bat" "%PACK_DIR%\" >nul

(
	echo 升级包说明：
	echo 1. 将 jimeng-upgrade.zip 解压到服务器任意临时目录。
	echo 2. 运行 upgrade_apply.bat。
	echo 3. 输入服务器现有安装目录，例如 E:\jimeng-deploy。
	echo 4. 脚本只覆盖程序文件，不会碰 data 目录和 jimeng.db 数据库文件。
	echo 5. 脚本会自动执行 prisma migrate deploy，安全升级数据库结构（只加字段，不删数据）。
) > "%PACK_DIR%\README.txt"

echo [→] 压缩为 jimeng-upgrade.zip...
powershell -NoProfile -Command "Compress-Archive -Path '%PACK_DIR%\*' -DestinationPath '%OUT_ZIP%' -Force"

echo [→] 清理临时目录...
rmdir /s /q "%PACK_DIR%"

echo.
echo [✓] 升级包完成：jimeng-upgrade.zip
echo     完整包 pack.bat 未修改；该升级包不包含 data 目录
pause