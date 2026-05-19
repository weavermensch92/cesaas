@echo off
chcp 65001 >nul
title HD Sensor — Удаление

echo.
echo ============================================
echo   HD Sensor — Удаление расширения
echo ============================================
echo.

set TARGET=%LOCALAPPDATA%\HDSensor
set PROFILE_DIR=%LOCALAPPDATA%\HDSensor-Profile
set SHORTCUT=%USERPROFILE%\Desktop\HD Sensor Chrome.lnk

choice /C YN /M "Полностью удалить расширение и профиль? (Y/N)"
if errorlevel 2 exit /b 0

if exist "%SHORTCUT%" del "%SHORTCUT%" >nul 2>&1
if exist "%TARGET%" rmdir /S /Q "%TARGET%" >nul 2>&1
if exist "%PROFILE_DIR%" rmdir /S /Q "%PROFILE_DIR%" >nul 2>&1

echo.
echo Удаление завершено.
pause
