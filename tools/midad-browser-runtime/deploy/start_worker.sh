#!/bin/sh
set -eu
cd "$(dirname "$0")"

: "${SUPABASE_URL:?Set SUPABASE_URL in the host Startup environment}"
: "${MIDAD_INGEST_KEY:?Set MIDAD_INGEST_KEY in the host secret settings}"
: "${MIDAD_BROWSER_ALLOWED_HOSTS:?Set exact allowed hostnames, comma-separated}"
: "${MIDAD_OPERATOR_OWNER_USER_ID:?Set the authorized operator UUID}"

export MIDAD_BROWSER_ACCOUNT_REGISTRY="${MIDAD_BROWSER_ACCOUNT_REGISTRY:-$PWD/accounts.json}"
export MIDAD_OPERATOR_POLL_SECONDS="${MIDAD_OPERATOR_POLL_SECONDS:-3}"

if [ ! -f "$MIDAD_BROWSER_ACCOUNT_REGISTRY" ]; then
  echo "MIDAD_ACCOUNT_REGISTRY_MISSING: copy accounts.example.json to accounts.json and configure an approved platform profile."
  exit 2
fi

if ! python -c 'import playwright' >/dev/null 2>&1; then
  python -m pip install --user -r requirements.txt
fi

python -m playwright install chromium
exec python operator_worker.py
