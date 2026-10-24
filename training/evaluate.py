"""Step 7 - compare CloneScope with standard plagiarism-detection methods.

Methods (all scored on exactly the same pairs):
  Text diff            difflib line similarity (what a plain "diff" sees)
  Token matching       Jaccard of raw token 5-grams, names NOT normalized (naive checker)
  Winnowing            MOSS-style fingerprint containment on normalized tokens
  String tiling        JPlag-style greedy string tiling, average similarity
  Neural encoder       our Siamese CNN, cosine similarity
  CloneScope (fused)   logistic-regression fusion of all signals (engine/fusion.js)

Protocol: every method gets its decision threshold tuned on the synthetic *validation*
pairs (best F1, copies vs. same-task independent solutions); that threshold is then
applied unchanged to the synthetic *test* pairs and to IR-Plag (human-made plagiarism).

    python training/evaluate.py
Outputs results/metrics.json, results/RESULTS.md and results/*.png
"""
from __future__ import annotations

import difflib
import json
import math
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score, roc_curve  # noqa: E402

IRPLAG = os.environ.get("IRPLAG", "../data/irplag_x/IR-Plag-Dataset")
METHODS = [("diff", "Text diff"), ("rawTok", "Token matching"), ("wContainment", "Winnowing (MOSS-style)"),
           ("gstAvg", "String tiling (JPlag-style)"), ("neural", "Neural encoder"), ("fused", "CloneScope (fused)")]
LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6"]
COLORS = {"diff": "#9aa5b1", "rawTok": "#c2a878", "wContainment": "#6c8ebf", "gstAvg": "#5aa39a",
          "neural": "#d08770", "fused": "#b0303f"}


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8")]


def fuse(r, m):
    z = m["bias"]
    for f, w, mu, sd in zip(m["features"], m["weights"], m["mean"], m["std"]):
        z += w * ((r[f] - mu) / (sd or 1))
    return 1 / (1 + math.exp(-z))


def diff_ratio(a: str, b: str) -> float:
    la = [l.strip() for l in a.splitlines() if l.strip()]
    lb = [l.strip() for l in b.splitlines() if l.strip()]
    return difflib.SequenceMatcher(None, la, lb, autojunk=False).ratio()


def attach_diff(rows, code_of):
    for r in rows:
        r["diff"] = diff_ratio(code_of(r["a"]), code_of(r["b"]))


def best_threshold(y, s):
    """Threshold with the best balanced accuracy (Youden's J = TPR - FPR), so both classes count
    equally whatever their sizes. When many thresholds tie (nearly separable data) take the
    middle of the tie."""
    y, s = np.asarray(y), np.asarray(s)
    grid = np.unique(np.concatenate([np.quantile(s, np.linspace(0.005, 0.995, 397)), [0.5]]))
    js = np.array([np.mean(s[y == 1] >= t) - np.mean(s[y == 0] >= t) for t in grid])
    plateau = grid[js >= js.max() - 1e-3]
    return float(np.median(plateau)), float(js.max())


def metrics(y, s, t):
    y, s = np.asarray(y), np.asarray(s)
    pred = s >= t
    tpr = float(np.mean(pred[y == 1])) if (y == 1).any() else float("nan")
    fpr = float(np.mean(pred[y == 0])) if (y == 0).any() else float("nan")
    return {"auc": float(roc_auc_score(y, s)), "ap": float(average_precision_score(y, s)),
            "balanced_accuracy": (tpr + 1 - fpr) / 2, "recall": tpr, "false_positive_rate": fpr,
            "f1": float(f1_score(y, pred, zero_division=0)), "precision": float(precision_score(y, pred, zero_division=0)),
            "threshold": t}


def main():
    fusion = json.load(open("model/fusion.json"))["full"]
    # code lookup for the diff baseline
    codes = {}
    for p in ("data/corpus/originals.jsonl", "data/corpus/variants.jsonl"):
        for l in open(p, encoding="utf-8"):
            r = json.loads(l)
            if r["split"] != "train":
                codes[r["id"]] = r["code"]
    val, test, irp = load("results/features_val.jsonl"), load("results/features_test.jsonl"), load("results/features_irplag.jsonl")
    stress = load("results/features_stress.jsonl") if os.path.exists("results/features_stress.jsonl") else []
    if stress:
        for l in open("data/corpus/stress.jsonl", encoding="utf-8"):
            r = json.loads(l)
            codes[r["id"]] = r["code"]
    attach_diff(val, codes.__getitem__)
    attach_diff(test, codes.__getitem__)
    attach_diff(stress, codes.__getitem__)
    attach_diff(irp, lambda p: open(os.path.join(IRPLAG, p), encoding="utf-8", errors="replace").read())
    for rows in (val, test, irp, stress):
        for r in rows:
            r["fused"] = fuse(r, fusion)

    real = lambda rows: [r for r in rows if r["level"] != "different-task"]  # noqa: E731
    out = {"methods": [], "irplag_counts": {}, "synthetic_counts": {}}
    yv = [r["label"] for r in real(val)]
    for key, name in METHODS:
        t, _ = best_threshold(np.array(yv), np.array([r[key] for r in real(val)]))
        if key == "fused":
            t = fusion["threshold"]
        m = {"key": key, "name": name, "threshold": t}
        yt, st = [r["label"] for r in real(test)], [r[key] for r in real(test)]
        m["synthetic"] = metrics(yt, st, t)
        m["synthetic_all_negatives_auc"] = float(roc_auc_score([r["label"] for r in test], [r[key] for r in test]))
        m["synthetic_levels"] = {L: float(np.mean([r[key] >= t for r in test if r["level"] == L])) for L in LEVELS}
        yi, si = [r["label"] for r in irp], [r[key] for r in irp]
        m["irplag"] = metrics(yi, si, t)
        m["irplag_levels"] = {L: float(np.mean([r[key] >= t for r in irp if r["level"] == L])) for L in LEVELS}
        m["irplag_false_positive_rate"] = float(np.mean([r[key] >= t for r in irp if r["label"] == 0]))
        # within one assignment (how a teacher uses it): AUC per IR-Plag case, averaged
        cases = sorted({r["case"] for r in irp})
        m["irplag_case_auc"] = {c: float(roc_auc_score([r["label"] for r in irp if r["case"] == c],
                                                       [r[key] for r in irp if r["case"] == c])) for c in cases}
        m["irplag_case_auc_mean"] = float(np.mean(list(m["irplag_case_auc"].values())))
        m["irplag_recall_L1_L3"] = float(np.mean([r[key] >= t for r in irp if r["level"] in ("L1", "L2", "L3")]))
        m["irplag_recall_L4_L6"] = float(np.mean([r[key] >= t for r in irp if r["level"] in ("L4", "L5", "L6")]))
        if stress:
            neg = [r[key] for r in stress if r["level"] == "same-task"]
            m["stress_auc"] = {}
            m["stress_recall"] = {}
            for k in (1, 2, 3):
                pos = [r[key] for r in stress if r["level"] == f"S{k}"]
                m["stress_auc"][f"S{k}"] = float(roc_auc_score([1] * len(pos) + [0] * len(neg), pos + neg))
                m["stress_recall"][f"S{k}"] = float(np.mean([x >= t for x in pos]))
        fpr, tpr, _ = roc_curve(yi, si)
        idx = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 60)).astype(int))
        m["irplag_roc"] = [[round(float(fpr[i]), 4), round(float(tpr[i]), 4)] for i in idx]
        out["methods"].append(m)
    out["irplag_counts"] = {"pairs": len(irp), "plagiarized": sum(r["label"] for r in irp),
                            "independent": sum(1 - r["label"] for r in irp)}
    out["synthetic_counts"] = {"pairs": len(test), "copies": sum(r["label"] for r in test),
                               "same_task": sum(r["level"] == "same-task" for r in test),
                               "different_task": sum(r["level"] == "different-task" for r in test)}
    out["recalibrated"] = recalibrate(irp)
    if stress:
        out["stress_counts"] = {f"S{k}": sum(r["level"] == f"S{k}" for r in stress) for k in (1, 2, 3)}
    json.dump(out, open("results/metrics.json", "w"), indent=1)
    plots(out, irp, test)
    write_md(out)
    for m in out["methods"]:
        print(f"{m['name']:28} t={m['threshold']:.3f} synth AUC {m['synthetic']['auc']:.3f} BA {m['synthetic']['balanced_accuracy']:.3f} | "
              f"IR-Plag AUC {m['irplag']['auc']:.3f} (per-task {m['irplag_case_auc_mean']:.3f}) BA {m['irplag']['balanced_accuracy']:.3f} "
              f"R {m['irplag']['recall']:.3f} FPR {m['irplag_false_positive_rate']:.3f} "
              f"| stress S3 AUC {m.get('stress_auc', {}).get('S3', float('nan')):.4f} recall {m.get('stress_recall', {}).get('S3', float('nan')):.3f}")
    print("recalibrated", out["recalibrated"])


def recalibrate(irp):
    """Leave-one-task-out: fit the fusion weights on 6 IR-Plag tasks, score the 7th, repeat.
    Shows what a college gains by recalibrating CloneScope on its own labelled cases."""
    from sklearn.linear_model import LogisticRegression
    feats = ["neural", "wJaccard", "wContainment", "gstAvg", "gstMax", "lenRatio", "litShare"]
    cases = sorted({r["case"] for r in irp})
    scores = np.zeros(len(irp))
    for c in cases:
        tr = [r for r in irp if r["case"] != c]
        te = [i for i, r in enumerate(irp) if r["case"] == c]
        X = np.array([[r[f] for f in feats] for r in tr])
        mu, sd = X.mean(0), X.std(0) + 1e-9
        lr = LogisticRegression(C=1.0, max_iter=3000, class_weight="balanced").fit((X - mu) / sd, [r["label"] for r in tr])
        Xt = np.array([[irp[i][f] for f in feats] for i in te])
        scores[te] = lr.predict_proba((Xt - mu) / sd)[:, 1]
    y = [r["label"] for r in irp]
    per = [roc_auc_score([r["label"] for r in irp if r["case"] == c], [scores[i] for i, r in enumerate(irp) if r["case"] == c])
           for c in cases]
    return {"features": feats, "auc": float(roc_auc_score(y, scores)), "case_auc_mean": float(np.mean(per)),
            "protocol": "leave-one-task-out logistic regression on IR-Plag"}


def plots(out, irp, test):
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(1, 2, figsize=(11, 4.6))
    for m in out["methods"]:
        for k, (rows, title) in enumerate(((irp, "IR-Plag (human-made plagiarism, Java)"),
                                           ([r for r in test if r["level"] != "different-task"],
                                            "Synthetic test (copies vs. same-task solutions)"))):
            y = [r["label"] for r in rows]
            s = [r[m["key"]] for r in rows]
            fpr, tpr, _ = roc_curve(y, s)
            a = roc_auc_score(y, s)
            ax[k].plot(fpr, tpr, color=COLORS[m["key"]], lw=2.4 if m["key"] == "fused" else 1.4,
                       label=f"{m['name']} (AUC {a:.3f})")
            ax[k].set_title(title)
    for a in ax:
        a.plot([0, 1], [0, 1], ls=":", color="#999")
        a.set_xlabel("False positive rate")
        a.set_ylabel("True positive rate")
        a.legend(fontsize=8, loc="lower right", frameon=False)
    fig.tight_layout()
    fig.savefig("results/roc.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(1, 2, figsize=(11, 4.2), sharey=True)
    w = 0.13
    for k, (key, title) in enumerate((("irplag_levels", "IR-Plag: copies caught per level"),
                                      ("synthetic_levels", "Synthetic test: copies caught per level"))):
        for j, m in enumerate(out["methods"]):
            xs = np.arange(len(LEVELS)) + (j - 2.5) * w
            ax[k].bar(xs, [m[key][L] for L in LEVELS], width=w, color=COLORS[m["key"]], label=m["name"])
        ax[k].set_xticks(range(len(LEVELS)), LEVELS)
        ax[k].set_title(title)
        ax[k].set_ylim(0, 1.05)
        ax[k].set_xlabel("Plagiarism level (Faidhi & Robinson)")
    ax[0].set_ylabel("Recall at validation threshold")
    h, lab = ax[0].get_legend_handles_labels()
    fig.legend(h, lab, loc="lower center", ncol=6, fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig("results/recall_by_level.png", dpi=150)
    plt.close(fig)

    if out["methods"][0].get("stress_auc"):
        fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
        xs = [1, 2, 3]
        for m in out["methods"]:
            kw = dict(marker="o", color=COLORS[m["key"]], lw=2.6 if m["key"] == "fused" else 1.4, label=m["name"])
            ax[0].plot(xs, [m["stress_auc"][f"S{k}"] for k in xs], **kw)
            ax[1].plot(xs, [m["stress_recall"][f"S{k}"] for k in xs], **kw)
        for a in ax:
            a.set_xticks(xs, ["L6 once", "L6 twice", "L6 three times"])
            a.set_xlabel("Disguise applied")
        ax[0].set_ylabel("AUC vs same-task solutions")
        ax[0].set_title("Ranking quality")
        ax[1].set_ylabel("Copies caught at validation threshold")
        ax[1].set_title("Copies caught")
        ax[1].set_ylim(0, 1.02)
        h, lab = ax[0].get_legend_handles_labels()
        fig.legend(h, lab, loc="lower center", ncol=6, fontsize=8, frameon=False)
        fig.suptitle("Stacked disguises (synthetic test)", fontsize=11)
        fig.tight_layout(rect=(0, 0.07, 1, 1))
        fig.savefig("results/stress.png", dpi=150)
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 3.6))
    pos = [r["fused"] for r in irp if r["label"] == 1]
    neg = [r["fused"] for r in irp if r["label"] == 0]
    bins = np.linspace(0, 1, 26)
    ax.hist(neg, bins=bins, alpha=0.75, color="#6c8ebf", label="Independent solutions")
    ax.hist(pos, bins=bins, alpha=0.75, color="#b0303f", label="Plagiarized (L1-L6)")
    t = next(m for m in out["methods"] if m["key"] == "fused")["threshold"]
    ax.axvline(t, color="#333", ls="--", lw=1)
    ax.text(t + 0.01, ax.get_ylim()[1] * 0.92, "threshold", fontsize=8)
    ax.set_xlabel("CloneScope suspicion score")
    ax.set_ylabel("Pairs")
    ax.set_title("IR-Plag score distribution")
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig("results/score_distribution.png", dpi=150)
    plt.close(fig)


def write_md(out):
    L = ["# Evaluation results", "",
         f"IR-Plag: {out['irplag_counts']['pairs']} pairs ({out['irplag_counts']['plagiarized']} plagiarized, "
         f"{out['irplag_counts']['independent']} independent). Synthetic test: {out['synthetic_counts']['copies']} copies, "
         f"{out['synthetic_counts']['same_task']} same-task and {out['synthetic_counts']['different_task']} different-task negatives.",
         "", "Thresholds tuned on synthetic validation only.", "",
         "| Method | Synthetic AUC | Synthetic balanced acc. | IR-Plag AUC | IR-Plag AUC per task | IR-Plag balanced acc. | IR-Plag recall | IR-Plag false alarms |",
         "|---|---|---|---|---|---|---|---|"]
    for m in out["methods"]:
        s, i = m["synthetic"], m["irplag"]
        L.append(f"| {m['name']} | {s['auc']:.3f} | {s['balanced_accuracy']:.3f} | {i['auc']:.3f} | {m['irplag_case_auc_mean']:.3f} | "
                 f"{i['balanced_accuracy']:.3f} | {i['recall']:.3f} | {i['false_positive_rate']:.3f} |")
    L += ["", "## Recall per plagiarism level (IR-Plag)", "", "| Method | " + " | ".join(LEVELS) + " |",
          "|---|" + "---|" * len(LEVELS)]
    for m in out["methods"]:
        L.append(f"| {m['name']} | " + " | ".join(f"{m['irplag_levels'][x]:.2f}" for x in LEVELS) + " |")
    if out["methods"][0].get("stress_auc"):
        L += ["", "## Stacked disguises (synthetic test, level 6 applied 1-3 times; AUC vs same-task solutions)", "",
              "| Method | 1 round | 2 rounds | 3 rounds | recall after 3 rounds |", "|---|---|---|---|---|"]
        for m in out["methods"]:
            a = m["stress_auc"]
            L.append(f"| {m['name']} | {a['S1']:.4f} | {a['S2']:.4f} | {a['S3']:.4f} | {m['stress_recall']['S3']:.3f} |")
    rc = out.get("recalibrated")
    if rc:
        L += ["", f"Recalibrated fusion ({rc['protocol']}): IR-Plag AUC {rc['auc']:.3f}, per-task AUC {rc['case_auc_mean']:.3f}."]
    open("results/RESULTS.md", "w").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
