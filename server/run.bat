@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Aggregated launcher: start the gateway, MCP runtime, connector runtime,
rem and AI worker in separate consoles.
set "SCRIPT_DIR=%~dp0"

rem When the split AI runtime is launched, route chat runs to the queue so the
rem ai-runtime console actually consumes them and shows its debug output.
if not defined AI_DISPATCH_MODE set "AI_DISPATCH_MODE=remote"

set "TILE_SCRIPT=%SCRIPT_DIR%tile_windows.ps1"
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%TILE_SCRIPT%"
) else if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" (
  "%ProgramFiles%\PowerShell\7\pwsh.exe" -NoProfile -Sta -ExecutionPolicy Bypass -File "%TILE_SCRIPT%"
) else (
  echo PowerShell is not available.
  exit /b 1
)
