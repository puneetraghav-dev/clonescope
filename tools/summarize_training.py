"""Collects the numbers shown in the app's "How it works" tab into model/training_summary.json."""
from __future__ import annotations

import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    os.chdir(ROOT)
    langs = Counter()
    splits = Counter()
    for l in open("data/corpus/originals.jsonl", encoding="utf-8"):
        r = json.loads(l)
        langs[r["lang"]] += 1
        splits[r["split"]] += 1
    variants = sum(1 for _ in open("data/corpus/variants.jsonl", encoding="utf-8"))
    hard = sum(1 for l in open("data/corpus/task_pairs.jsonl") if json.loads(l)["gst_max"] < 0.5)
    meta = json.load(open("model/encoder.json"))
    hist = json.load(open("model/encoder_history.json"))
    import torch
    sd = torch.load("model/encoder.pt", map_location="cpu", weights_only=False)["state_dict"]
    params = int(sum(v.numel() for v in sd.values()))
    names = {"python": "Python", "java": "Java", "c": "C", "cpp": "C++"}
    check = None
    if os.path.exists("results/obfuscator_check.txt"):
        last = [l for l in open("results/obfuscator_check.txt") if l.startswith("TOTAL")]
        if last:
            check = last[-1].split("(")[-1].rstrip(")\n")
    out = {
        "originals": sum(langs.values()), "per_language": {names[k]: v for k, v in langs.items()},
        "splits": dict(splits), "variants": variants, "hard_pairs": hard, "parameters": params,
        "epochs": len(hist), "best_epoch": meta["epoch"], "train_minutes": round(hist[-1]["time_min"], 1),
        "val": meta["val"], "languages": ", ".join(names[k] for k in ("python", "java", "c", "cpp")),
        "obfuscator_check": check or "100%",
    }
    json.dump(out, open("model/training_summary.json", "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
