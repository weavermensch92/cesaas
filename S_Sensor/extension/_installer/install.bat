@echo off
chcp 65001 >nul
title HD건설기계 Sensor Installer

echo.
echo ============================================
echo   HD건설기계 Sensor Extension 설치
echo ============================================
echo.

REM ----- 1. 영구 경로로 복사 -----
set TARGET=%LOCALAPPDATA%\HDSensor
if exist "%TARGET%" (
    echo [기존 설치 갱신중] %TARGET%
    rmdir /S /Q "%TARGET%"
)
mkdir "%TARGET%" 2>nul
xcopy /E /Y /Q "%~dp0extension\*" "%TARGET%\" >nul
if errorlevel 1 (
    echo [ERROR] 파일 복사 실패. 권한을 확인하세요.
    pause
    exit /b 1
)
echo [1/3] 설치 폴더 생성 완료
echo       %TARGET%

REM ----- 2. Chrome 경로 자동 탐지 -----
set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe

if not defined CHROME (
    echo.
    echo [ERROR] Chrome 이 설치되지 않았거나 표준 경로에 없습니다.
    echo Chrome 다운로드: https://www.google.com/chrome/
    pause
    exit /b 1
)
echo [2/3] Chrome 발견
echo       %CHROME%

REM ----- 3. 바탕화면 바로가기 생성 (PowerShell) -----
set PROFILE_DIR=%LOCALAPPDATA%\HDSensor-Profile
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell; $lnk=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\HD Sensor Chrome.lnk'); $lnk.TargetPath='%CHROME%'; $lnk.Arguments='--load-extension=\"%TARGET%\" --user-data-dir=\"%PROFILE_DIR%\" --no-first-run --no-default-browser-check'; $lnk.IconLocation='%TARGET%\icons\128.png'; $lnk.WorkingDirectory='%TARGET%'; $lnk.Save()"
echo [3/3] 바탕화면 바로가기 생성 완료
echo       'HD Sensor Chrome'

echo.
echo ============================================
echo   설치 완료!
echo ============================================
echo.
echo 사용법:
echo   1. 바탕화면 'HD Sensor Chrome' 더블클릭
echo   2. Bitrix24 로그인 후 영업 화면 열기
echo   3. CRM 화면 캡쳐 자동 시작
echo   4. Chrome 우측 상단 퍼즐 아이콘 클릭 > HD Sensor 핀 고정 권장
echo.

choice /C YN /M "지금 Chrome 시작하시겠습니까? (Y/N)"
if errorlevel 2 exit /b 0
start "" "%CHROME%" --load-extension="%TARGET%" --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check
