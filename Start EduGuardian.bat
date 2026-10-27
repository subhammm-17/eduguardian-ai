@echo off
REM Double-click this file to start EduGuardian AI.
REM 1. It downloads the newest version from GitHub (if you're online).
REM 2. It installs Python packages, but only when requirements.txt changed.
REM 3. It starts the backend (which also serves the website) and opens your browser.
REM To stop it, close this window (or press Ctrl + C in it).
title EduGuardian AI
if "%~1"=="open" goto open_when_ready

REM Already running from an earlier double-click? Then just open the website.
curl -s -o nul http://127.0.0.1:8000/health && (
  start "" http://127.0.0.1:8000
  exit /b 0
)

cd /d "%~dp0"
REM "updated" means we already got the newest version and restarted this file
if "%~1"=="updated" goto setup_python

REM ---------- Step 1: get the newest version ----------
where git >nul 2>&1 || (
  echo [Update] Can't find Git, so I'm starting the version you have.
  goto setup_python
)
if not exist ".git" (
  echo [Update] This folder is not a Git folder, so I'm starting the version you have.
  goto setup_python
)

REM Never stop to ask for a password. If GitHub needs one, just skip the update.
set GIT_TERMINAL_PROMPT=0
REM Windows line endings shouldn't count as "changes"
git config core.autocrlf true

REM Which branch are we on? (normally "main")
set "BRANCH="
for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" if defined BRANCH (
  echo You are trying out the branch "%BRANCH%", not "main".
  echo Press M to go back to main, or wait 5 seconds to keep "%BRANCH%".
  choice /c MK /t 5 /d K /n >nul
  if errorlevel 2 (
    echo Keeping "%BRANCH%".
  ) else (
    git checkout main && set "BRANCH=main" || echo [Update] Could not switch to main, see the message above. Keeping "%BRANCH%".
  )
  echo.
)

echo [Update] Getting the newest version from GitHub...
REM This part is in brackets on purpose: Windows reads the whole block first,
REM so it is safe even when the update changes this very file.
(
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo [Update] Skipped. You may be offline, or you have changed files that the
    echo          update also changes. Nothing was lost. Starting the version you have.
    echo.
  )
  call "%~f0" updated
  exit /b
)

:setup_python
REM ---------- Step 2: Python environment ----------
cd /d "%~dp0backend"
if not exist "venv\Scripts\python.exe" (
  echo [Setup] Creating the Python environment. This happens only once...
  python -m venv venv || py -3 -m venv venv
)
if not exist "venv\Scripts\python.exe" (
  echo.
  echo Could not create backend\venv. Is Python installed?
  echo Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

REM Install packages only when requirements.txt is different from last time
fc /b requirements.txt venv\installed-requirements.txt >nul 2>&1
if errorlevel 1 (
  echo [Setup] Installing Python packages. This can take a few minutes...
  "venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo [Setup] Installing packages failed, see the message above.
    echo         I'll try to start anyway. Next time I'll try installing again.
  ) else (
    copy /y requirements.txt venv\installed-requirements.txt >nul
  )
  echo.
)

REM ---------- Step 3: start ----------
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
