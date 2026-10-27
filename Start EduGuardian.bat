@echo off
REM Double-click this file to start EduGuardian AI.
REM It starts the backend (which also serves the website) and opens it in your browser.
REM To stop it, close this window (or press Ctrl + C in it).
title EduGuardian AI
if "%~1"=="open" goto open_when_ready

cd /d "%~dp0backend"
if not exist "venv\Scripts\python.exe" (
  echo Could not find backend\venv.
  echo Create it once in Git Bash: see NEW-UI-SETUP.md, "First time only".
  pause
  exit /b 1
)

REM Already running from an earlier double-click? Then just open the website.
curl -s -o nul http://127.0.0.1:8000/health && (
  start "" http://127.0.0.1:8000
  exit /b 0
)

echo Starting EduGuardian AI...
echo The website opens in your browser in a few seconds.
echo Keep this window open while you use it. Close it to stop.
echo.

REM Opens the browser in the background once the server answers
start "" /b cmd /c ""%~f0" open"

"venv\Scripts\python.exe" -m uvicorn main:app --port 8000
echo.
echo EduGuardian AI has stopped. If you see an error above, it says what went wrong.
pause
exit /b 0

:open_when_ready
REM Wait until the server answers (max about 60 seconds), then open the site
for /l %%i in (1,1,60) do (
  curl -s -o nul http://127.0.0.1:8000/health && (
    start "" http://127.0.0.1:8000
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
exit /b 0
