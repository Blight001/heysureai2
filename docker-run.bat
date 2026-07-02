@echo off
cd /d "%~dp0"
rem HeySure workspace: web/ server/ device/ come from git submodules
rem After clone: git submodule update --init --recursive

if "%HEYSURE_REPO_UPDATER_PORT%"=="" set "HEYSURE_REPO_UPDATER_PORT=58151"
if "%HEYSURE_REPO_UPDATER_URL%"=="" set "HEYSURE_REPO_UPDATER_URL=http://host.docker.internal:%HEYSURE_REPO_UPDATER_PORT%"
if "%HEYSURE_REPO_UPDATER_TOKEN%"=="" set "HEYSURE_REPO_UPDATER_TOKEN=%HEYSURE_INTERNAL_TOKEN%"
if "%HEYSURE_REPO_UPDATER_TOKEN%"=="" set "HEYSURE_REPO_UPDATER_TOKEN=heysure-dev-internal-token-change-me"

if not exist server\logs mkdir server\logs
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%HEYSURE_REPO_UPDATER_PORT% .*LISTENING"') do (
  echo [1/4] Existing repo updater only listens on 127.0.0.1; restarting it for Docker access...
  taskkill /PID %%p /F >nul 2>nul
)
curl -fsS "http://127.0.0.1:%HEYSURE_REPO_UPDATER_PORT%/health" >nul 2>nul
if not errorlevel 1 (
  curl -fsS -H "Authorization: Bearer %HEYSURE_REPO_UPDATER_TOKEN%" "http://127.0.0.1:%HEYSURE_REPO_UPDATER_PORT%/version" >nul 2>nul
  if errorlevel 1 (
    echo [1/4] Existing repo updater token mismatch; restarting it...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%HEYSURE_REPO_UPDATER_PORT% .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
  )
)
curl -fsS "http://127.0.0.1:%HEYSURE_REPO_UPDATER_PORT%/health" >nul 2>nul
if errorlevel 1 (
  echo [1/4] Starting host repo updater on 0.0.0.0:%HEYSURE_REPO_UPDATER_PORT% ...
  start "HeySure Repo Updater" /min cmd /c "set HEYSURE_REPO_ROOT=%CD%&& set HEYSURE_REPO_UPDATER_HOST=0.0.0.0&& set HEYSURE_REPO_UPDATER_PORT=%HEYSURE_REPO_UPDATER_PORT%&& set HEYSURE_REPO_UPDATER_TOKEN=%HEYSURE_REPO_UPDATER_TOKEN%&& python server\other\scripts\repo-updater.py > server\logs\repo-updater.log 2>&1"
  timeout /t 2 /nobreak >nul
  curl -fsS -H "Authorization: Bearer %HEYSURE_REPO_UPDATER_TOKEN%" "http://127.0.0.1:%HEYSURE_REPO_UPDATER_PORT%/version" >nul 2>nul
  if errorlevel 1 (
    echo [WARN] Repo updater failed to start or token mismatch. See server\logs\repo-updater.log
  ) else (
    echo [OK] Repo updater started.
  )
) else (
  echo [1/4] Host repo updater is already running.
)

echo [2/4] Updating submodules...
git submodule update --init --recursive

echo [3/4] Building and starting Docker services...
docker compose up -d --build

echo [4/4] Services started.
pause
