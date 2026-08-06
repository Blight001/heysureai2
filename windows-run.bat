@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Root one-click launcher for Windows.
rem It delegates to the backend Tk dashboard (deploy/server/tk_launcher.py).

rem This is a *workspace* repository using Git submodules.
rem deploy/web, deploy/server and optional device/ are Git submodules.
rem 
rem Clone command:
rem   git clone <workspace-url>
rem   git submodule update --init --recursive -- deploy/server deploy/web
rem Or after normal clone:
rem   git submodule update --init --recursive -- deploy/server deploy/web

set "ROOT_DIR=%~dp0"

cd /d "%ROOT_DIR%"

call "%ROOT_DIR%deploy\server\run.bat"
