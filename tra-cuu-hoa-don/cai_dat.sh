#!/bin/bash
set -e
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
    echo "Chưa có Python 3. Hãy cài Python 3 rồi chạy lại."
    exit 1
fi

[ -d venv ] || python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
echo "Cài đặt xong. Cần cài Google Chrome để chạy công cụ."
