@echo off
cd /d "%~dp0"
rem HeySure workspace: expects web/ + server/ + device/ (run init-env.ps1 first if missing)
docker compose up -d --build
pause
