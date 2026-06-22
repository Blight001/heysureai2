@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Root one-click launcher for Windows.
rem It delegates to the backend Tk dashboard (server/tk_launcher.py).

rem This is a *workspace* repository using Git submodules.
rem web/, server/, device/ are linked to HeySure-Web / Server / Device repos.
rem 
rem Clone command:
rem   git clone --recurse-submodules <workspace-url>
rem Or after normal clone:
rem   git submodule update --init --recursive

set "ROOT_DIR=%~dp0"

cd /d "%ROOT_DIR%"

call "%ROOT_DIR%server\run.bat"
