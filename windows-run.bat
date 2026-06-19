@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Root one-click launcher for Windows.
rem It delegates to the existing backend Tk dashboard, which now also manages the web console.

set "ROOT_DIR=%~dp0"

cd /d "%ROOT_DIR%"

call "%ROOT_DIR%server\run.bat"
