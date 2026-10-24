"""Builds the three example classes shown in the app (samples/samples.json).

Each class has 10 students: 7 wrote their own solution (samples/<lang>/independent/),
3 handed in disguised copies made with the obfuscator. Every copy is compiled/run and
must print exactly what its source prints.

    python tools/make_samples.py
"""
from __future__ import annotations

import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "training"))
sys.path.insert(0, os.path.join(ROOT, "tests"))

from obfuscator import OUTPUT_CHANGING, disguise  # noqa: E402
from check_obfuscator import run_program  # noqa: E402

CLASSES = {
    "python": {
        "title": "Lab 4 · Marks report", "course": "Python Programming · Section B", "ext": "py", "file": "marks.py",
        "students": [("Aarav Sharma", "s1"), ("Diya Patel", "s2"), ("Rohan Iyer", "s3"), ("Ananya Gupta", "s4"),
                     ("Meera Nair", "s5"), ("Arjun Reddy", "s6"), ("Vikram Joshi", "s7")],
        "copies": [("Kabir Khan", "s2", 2, 11), ("Ishita Das", "s2", 6, 23), ("Sneha Kulkarni", "s5", 5, 7)],
    },
    "java": {
        "title": "Lab 6 · Payroll", "course": "Object Oriented Programming with Java · Section A", "ext": "java",
        "file": "Main.java", "starter": "starter.java",
        "students": [("Aditya Menon", "s1"), ("Priya Verma", "s2"), ("Rahul Chatterjee", "s3"),
                     ("Siddharth Jain", "s4"), ("Harsh Agarwal", "s5"), ("Nisha Fernandes", "s6"), ("Pooja Singh", "s7")],
        "copies": [("Kavya Rao", "s1", 2, 5), ("Imran Shaikh", "s1", 6, 31), ("Tanvi Deshpande", "s6", 5, 13)],
    },
    "c": {
        "title": "Lab 2 · Array statistics", "course": "Programming in C · First year", "ext": "c", "file": "lab2.c",
        "students": [("Yash Malhotra", "s1"), ("Riya Sen", "s2"), ("Karthik Subramanian", "s3"), ("Neha Bhatt", "s4"),
                     ("Lakshmi Pillai", "s5"), ("Gaurav Mishra", "s6"), ("Divya Krishnan", "s7")],
        "copies": [("Farhan Ali", "s2", 3, 3), ("Manish Yadav", "s2", 6, 17), ("Zoya Mirza", "s4", 5, 29)],
    },
}


def run_with_input(code, lang, inp, wd):
    import subprocess
    import tempfile
    # run_program runs without stdin; feed input through a wrapper for each language
    stdin_file = os.path.join(wd, "stdin.txt")
    open(stdin_file, "w").write(inp)
    old = subprocess.run

    def patched(cmd, *a, **k):
        if k.get("capture_output") and not any(x in cmd[0] for x in ("gcc", "g++", "javac")):
            k["stdin"] = open(stdin_file)
        return old(cmd, *a, **k)

    subprocess.run = patched
    try:
        return run_program(code, lang, wd)
    finally:
        subprocess.run = old


def main():
    import tempfile
    out = {}
    with tempfile.TemporaryDirectory() as wd:
        for lang, cfg in CLASSES.items():
            base = os.path.join(ROOT, "samples", lang)
            inp = open(os.path.join(base, "input.txt")).read()
            src = {sid: open(os.path.join(base, "independent", f"{sid}.{cfg['ext']}")).read()
                   for _, sid in cfg["students"]}
            subs, truth = [], []
            for name, sid in cfg["students"]:
                subs.append({"name": name, "files": [{"path": cfg["file"], "text": src[sid]}], "origin": sid})
            for name, sid, level, seed in cfg["copies"]:
                expected = run_with_input(src[sid], lang, inp, wd)
                for attempt in range(40):
                    code, ops = disguise(src[sid], lang, level=level, rng=random.Random(seed + 1000 * attempt), exclude=OUTPUT_CHANGING)
                    if lang == "java":
                        code = code.replace("public class " + code.split("public class ")[1].split()[0], "public class Main", 1) \
                            if "public class " in code else code
                    got = run_with_input(code, lang, inp, wd)
                    if got == expected and code != src[sid]:
                        break
                else:
                    raise SystemExit(f"could not make a working copy for {name}")
                subs.append({"name": name, "files": [{"path": cfg["file"], "text": code}], "origin": sid,
                             "copied_from": sid, "level": level, "ops": ops})
                print(f"{lang:6} {name:16} <- {sid} L{level}: {', '.join(ops)}")
            # deterministic, alphabetical order (like a real export)
            subs.sort(key=lambda s: s["name"])
            for i, s in enumerate(subs):
                s["id"] = f"s{i}"
            by_origin = {}
            for s in subs:
                by_origin.setdefault(s["origin"], []).append(s["name"])
            truth = [names for names in by_origin.values() if len(names) > 1]
            entry = {"title": cfg["title"], "course": cfg["course"], "language": lang, "submissions": [
                {"id": s["id"], "name": s["name"], "files": s["files"]} for s in subs], "truth": truth,
                "note": "Example data: fictional students. Three submissions are disguised copies."}
            if cfg.get("starter"):
                entry["starter"] = [{"path": "Main.java", "text": open(os.path.join(base, cfg["starter"])).read()}]
            out[lang] = entry
            for s in subs:
                d = os.path.join(base, "class", s["name"].replace(" ", "_"))
                os.makedirs(d, exist_ok=True)
                open(os.path.join(d, cfg["file"]), "w").write(s["files"][0]["text"])
    json.dump(out, open(os.path.join(ROOT, "samples", "samples.json"), "w"), indent=1)
    print("wrote samples/samples.json")


if __name__ == "__main__":
    main()
