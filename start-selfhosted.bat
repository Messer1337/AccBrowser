@echo off
setlocal

:: OASIS Browser - Self-Hosted Mode Launcher
set OASIS_BACKEND=selfhosted
set OASIS_SELFHOSTED_URL=http://152.53.224.55:3300

echo Launching OASIS Browser in Self-Hosted Mode...
echo Server endpoint: %OASIS_SELFHOSTED_URL%

if exist "%~dp0dist\win-unpacked\OASIS Browser.exe" (
    start "" "%~dp0dist\win-unpacked\OASIS Browser.exe"
) else if exist "%~dp0OASIS Browser.exe" (
    start "" "%~dp0OASIS Browser.exe"
) else (
    npm start
)
