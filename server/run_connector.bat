@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Load repository root .env so the connector runtime shares the same
rem database and internal token as the rest of the stack.
set "ROOT_DIR=%~dp0.."
set "ENV_FILE=%ROOT_DIR%\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

cd /d "%~dp0"
call venv\Scripts\activate

python -m connector_runtime.main
pause
