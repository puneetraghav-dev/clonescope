"""Step 4 - train the Siamese code encoder (PyTorch).

The encoder maps a program's normalized token sequence to a 128-d unit vector
("embedding"). Two programs are compared by the cosine of their embeddings.
Both programs go through the *same* network - that is what makes it Siamese.

Architecture (small enough to run in a browser):
  token embedding (64) -> 4 dilated 1-D convolutions (96 ch, kernel 3, dilation 1/2/4/8,
  residual) -> mean + max pooling over the program -> linear 192->128 -> L2 normalise

Training signal (contrastive, InfoNCE / NT-Xent):
  * positive pair  = two disguised versions of the same program (made by obfuscator/)
  * negatives      = every other program in the batch, including *independent solutions
                     of the same task* (hard negatives from Rosetta Code)

    python training/train_encoder.py --epochs 30
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

DATA = "data/corpus"
VIEW_WEIGHTS = {"O": 0.7, "L1": 0.3, "L2": 0.4, "L3": 1.0, "L4": 1.4, "L5": 2.0, "L6": 2.4, "R1": 2.0, "R2": 2.0}


class CodeEncoder(nn.Module):
    def __init__(self, vocab_size: int, emb: int = 64, channels: int = 96, kernel: int = 3,
                 dilations=(1, 2, 4, 8), out_dim: int = 128):
        super().__init__()
        self.config = dict(vocab_size=vocab_size, emb=emb, channels=channels, kernel=kernel,
                           dilations=list(dilations), out_dim=out_dim)
        self.emb = nn.Embedding(vocab_size, emb, padding_idx=0)
        self.convs = nn.ModuleList()
        cin = emb
        for d in dilations:
            self.convs.append(nn.Conv1d(cin, channels, kernel, dilation=d, padding=d * (kernel - 1) // 2))
            cin = channels
        self.proj = nn.Linear(2 * channels, out_dim)

    def forward(self, ids: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        m = mask.unsqueeze(1)                       # [B,1,T]
        x = self.emb(ids).transpose(1, 2) * m       # [B,E,T]
        for i, conv in enumerate(self.convs):
            y = F.relu(conv(x)) * m
            x = y if i == 0 else x + y              # residual from layer 2 on
        mean = x.sum(2) / m.sum(2).clamp(min=1.0)
        mx = x.masked_fill(m == 0, -1e4).max(2).values
        return F.normalize(self.proj(torch.cat([mean, mx], 1)), dim=1)


# ------------------------------------------------------------------------------------------- data
class Corpus:
    def __init__(self, d=DATA):
        self.tokens = np.fromfile(os.path.join(d, "tokens.bin"), dtype="<u2")
        self.rows = [json.loads(l) for l in open(os.path.join(d, "tokens_index.jsonl"), encoding="utf-8")]
        self.by_id = {r["id"]: r for r in self.rows}
        self.views = defaultdict(dict)  # orig id -> tag -> row
        for r in self.rows:
            self.views[r["orig"]][r["tag"]] = r
        self.near_dup = set()
        self.hard_pairs = []
        tp = os.path.join(d, "task_pairs.jsonl")
        if os.path.exists(tp):
            for l in open(tp):
                p = json.loads(l)
                if p["gst_max"] >= 0.5:
                    self.near_dup.add((p["a"], p["b"]))
                    self.near_dup.add((p["b"], p["a"]))
                else:
                    self.hard_pairs.append((p["a"], p["b"]))

    def ids(self, row) -> np.ndarray:
        return self.tokens[row["offset"]: row["offset"] + row["n"]]

    def originals(self, split):
        return [r for r in self.rows if r["tag"] == "O" and r["split"] == split and r["n"] >= 20]


def batchify(seqs, max_len):
    T = max(1, min(max_len, max(len(s) for s in seqs)))
    ids = np.zeros((len(seqs), T), dtype=np.int64)
    mask = np.zeros((len(seqs), T), dtype=np.float32)
    for i, s in enumerate(seqs):
        s = s[:T]
        ids[i, :len(s)] = s
        mask[i, :len(s)] = 1.0
    return torch.from_numpy(ids), torch.from_numpy(mask)


def crop(seq, max_len, r):
    if len(seq) <= max_len:
        return seq
    start = int(r * (len(seq) - max_len))
    return seq[start:start + max_len]


@torch.no_grad()
def embed_all(model, corpus, rows, max_len=1024, bs=64):
    model.eval()
    out = np.zeros((len(rows), model.config["out_dim"]), dtype=np.float32)
    order = sorted(range(len(rows)), key=lambda i: rows[i]["n"])
    for s in range(0, len(order), bs):
        idx = order[s:s + bs]
        ids, mask = batchify([corpus.ids(rows[i])[:max_len] for i in idx], max_len)
        out[idx] = model(ids, mask).numpy()
    return out


def auc(pos, neg):
    """ROC AUC via the Mann-Whitney statistic."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    allv = np.concatenate([pos, neg])
    ranks = allv.argsort().argsort().astype(np.float64) + 1
    rp = ranks[:len(pos)].sum()
    return (rp - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def evaluate(model, corpus, split="val", seed=0):
    rng = random.Random(seed)
    origs = corpus.originals(split)
    oid = {r["id"]: i for i, r in enumerate(origs)}
    var_rows = [corpus.views[r["id"]][t] for r in origs for t in ("L3", "L4", "L5", "L6") if t in corpus.views[r["id"]]]
    E_o = embed_all(model, corpus, origs)
    E_v = embed_all(model, corpus, var_rows)
    # retrieval: is the original the nearest program (same language) to its disguised copy?
    hits, rr = 0, 0.0
    langs = np.array([r["lang"] for r in origs])
    for k, v in enumerate(var_rows):
        sims = E_o @ E_v[k]
        sims[langs != v["lang"]] = -2
        target = oid[v["orig"]]
        rank = int((sims > sims[target]).sum()) + 1
        hits += rank == 1
        rr += 1.0 / rank
    pos = [float(E_o[oid[v["orig"]]] @ E_v[k]) for k, v in enumerate(var_rows)]
    hard = [float(E_o[oid[a]] @ E_o[oid[b]]) for a, b in corpus.hard_pairs if a in oid and b in oid]
    rnd = []
    by_lang = defaultdict(list)
    for r in origs:
        by_lang[r["lang"]].append(oid[r["id"]])
    for _ in range(4000):
        lang = rng.choice(list(by_lang))
        a, b = rng.sample(by_lang[lang], 2)
        if origs[a]["task"] != origs[b]["task"]:
            rnd.append(float(E_o[a] @ E_o[b]))
    return {"recall@1": hits / max(1, len(var_rows)), "mrr": rr / max(1, len(var_rows)),
            "auc_hard": auc(pos, hard), "auc_random": auc(pos, rnd), "n_pos": len(pos), "n_hard": len(hard),
            "pos_mean": float(np.mean(pos)), "hard_mean": float(np.mean(hard)) if hard else float("nan")}


def make_batches(corpus, train, batch, rng):
    """Batches of original programs. Same-task pairs that are *not* near-duplicates are put in the
    same batch on purpose (hard negatives); no other two programs of one task share a batch."""
    train_ids = {r["id"] for r in train}
    task_of = {r["id"]: (r["lang"], r["task"]) for r in train}
    hp = [(a, b) for a, b in corpus.hard_pairs if a in train_ids and b in train_ids]
    rng.shuffle(hp)
    singles = [r["id"] for r in train]
    rng.shuffle(singles)
    batches, used = [], set()
    cur, cur_tasks = [], set()
    hp_iter = iter(hp)
    s_iter = iter(singles)

    def flush():
        nonlocal cur, cur_tasks
        if len(cur) >= 8:
            batches.append(cur)
        cur, cur_tasks = [], set()

    exhausted_s = False
    while not exhausted_s:
        # roughly 1/3 of each batch comes from hard pairs
        if len(cur) < batch // 3:
            pair = next(hp_iter, None)
            if pair is not None:
                a, b = pair
                t = task_of[a]
                if a not in used and b not in used and t not in cur_tasks:
                    cur += [a, b]
                    used |= {a, b}
                    cur_tasks.add(t)
                continue
        x = next(s_iter, None)
        if x is None:
            exhausted_s = True
            break
        if x in used:
            continue
        t = task_of[x]
        if t in cur_tasks:
            continue
        cur.append(x)
        used.add(x)
        cur_tasks.add(t)
        if len(cur) >= batch:
            flush()
    flush()
    return batches


def sample_views(corpus, oid, rng):
    views = corpus.views[oid]
    tags = [t for t in views if t in VIEW_WEIGHTS]
    w = [VIEW_WEIGHTS[t] for t in tags]
    a = rng.choices(tags, weights=w)[0]
    rest = [t for t in tags if t != a] or tags
    b = rng.choices(rest, weights=[VIEW_WEIGHTS[t] for t in rest])[0]
    return views[a], views[b]


BOUNDARY = None  # token ids that end a statement (';', '}', NEWLINE), set in main()


def augment(seq, rng, donor):
    """Extra token-level noise on top of the source-level disguises: students also
    paste in unrelated lines, delete bits and move statements around."""
    seq = list(seq)
    if len(seq) < 30:
        return np.array(seq, dtype=np.uint16)
    cuts = [i + 1 for i, t in enumerate(seq) if t in BOUNDARY]
    if rng.random() < 0.5 and cuts and len(donor) > 10:            # paste foreign code (padding)
        L = rng.randint(5, min(40, len(donor) - 1))
        s = rng.randrange(0, len(donor) - L)
        at = rng.choice(cuts)
        seq[at:at] = list(donor[s:s + L])
    if rng.random() < 0.3:                                          # delete a small span
        L = rng.randint(3, max(4, len(seq) // 25))
        s = rng.randrange(0, max(1, len(seq) - L))
        del seq[s:s + L]
    if rng.random() < 0.3:                                          # swap two statement chunks
        cuts = [0] + [i + 1 for i, t in enumerate(seq) if t in BOUNDARY] + [len(seq)]
        cuts = sorted(set(cuts))
        if len(cuts) > 4:
            i = rng.randrange(0, len(cuts) - 3)
            j = rng.randrange(i + 1, len(cuts) - 2)
            a, b = seq[cuts[i]:cuts[i + 1]], seq[cuts[j]:cuts[j + 1]]
            seq = seq[:cuts[i]] + b + seq[cuts[i + 1]:cuts[j]] + a + seq[cuts[j + 1]:]
    return np.array(seq, dtype=np.uint16)


def nt_xent(z1, z2, tau):
    z = torch.cat([z1, z2], 0)
    sim = z @ z.t() / tau
    n = z1.shape[0]
    sim.fill_diagonal_(-1e9)
    target = torch.cat([torch.arange(n, 2 * n), torch.arange(0, n)])
    return F.cross_entropy(sim, target)


def export(model, path_prefix, meta):
    tensors, blobs, offset = [], [], 0
    sd = model.state_dict()
    order = ["emb.weight"]
    for i in range(len(model.convs)):
        order += [f"convs.{i}.weight", f"convs.{i}.bias"]
    order += ["proj.weight", "proj.bias"]
    for name in order:
        a = sd[name].detach().cpu().numpy().astype("<f4")
        tensors.append({"name": name, "shape": list(a.shape), "offset": offset, "size": int(a.size)})
        blobs.append(a.ravel())
        offset += a.size
    flat = np.concatenate(blobs)
    flat.tofile(path_prefix + ".bin")
    meta = dict(meta, config=model.config, tensors=tensors, total_floats=int(offset), dtype="float32")
    json.dump(meta, open(path_prefix + ".json", "w"), indent=1)
    torch.save({"state_dict": sd, "config": model.config, "meta": meta}, path_prefix + ".pt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--tau", type=float, default=0.07)
    ap.add_argument("--max_len", type=int, default=512)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--aug", type=float, default=0.6, help="probability of extra token-level noise per view")
    ap.add_argument("--short", type=float, default=0.3, help="probability of training on a short window")
    ap.add_argument("--out", default="model/encoder")
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    corpus = Corpus()
    vocab = json.load(open(os.path.join(DATA, "vocab.json")))
    train = corpus.originals("train")
    global BOUNDARY
    BOUNDARY = {vocab["vocab"].index(t) for t in (";", "}", "NEWLINE")}
    print(f"train originals: {len(train)}  hard pairs: {len(corpus.hard_pairs)}  vocab: {len(vocab['vocab'])}")
    model = CodeEncoder(len(vocab["vocab"]))
    print("parameters:", sum(p.numel() for p in model.parameters()))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps_per_epoch = len(make_batches(corpus, train, args.batch, random.Random(0)))
    total = steps_per_epoch * args.epochs
    warm = min(200, total // 10)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total))))
    best, history = -1.0, []
    t0 = time.time()
    step = 0
    for ep in range(args.epochs):
        model.train()
        batches = make_batches(corpus, train, args.batch, rng)
        losses = []
        for b in batches:
            v1, v2 = [], []
            for oid in b:
                a, c = sample_views(corpus, oid, rng)
                r = rng.random()
                s1, s2 = corpus.ids(a), corpus.ids(c)
                if rng.random() < args.aug:
                    s2 = augment(s2, rng, corpus.ids(rng.choice(train)))
                if rng.random() < args.aug / 2:
                    s1 = augment(s1, rng, corpus.ids(rng.choice(train)))
                # sometimes train on short windows too: many lab programs are only 10-40 lines
                ml = rng.randint(48, 192) if rng.random() < args.short else args.max_len
                v1.append(crop(s1, ml, r))
                v2.append(crop(s2, ml, r))
            i1, m1 = batchify(v1, args.max_len)
            i2, m2 = batchify(v2, args.max_len)
            z1, z2 = model(i1, m1), model(i2, m2)
            loss = nt_xent(z1, z2, args.tau)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()
            step += 1
            losses.append(loss.item())
        val = evaluate(model, corpus, "val")
        # AUC and recall saturate quickly on synthetic data, so the margin between copies and
        # independent same-task solutions breaks ties
        score = val["auc_hard"] + val["recall@1"] + 0.1 * (val["pos_mean"] - val["hard_mean"])
        history.append({"epoch": ep + 1, "loss": float(np.mean(losses)), **val, "time_min": (time.time() - t0) / 60})
        print(json.dumps(history[-1]), flush=True)
        if score > best:
            best = score
            export(model, args.out, {"vocab_hash": vocab["hash"], "epoch": ep + 1, "val": val,
                                     "train_args": vars(args)})
    json.dump(history, open(args.out + "_history.json", "w"), indent=1)
    print("best val score", best, "time", round((time.time() - t0) / 60, 1), "min")


if __name__ == "__main__":
    main()
