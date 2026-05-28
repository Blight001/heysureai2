@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem One-click web launcher:
rem - starts the gateway if it is not already running
rem - then starts the Vite dev server for the web UI
set "ROOT_DIR=%~dp0.."
set "SERVER_DIR=%ROOT_DIR%\server"

if not defined SERVER_URL set "SERVER_URL=http://127.0.0.1:3000"


cd /d "%~dp0"
npm run dev
