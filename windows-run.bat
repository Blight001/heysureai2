@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Root one-click launcher for Windows.
rem It delegates to the backend Tk dashboard (server/tk_launcher.py).
rem
rem This is a *workspace* repository.
rem Run "pwsh -File init-env.ps1" first if web/, server/, device/ are missing.
rem Run "clean.bat" (or pwsh clean.ps1) to remove heavy build artifacts.

set "ROOT_DIR=%~dp0"

cd /d "%ROOT_DIR%"

call "%ROOT_DIR%server\run.bat"
