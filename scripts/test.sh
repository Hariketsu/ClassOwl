#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if git ls-files --error-unmatch SPEC.md >/dev/null 2>&1 || test -n "$(git ls-files resources/raw)" || test -n "$(git ls-files ref)"; then
  echo "错误：提交中不得包含 SPEC.md、resources/raw/ 或 ref/ 内的文件" >&2
  exit 1
fi
uv run pytest -q
npm --prefix frontend run test
npm --prefix frontend run build
npx tsc -p electron/tsconfig.json --noEmit
