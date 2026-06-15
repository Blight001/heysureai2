@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem One-click web launcher:
rem - starts the gateway if it is not already running
rem - then starts the Vite dev server for the web UI
set "ROOT_DIR=%~dp0.."
set "SERVER_DIR=%ROOT_DIR%\server"

if not defined SERVER_URL set "SERVER_URL=http://127.0.0.1:3000"


cd /d "%~dp0"

rem Clear Vite's local cache so stale optimized chunks do not poison the next dev session.
if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite"

rem vue-tsc -b may emit an ignored vite.config.js beside the TypeScript source.
rem Remove it so Vite never boots with a stale proxy configuration.
if exist "vite.config.js" del /q "vite.config.js"
if exist "vite.config.d.ts" del /q "vite.config.d.ts"

rem Force a fresh dependency prebundle on every launch to reduce 304 / dynamic import cache issues.
npm run dev -- --force
