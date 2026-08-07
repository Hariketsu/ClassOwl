#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find backend tests -type d -name __pycache__ -prune -exec rm -rf {} +
rm -rf .pytest_cache build dist electron/dist frontend/dist
