@echo off
echo ==========================================================
echo  Kampala University Chat House - Orchestrator Setup and Run
echo ==========================================================
echo.

cd /d "%~dp0"

if exist "venv" goto ACTIVATE

echo [INFO] Creating Python virtual environment (venv)...
py -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment. Ensure Python is installed.
    pause
    exit /b 1
)
echo [SUCCESS] Virtual environment created.
echo.

:ACTIVATE
echo [INFO] Activating virtual environment...
call venv\Scripts\activate
if %errorlevel% neq 0 (
    echo [ERROR] Failed to activate virtual environment.
    pause
    exit /b 1
)
echo [SUCCESS] Virtual environment activated.
echo.

echo [INFO] Installing requirements.txt dependencies...
python -m pip install --upgrade pip
if %errorlevel% neq 0 (
    echo [ERROR] Failed to upgrade pip.
    pause
    exit /b 1
)

pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo [SUCCESS] Dependencies installed.
echo.

echo [INFO] Starting Flask Server on http://localhost:5000...
echo.
python backend\app.py
pause
