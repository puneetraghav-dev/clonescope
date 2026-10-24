"""Step 6 - learn how to combine the signals into one suspicion score.

Fits a logistic regression on the *validation* pairs (never on test or IR-Plag):
  positives  original vs. its disguised copy (levels L1-L6 + random)
  negatives  independent solutions of the same task + programs of different tasks
Writes model/fusion.json, which the browser engine (engine/fusion.js) reads.

    python training/fit_fusion.py
"""
from __future__ import annotations

import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score

FULL = ["neural", "wJaccard", "wContainment", "gstAvg", "gstMax", "lenRatio", "litShare"]
CLASSIC = ["wJaccard", "wContainment", "gstAvg", "gstMax", "lenRatio", "litShare"]


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8")]


def fit(rows, feats):
    X = np.array([[r[f] for f in feats] for r in rows], dtype=np.float64)
    y = np.array([r["label"] for r in rows])
    # weight same-task negatives up: they are the realistic case in a class where everyone
    # solves the same assignment
    w = np.array([3.0 if r["level"] == "same-task" else 1.0 for r in rows])
    w[y == 1] *= (w[y == 0].sum() / w[y == 1].sum())
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    lr = LogisticRegression(C=1.0, max_iter=2000)
    lr.fit(Z, y, sample_weight=w)
    p = lr.predict_proba(Z)[:, 1]
    # threshold: best F1 on the realistic subset (positives vs same-task negatives)
    real = np.array([r["level"] != "different-task" for r in rows])
    # threshold: best balanced accuracy (Youden's J = TPR - FPR) on the realistic subset
    # (copies vs same-task solutions). Both classes count equally, whatever their sizes.
    # Validation is almost separable, so many thresholds tie; the middle of the tie keeps the
    # largest safety margin on both sides.
    grid = np.linspace(0.05, 0.95, 181)
    yr, pr = y[real], p[real]
    js = np.array([np.mean(pr[yr == 1] >= t) - np.mean(pr[yr == 0] >= t) for t in grid])
    plateau = grid[js >= js.max() - 1e-3]
    best_t = float(np.median(plateau))
    best_f1 = float(f1_score(yr, pr >= best_t))
    model = {"features": feats, "mean": mu.round(6).tolist(), "std": sd.round(6).tolist(),
             "weights": lr.coef_[0].round(6).tolist(), "bias": round(float(lr.intercept_[0]), 6),
             "threshold": round(best_t, 3),
             "val": {"auc": round(float(roc_auc_score(y, p)), 5),
                     "auc_same_task": round(float(roc_auc_score(y[real], p[real])), 5),
                     "best_f1_same_task": round(float(best_f1), 5), "n": int(len(y))}}
    return model


def main():
    rows = load("results/features_val.jsonl")
    has_neural = any(r["neural"] != 0 for r in rows)
    full = fit(rows, FULL) if has_neural else None
    classic = fit(rows, CLASSIC)
    out = {"full": full or classic, "classic": classic,
           "threshold": (full or classic)["threshold"],
           "note": "Logistic regression on standardized features; fitted on synthetic validation pairs."}
    json.dump(out, open("model/fusion.json", "w"), indent=1)
    for name, m in (("full", full), ("classic", classic)):
        if m:
            print(name, "weights", dict(zip(m["features"], m["weights"])), "threshold", m["threshold"], m["val"])


if __name__ == "__main__":
    main()
