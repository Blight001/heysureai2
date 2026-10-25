@echo off
setlocal
set "HTTP_PROXY=http://127.0.0.1:7897"
set "HTTPS_PROXY=http://127.0.0.1:7897"
set "CODEX_EXE=C:\Users\admin\AppData\Local\OpenAI\Codex\bin\37f54d68e5533a51\codex.exe"
if not exist "%CODEX_EXE%" (
  echo Codex executable has moved. Update CODEX_EXE in this file.
  pause
  exit /b 1
)
"%CODEX_EXE%" --no-daemon -s workspace-write %*
set "CODEX_EXIT=%ERRORLEVEL%"
if not "%CODEX_EXIT%"=="0" pause
exit /b %CODEX_EXIT%
