"""Step 1 - collect programs for training.

Sources (cloned by training/fetch_data.sh):
  * Rosetta Code  - ~1,300-1,650 programming tasks, each solved several times
                    independently in Python, Java, C and C++.  Different solutions
                    of the same task are perfect *hard negatives*: same problem,
                    written by different people, NOT copied.
  * TheAlgorithms - thousands of classic algorithms (MIT licence).

Programs are filtered (must parse, sensible size), de-duplicated and split
**by task** into train / val / test so that no task leaks between splits.

Output: data/corpus/originals.jsonl
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obfuscator.core import is_valid  # noqa: E402

ROSETTA_LANGS = {"Python": "python", "Java": "java", "C": "c", "C++": "cpp"}
EXTS = {"python": (".py",), "java": (".java",), "c": (".c",), "cpp": (".cpp", ".cc", ".cxx")}
ALGO_REPOS = {"algo-Python": "python", "algo-Java": "java", "algo-C": "c", "algo-C-Plus-Plus": "cpp"}


def split_of(task_key: str) -> str:
    h = int(hashlib.md5(task_key.encode()).hexdigest(), 16) % 100
    return "train" if h < 80 else "val" if h < 90 else "test"


def norm_hash(code: str) -> str:
    return hashlib.md5(re.sub(r"\s+", "", code).encode()).hexdigest()


def good_size(code: str) -> bool:
    lines = [l for l in code.splitlines() if l.strip()]
    return 6 <= len(lines) <= 400 and 150 <= len(code) <= 40000


def rosetta(root):
    tdir = os.path.join(root, "Task")
    for task in sorted(os.listdir(tdir)):
        for ldir, lang in ROSETTA_LANGS.items():
            d = os.path.join(tdir, task, ldir)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.endswith(EXTS[lang]):
                    yield lang, f"rosetta:{task}", os.path.join(d, fn)


def algorithms(root):
    for repo, lang in ALGO_REPOS.items():
        base = os.path.join(root, repo)
        if not os.path.isdir(base):
            continue
        for dp, dns, fns in os.walk(base):
            dns[:] = [d for d in dns if not d.startswith(".")]
            for fn in sorted(fns):
                if not fn.endswith(EXTS[lang]):
                    continue
                if fn.startswith("test_") or fn.endswith("_test.py") or fn in ("__init__.py", "conftest.py") \
                        or "Test" in fn:
                    continue
                rel = os.path.relpath(os.path.join(dp, fn), base)
                if lang == "python" and re.match(r"project_euler/problem_\d+/", rel):
                    task = "algo:" + os.path.dirname(rel)  # several sol*.py per problem -> hard negatives
                else:
                    task = f"algo:{lang}:" + os.path.splitext(rel)[0]
                yield lang, task, os.path.join(dp, fn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data"),
                    help="folder made by training/fetch_data.sh (default: ../data next to the repo)")
    ap.add_argument("--out", default="data/corpus/originals.jsonl")
    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    seen = set()
    stats = Counter()
    n = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for src_name, gen in (("rosetta", rosetta(os.path.join(args.data, "rosetta"))),
                              ("algo", algorithms(args.data))):
            for lang, task, path in gen:
                stats["seen"] += 1
                try:
                    code = open(path, encoding="utf-8").read()
                except (UnicodeDecodeError, OSError):
                    stats["bad_encoding"] += 1
                    continue
                code = code.replace("\r\n", "\n").replace("\t", "    ") if lang == "python" else code.replace("\r\n", "\n")
                if not good_size(code):
                    stats["size"] += 1
                    continue
                h = norm_hash(code)
                if h in seen:
                    stats["duplicate"] += 1
                    continue
                if not is_valid(code.encode("utf-8"), lang):
                    stats["parse_error"] += 1
                    continue
                seen.add(h)
                rec = {"id": f"o{n}", "lang": lang, "task": task, "source": src_name, "split": split_of(task),
                       "path": os.path.relpath(path, args.data), "code": code}
                out.write(json.dumps(rec) + "\n")
                stats[f"kept_{lang}"] += 1
                stats[f"split_{rec['split']}"] += 1
                n += 1
    print(json.dumps(stats, indent=1))
    print("kept", n)


if __name__ == "__main__":
    main()
