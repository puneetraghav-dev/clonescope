"""Checks that disguised programs still compile and print exactly the same output.

    python tests/check_obfuscator.py            # every operation x 25 seeds + full levels
    python tests/check_obfuscator.py --quick

Needs python3, gcc, g++ and a JDK on PATH.
"""
from __future__ import annotations

import argparse
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "training"))

from obfuscator import OUTPUT_CHANGING, apply_op, disguise, operations  # noqa: E402

FIXTURES = {"python": "prog.py", "c": "prog.c", "cpp": "prog.cpp", "java": "Main.java"}


def run_program(code: str, lang: str, workdir: str) -> str | None:
    """Compiles (if needed) and runs `code`; returns stdout or None on any failure."""
    try:
        if lang == "python":
            p = os.path.join(workdir, "p.py")
            open(p, "w").write(code)
            r = subprocess.run([sys.executable, p], capture_output=True, text=True, timeout=10)
        elif lang in ("c", "cpp"):
            ext = "c" if lang == "c" else "cpp"
            p = os.path.join(workdir, f"p.{ext}")
            exe = os.path.join(workdir, "p.out")
            open(p, "w").write(code)
            cc = ["gcc", "-std=c11"] if lang == "c" else ["g++", "-std=c++17"]
            c = subprocess.run(cc + ["-o", exe, p, "-lm"], capture_output=True, text=True, timeout=60)
            if c.returncode != 0:
                return None
            r = subprocess.run([exe], capture_output=True, text=True, timeout=10)
        else:
            m = re.search(r"public\s+class\s+(\w+)", code)
            cls = m.group(1) if m else "Main"
            d = os.path.join(workdir, "j")
            shutil.rmtree(d, ignore_errors=True)
            os.makedirs(d)
            p = os.path.join(d, cls + ".java")
            open(p, "w").write(code)
            c = subprocess.run(["javac", "-nowarn", "-d", d, p], capture_output=True, text=True, timeout=120)
            if c.returncode != 0:
                return None
            r = subprocess.run(["java", "-cp", d, cls], capture_output=True, text=True, timeout=20)
        return r.stdout if r.returncode == 0 else None
    except subprocess.TimeoutExpired:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--langs", default="python,c,cpp,java")
    args = ap.parse_args()
    seeds = 6 if args.quick else 25
    stats = defaultdict(lambda: [0, 0, 0])  # applied, ok, broken
    failures = []
    with tempfile.TemporaryDirectory() as wd:
        for lang in args.langs.split(","):
            src = open(os.path.join(HERE, "fixtures", FIXTURES[lang]), "rb").read()
            expected = run_program(src.decode(), lang, wd)
            assert expected is not None, f"fixture for {lang} does not run"
            for level, ops in sorted(operations(lang).items()):
                for name, fn in ops.items():
                    for seed in range(seeds):
                        new = apply_op(src, lang, fn, random.Random(seed))
                        if new is None:
                            continue
                        st = stats[(lang, name)]
                        st[0] += 1
                        out = run_program(new.decode(), lang, wd)
                        # output-changing operations only need to compile and run
                        if out == expected or (name in OUTPUT_CHANGING and out is not None):
                            st[1] += 1
                        else:
                            st[2] += 1
                            failures.append((lang, name, seed, new.decode()))
            for level in range(1, 7):
                for seed in range(seeds):
                    code, applied = disguise(src, lang, level=level, rng=random.Random(1000 + seed), exclude=OUTPUT_CHANGING)
                    st = stats[(lang, f"LEVEL {level}")]
                    st[0] += 1
                    out = run_program(code, lang, wd)
                    if out == expected:
                        st[1] += 1
                    else:
                        st[2] += 1
                        failures.append((lang, f"L{level} {applied}", seed, code))
    print(f"{'language':8} {'operation':24} applied  same-output  different")
    for (lang, name), (a, ok, bad) in sorted(stats.items()):
        print(f"{lang:8} {name:24} {a:7d}  {ok:11d}  {bad:9d}")
    total = sum(v[0] for v in stats.values())
    good = sum(v[1] for v in stats.values())
    changing = sum(v[0] for (lang, name), v in stats.items() if name in OUTPUT_CHANGING)
    print("\n(for output-changing operations - rewording messages - 'same-output' means: compiles and runs)")
    print(f"TOTAL {good}/{total} disguised programs compile and run; {good - changing}/{total - changing} from "
          f"output-preserving operations print identical output ({100.0 * good / max(1, total):.1f}%)")
    if failures and "-v" in sys.argv:
        for lang, name, seed, code in failures[:5]:
            print("=" * 70, lang, name, seed)
            print(code)
    return 0 if good == total else 1


if __name__ == "__main__":
    sys.exit(main())
