@echo off
setlocal

cd /d "%~dp0"

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Starting HeySure Agent Windows desktop app...
call npm run dev

pause
