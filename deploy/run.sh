#!/bin/sh
# Runs the transit API on port 5000 - the unprivileged port that is open in this
# VM's GCP firewall, so no sudo and no firewall change are needed.
#
# Safe to invoke from cron @reboot (see deploy/README.md) or manually:
#     setsid nohup ./deploy/run.sh >/dev/null 2>&1 &
set -e

cd "$(dirname "$0")/.."

# node is not on PATH for non-login shells on this box.
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
    NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "no node runtime found; set NODE_BIN" >&2
    exit 1
fi

export PORT="${PORT:-5000}"
export HOST="${HOST:-0.0.0.0}"
# Default city for the transit search; override per request with ?city=LODZ etc.
export CITY_SYMBOL="${CITY_SYMBOL:-WARSZAWA}"
export DEFAULT_FROM="${DEFAULT_FROM:-Plac Defilad 1}"

exec "$NODE_BIN" server/index.js >> transit-api.log 2>&1
