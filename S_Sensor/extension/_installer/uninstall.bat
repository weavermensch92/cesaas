@echo off
chcp 65001 >nul
title HD건설기계 Sensor Uninstaller

echo.
echo ============================================
echo   HD건설기계 Sensor Extension 제거
echo ============================================
echo.

set TARGET=%LOCALAPPDATA%\HDSensor
set PROFILE_DIR=%LOCALAPPDATA%\HDSensor-Profile
set SHORTCUT=%USERPROFILE%\Desktop\HD Sensor Chrome.lnk

choice /C YN /M "Extension 데이터와 프로필을 완전히 제거하시겠습니까? (Y/N)"
if errorlevel 2 exit /b 0

if exist "%SHORTCUT%" del "%SHORTCUT%" >nul 2>&1
if exist "%TARGET%" rmdir /S /Q "%TARGET%" >nul 2>&1
if exist "%PROFILE_DIR%" rmdir /S /Q "%PROFILE_DIR%" >nul 2>&1

echo.
echo 제거 완료.
pause
