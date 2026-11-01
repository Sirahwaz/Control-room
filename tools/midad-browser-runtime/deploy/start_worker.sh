#!/bin/sh
set -eu
cd "$(dirname "$0")"

# Load the existing private host .env file when present.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${SUPABASE_URL:?Set SUPABASE_URL in the host Startup environment}"
: "${MIDAD_INGEST_KEY:?Set MIDAD_INGEST_KEY in the host secret settings}"
: "${MIDAD_BROWSER_ALLOWED_HOSTS:=example.com}"
export MIDAD_BROWSER_ALLOWED_HOSTS

export MIDAD_BROWSER_ACCOUNT_REGISTRY="${MIDAD_BROWSER_ACCOUNT_REGISTRY:-$PWD/accounts.json}"
export MIDAD_OPERATOR_POLL_SECONDS="${MIDAD_OPERATOR_POLL_SECONDS:-3}"

if [ ! -f "$MIDAD_BROWSER_ACCOUNT_REGISTRY" ]; then
  if [ "$MIDAD_BROWSER_ALLOWED_HOSTS" = "example.com" ] || printf ',%s,' ",$MIDAD_BROWSER_ALLOWED_HOSTS," | grep -q ',example.com,'; then
    cp accounts.example.json "$MIDAD_BROWSER_ACCOUNT_REGISTRY"
    echo "MIDAD_ACCOUNT_REGISTRY_BOOTSTRAPPED: example.com read-only smoke profile created."
  else
    echo "MIDAD_ACCOUNT_REGISTRY_MISSING: add a profile for one exact allowed host."
    exit 2
  fi
fi

if ! python -c 'import playwright' >/dev/null 2>&1; then
  python -m pip install --user -r requirements.txt
fi

python -m playwright install chromium
exec python operator_worker.py
