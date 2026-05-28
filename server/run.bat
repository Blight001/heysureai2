@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Aggregated launcher: start the gateway, MCP runtime, connector runtime,
rem and AI worker in separate consoles.
set "SCRIPT_DIR=%~dp0"

rem When the split AI runtime is launched, route chat runs to the queue so the
rem ai-runtime console actually consumes them and shows its debug output.
if not defined AI_DISPATCH_MODE set "AI_DISPATCH_MODE=remote"

start "HeySure Gateway" /D "%SCRIPT_DIR%" cmd /k "call run_gateway.bat"
start "HeySure MCP Runtime" /D "%SCRIPT_DIR%" cmd /k "call run_mcp.bat"
start "HeySure Connector Runtime" /D "%SCRIPT_DIR%" cmd /k "call run_connector.bat"
start "HeySure AI Runtime" /D "%SCRIPT_DIR%" cmd /c "call run_ai.bat"

pause
