#!/usr/bin/env bash
# Tek komut kurulum + başlatma: ilk çalıştırmada venv + bağımlılıklar, sonra sunucu.
# Kullanım: ./run.sh [--lang tr] [--port 8020] [--device cpu]
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for c in python3.11 python3.12 python3.13 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    v=$("$c" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])')
    if [ "$v" -ge 310 ]; then PY="$c"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "HATA: Python 3.10+ bulunamadı. macOS: brew install python@3.11" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "[run.sh] ilk kurulum: sanal ortam + bağımlılıklar (birkaç dakika sürebilir)…"
  "$PY" -m venv .venv
  ./.venv/bin/pip install --upgrade pip -q
  ./.venv/bin/pip install -r requirements.txt
fi

if ! ls voices/*.wav >/dev/null 2>&1; then
  echo "[run.sh] UYARI: voices/ boş — voices/<ad>.wav referans kaydı ekleyin (6-30 sn)."
fi

exec ./.venv/bin/python server.py "$@"
