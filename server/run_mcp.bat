@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Load repository root .env so the MCP runtime shares the same database and
rem auth token as the gateway and AI worker.
set "ROOT_DIR=%~dp0.."
set "ENV_FILE=%ROOT_DIR%\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

cd /d "%~dp0"
call venv\Scripts\activate

if not defined HEYSURE_SERVICE_ROLE set "HEYSURE_SERVICE_ROLE=mcp"

python -m mcp_runtime.main
pause
