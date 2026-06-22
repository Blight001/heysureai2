@echo off
cd /d "%~dp0"
rem HeySure workspace: web/ server/ device/ come from git submodules
rem After clone: git submodule update --init --recursive
docker compose up -d --build
pause
