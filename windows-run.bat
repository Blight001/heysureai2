@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Root one-click launcher for Windows.
rem It delegates to the existing backend Tk dashboard (server/tk_launcher.py),
rem which manages the 4 Python runtimes + web console.
rem
rem Repo note:
rem   This is a monorepo containing web/ + server/ + device/.
rem   Run "clean.bat" (or pwsh clean.ps1) if the tree feels bloated from node_modules/dist.

set "ROOT_DIR=%~dp0"

cd /d "%ROOT_DIR%"

call "%ROOT_DIR%server\run.bat"
