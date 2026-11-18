@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Chua co Python 3. Hay cai Python roi chay lai.
    exit /b 1
)

if not exist venv python -m venv venv
if errorlevel 1 exit /b 1
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
echo Cai dat xong. Can cai Google Chrome de chay cong cu.
