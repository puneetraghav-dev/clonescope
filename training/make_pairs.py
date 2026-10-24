"""Step 2 - create disguised copies of every program (self-supervised labels).

For every original program we generate:
  * one disguise at each plagiarism level L1 ... L6 (used for per-level evaluation)
  * two extra disguises at random levels / intensities (more variety for training)

A pair (original, disguise) is a known positive: it *is* a copy, by construction.
No human labelling is needed.

Output: data/corpus/variants.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obfuscator import disguise  # noqa: E402

PLAN = [("L1", 1), ("L2", 2), ("L3", 3), ("L4", 4), ("L5", 5), ("L6", 6), ("R1", None), ("R2", None)]


def work(line: str):
    rec = json.loads(line)
    out = []
    seed = int(rec["id"][1:])
    for k, (tag, level) in enumerate(PLAN):
        rng = random.Random(seed * 1000 + k)
        try:
            code, ops = disguise(rec["code"], rec["lang"], level=level, rng=rng)
        except RecursionError:
            continue
        out.append({"id": f"{rec['id']}_{tag}", "orig": rec["id"], "lang": rec["lang"], "split": rec["split"],
                    "task": rec["task"], "tag": tag, "level": level, "ops": ops, "code": code})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inp", default="data/corpus/originals.jsonl")
    ap.add_argument("--out", default="data/corpus/variants.jsonl")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    lines = open(args.inp, encoding="utf-8").readlines()
    n = 0
    with Pool(args.workers) as pool, open(args.out, "w", encoding="utf-8") as f:
        for i, res in enumerate(pool.imap(work, lines, chunksize=16)):
            for r in res:
                f.write(json.dumps(r) + "\n")
                n += 1
            if i % 1000 == 0:
                print(f"{i}/{len(lines)} originals -> {n} variants", flush=True)
    print("variants:", n)


if __name__ == "__main__":
    main()
