#!/usr/bin/env bash
# Zips the project for submission/sharing (without node_modules and the downloaded datasets).
#   bash tools/package.sh [out.zip]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-../clonescope.zip}"
rm -f "$OUT"
zip -qr "$OUT" . -x 'node_modules/*' 'data/*' '*/__pycache__/*' '*.pyc' '.git/*' '*.log' '.pytest_cache/*' \
  'results/features_*.jsonl' 'results/*_ids.json' 'dist/artifact.html'
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
