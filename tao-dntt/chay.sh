#!/bin/bash
set -e
cd "$(dirname "$0")" || exit 1
export PYTHONIOENCODING=utf-8

if [ ! -x venv/bin/python ]; then
    echo "Chưa cài đặt. Chạy: bash cai_dat.sh"
    exit 1
fi

venv/bin/python tra_cuu_hoa_don.py
