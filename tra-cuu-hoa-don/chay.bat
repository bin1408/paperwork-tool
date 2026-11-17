@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

if not exist venv\Scripts\python.exe (
    echo Chua cai dat. Chay cai_dat.bat truoc.
    exit /b 1
)

venv\Scripts\python.exe tra_cuu_hoa_don.py
