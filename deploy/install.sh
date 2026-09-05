#!/usr/bin/env bash
# First-host installer: writes a gitignored .env and builds customer static assets,
# then starts Postgres, bot-api, and Caddy with automatic HTTPS.
# Prefer `bash deploy/neo-install.sh` or `bash deploy/neo` for the management menu.
# Never run with `bash -x` or `set -x`; prompts include secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NEO_ROOT="$ROOT"
# shellcheck source=lib.sh
source "${ROOT}/deploy/lib.sh"

neo_install_or_reconfigure
