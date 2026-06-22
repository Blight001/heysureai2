@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean.ps1" %*
pause
