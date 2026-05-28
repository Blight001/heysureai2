@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Load repository root .env into this session so the server uses Postgres
rem instead of falling back to the legacy SQLite file.
set "ROOT_DIR=%~dp0.."
set "ENV_FILE=%ROOT_DIR%\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

cd /d "%~dp0"
call venv\Scripts\activate

rem Keep the dev server stable unless you explicitly enable reload yourself.
set "HEYSURE_SERVER_RELOAD=0"

python main.py
pause
