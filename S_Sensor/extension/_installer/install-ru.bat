@echo off
chcp 65001 >nul
title HD Construction Equipment — Sensor Installer

echo.
echo ============================================
echo   HD Construction Equipment — Sensor
echo   Установка расширения для Chrome
echo ============================================
echo.

REM ----- 1. Копирование в постоянную папку -----
set TARGET=%LOCALAPPDATA%\HDSensor
if exist "%TARGET%" (
    echo [Обновление существующей установки] %TARGET%
    rmdir /S /Q "%TARGET%"
)
mkdir "%TARGET%" 2>nul
xcopy /E /Y /Q "%~dp0extension\*" "%TARGET%\" >nul
if errorlevel 1 (
    echo [ОШИБКА] Не удалось скопировать файлы. Проверьте права доступа.
    pause
    exit /b 1
)
echo [1/3] Папка установки создана
echo       %TARGET%

REM ----- 2. Автопоиск Chrome -----
set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if not defined CHROME (
    echo.
    echo [ОШИБКА] Chrome не найден в стандартных папках.
    echo Скачать Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)
echo [2/3] Chrome обнаружен
echo       %CHROME%

REM ----- 3. Ярлык на рабочем столе -----
set PROFILE_DIR=%LOCALAPPDATA%\HDSensor-Profile
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell; $lnk=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\HD Sensor Chrome.lnk'); $lnk.TargetPath='%CHROME%'; $lnk.Arguments='--load-extension=\"%TARGET%\" --user-data-dir=\"%PROFILE_DIR%\" --no-first-run --no-default-browser-check'; $lnk.IconLocation='%TARGET%\icons\128.png'; $lnk.WorkingDirectory='%TARGET%'; $lnk.Save()"
echo [3/3] Ярлык создан на рабочем столе
echo       'HD Sensor Chrome'

echo.
echo ============================================
echo   Установка завершена!
echo ============================================
echo.
echo Как пользоваться:
echo   1. Дважды кликните 'HD Sensor Chrome' на рабочем столе
echo   2. Войдите в Bitrix24 и откройте окно продаж
echo   3. Захват CRM-экрана начнётся автоматически
echo   4. Закрепите иконку HD Sensor (значок пазла в Chrome справа)
echo.

choice /C YN /M "Запустить Chrome сейчас? (Y/N)"
if errorlevel 2 exit /b 0
start "" "%CHROME%" --load-extension="%TARGET%" --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check
