@echo off
setlocal
rem Keep this launcher ASCII-only so cmd.exe code pages do not affect startup.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-database.ps1" %*
set "KUSAKARI_CANVAS_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%KUSAKARI_CANVAS_EXIT_CODE%"=="2" echo Database reset was cancelled. Nothing was changed.
if not "%KUSAKARI_CANVAS_EXIT_CODE%"=="0" if not "%KUSAKARI_CANVAS_EXIT_CODE%"=="2" echo Database reset failed. Check the message above.
if not "%KUSAKARI_CANVAS_NO_PAUSE%"=="1" pause
exit /b %KUSAKARI_CANVAS_EXIT_CODE%
