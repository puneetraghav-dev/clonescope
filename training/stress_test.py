"""Stress test - how do methods hold up when disguises are stacked?

For every program of the held-out TEST tasks we apply the strongest disguise (level 6)
one, two and three times in a row (different random choices each round). Real copiers
also edit in several passes. The result is written to data/corpus/stress.jsonl and scored
by extract_features.mjs --only stress, embed_pairs.py and evaluate.py.

    python training/stress_test.py
"""
from __future__ import annotations

import json
import os
import random
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obfuscator import disguise  # noqa: E402


def work(line):
    r = json.loads(line)
    if r["split"] != "test":
        return []
    out, code = [], r["code"]
    seed = int(r["id"][1:])
    for rounds in (1, 2, 3):
        code, _ = disguise(code, r["lang"], level=6, rng=random.Random(seed * 10 + rounds), intensity=0.9)
        out.append({"id": f"{r['id']}_S{rounds}", "orig": r["id"], "lang": r["lang"], "split": "test",
                    "task": r["task"], "rounds": rounds, "code": code})
    return out


def main():
    lines = open("data/corpus/originals.jsonl", encoding="utf-8").readlines()
    n = 0
    with Pool(os.cpu_count() or 2) as pool, open("data/corpus/stress.jsonl", "w", encoding="utf-8") as f:
        for res in pool.imap(work, lines, chunksize=32):
            for r in res:
                f.write(json.dumps(r) + "\n")
                n += 1
    print("stress variants:", n)


if __name__ == "__main__":
    main()
