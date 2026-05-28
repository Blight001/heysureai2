@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Load repository root .env so the AI worker sees the same database and
rem internal service URLs as the rest of the stack.
set "ROOT_DIR=%~dp0.."
set "ENV_FILE=%ROOT_DIR%\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

cd /d "%~dp0"
call venv\Scripts\activate

if not defined HEYSURE_API_GATEWAY_URL set "HEYSURE_API_GATEWAY_URL=http://127.0.0.1:3000"
if not defined MCP_RUNTIME_URL set "MCP_RUNTIME_URL=http://127.0.0.1:3001"
if not defined CONNECTOR_RUNTIME_URL set "CONNECTOR_RUNTIME_URL=http://127.0.0.1:3002"
if not defined HEYSURE_AI_DEBUG set "HEYSURE_AI_DEBUG=1"

python main_ai_runtime.py
