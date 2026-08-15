@echo off
cd /d "%~dp0"
if not exist "node_modules\playwright\package.json" (
  echo Installing the browser tools. This only happens once...
  call npm.cmd install --cache .npm-cache
  if errorlevel 1 goto :error
  call npx.cmd playwright install chromium
  if errorlevel 1 goto :error
)
node main.js
pause
exit /b 0

:error
echo.
echo Setup failed. Check your internet connection, then run this file again.
pause
exit /b 1
