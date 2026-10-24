#!/usr/bin/env bash
# Downloads the public code used for training and evaluation (about 200 MB).
#   bash training/fetch_data.sh [target-dir]      (default: ../data next to the repo)
set -euo pipefail
DATA="${1:-$(cd "$(dirname "$0")/../.." && pwd)/data}"
mkdir -p "$DATA" && cd "$DATA"

# Rosetta Code: only the Python, Java, C and C++ solutions (sparse checkout)
if [ ! -d rosetta ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/acmeism/RosettaCodeData.git rosetta
  (cd rosetta && git sparse-checkout set --no-cone '/Task/*/Python/*' '/Task/*/Java/*' '/Task/*/C/*' '/Task/*/C++/*')
fi

# TheAlgorithms (MIT licence)
for r in Python Java C C-Plus-Plus; do
  [ -d "algo-$r" ] || git clone -q --depth 1 "https://github.com/TheAlgorithms/$r.git" "algo-$r"
done

# IR-Plag: 467 Java files with human-made plagiarism at levels L1-L6 (Apache-2.0), evaluation only
if [ ! -d irplag_x ]; then
  git clone -q --depth 1 https://github.com/oscarkarnalim/sourcecodeplagiarismdataset.git irplag
  mkdir -p irplag_x && (cd irplag_x && unzip -q ../irplag/IR-Plag-Dataset.zip)
fi
echo "data ready in $DATA"
