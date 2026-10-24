"""Step 5b - add the neural similarity to every evaluation pair (batched PyTorch).

Reads results/features_{val,test,irplag}.jsonl written by extract_features.mjs, embeds each
program once with the trained encoder (first 2048 tokens, exactly like engine/model.js) and
writes the cosine similarity into the `neural` field. Also writes model/parity.json: a few
programs with their PyTorch embeddings, which tests/engine.test.mjs compares with the
JavaScript encoder.

    python training/embed_pairs.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_encoder import CodeEncoder, Corpus, embed_all  # noqa: E402

MAX_LEN = 2048


def load_model(prefix="model/encoder"):
    ck = torch.load(prefix + ".pt", map_location="cpu", weights_only=False)
    cfg = ck["config"]
    m = CodeEncoder(cfg["vocab_size"], cfg["emb"], cfg["channels"], cfg["kernel"], cfg["dilations"], cfg["out_dim"])
    m.load_state_dict(ck["state_dict"])
    m.eval()
    return m


class Ids:
    """Minimal object with .ids(row) so embed_all can be reused for any token lists."""

    def __init__(self, seqs):
        self.seqs = seqs

    def ids(self, row):
        return self.seqs[row["key"]]


def main():
    torch.set_num_threads(os.cpu_count() or 2)
    model = load_model()
    corpus = Corpus()
    extra = json.load(open("results/irplag_ids.json"))
    if os.path.exists("results/stress_ids.json"):
        extra.update(json.load(open("results/stress_ids.json")))
    splits = [s for s in ("val", "test", "irplag", "stress") if os.path.exists(f"results/features_{s}.jsonl")]
    seqs = {}
    for split in splits:
        for l in open(f"results/features_{split}.jsonl"):
            r = json.loads(l)
            for k in (r["a"], r["b"]):
                if k in seqs:
                    continue
                if k in extra:
                    seqs[k] = np.array(extra[k], dtype=np.int64)[:MAX_LEN]
                else:
                    seqs[k] = corpus.ids(corpus.by_id[k]).astype(np.int64)[:MAX_LEN]
    keys = sorted(seqs)
    rows = [{"key": k, "n": len(seqs[k])} for k in keys]
    E = embed_all(model, Ids(seqs), rows, max_len=MAX_LEN)
    emb = {k: E[i] for i, k in enumerate(keys)}
    for split in splits:
        path = f"results/features_{split}.jsonl"
        out = []
        for l in open(path):
            r = json.loads(l)
            r["neural"] = round(float(emb[r["a"]] @ emb[r["b"]]), 5)
            out.append(json.dumps(r))
        open(path, "w").write("\n".join(out) + "\n")
        print(split, len(out), "pairs updated")
    # parity cases for the JS test (short, medium, long program)
    picks = [k for k in keys if len(seqs[k]) >= 20]
    picks = sorted(picks, key=lambda k: len(seqs[k]))
    chosen = [picks[0], picks[len(picks) // 2], picks[-1]]
    cases = [{"key": k, "ids": seqs[k].tolist(), "embedding": [round(float(x), 7) for x in emb[k]]} for k in chosen]
    json.dump({"note": "PyTorch embeddings for tests/engine.test.mjs", "cases": cases}, open("model/parity.json", "w"))
    print("parity cases:", [len(c["ids"]) for c in cases])


if __name__ == "__main__":
    main()
