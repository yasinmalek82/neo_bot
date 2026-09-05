#!/usr/bin/env bash
# Discoverable alias for the persistent host menu.
# Never run with `bash -x` or `set -x`; prompts include secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${ROOT}/deploy/neo" "$@"
