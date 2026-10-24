# Evaluation results

IR-Plag: 460 pairs (355 plagiarized, 105 independent). Synthetic test: 7864 copies, 198 same-task and 3000 different-task negatives.

Thresholds tuned on synthetic validation only.

| Method | Synthetic AUC | Synthetic balanced acc. | IR-Plag AUC | IR-Plag AUC per task | IR-Plag balanced acc. | IR-Plag recall | IR-Plag false alarms |
|---|---|---|---|---|---|---|---|
| Text diff | 0.884 | 0.800 | 0.653 | 0.648 | 0.492 | 0.899 | 0.914 |
| Token matching | 0.989 | 0.942 | 0.622 | 0.641 | 0.510 | 1.000 | 0.981 |
| Winnowing (MOSS-style) | 1.000 | 0.994 | 0.681 | 0.680 | 0.561 | 0.885 | 0.762 |
| String tiling (JPlag-style) | 1.000 | 0.999 | 0.705 | 0.681 | 0.558 | 0.944 | 0.829 |
| Neural encoder | 1.000 | 0.996 | 0.629 | 0.648 | 0.530 | 0.659 | 0.600 |
| CloneScope (fused) | 1.000 | 0.999 | 0.705 | 0.685 | 0.567 | 0.952 | 0.819 |

## Recall per plagiarism level (IR-Plag)

| Method | L1 | L2 | L3 | L4 | L5 | L6 |
|---|---|---|---|---|---|---|
| Text diff | 1.00 | 0.98 | 0.95 | 0.83 | 0.83 | 0.81 |
| Token matching | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| Winnowing (MOSS-style) | 1.00 | 1.00 | 0.98 | 0.92 | 0.80 | 0.63 |
| String tiling (JPlag-style) | 1.00 | 1.00 | 1.00 | 0.98 | 0.90 | 0.79 |
| Neural encoder | 1.00 | 0.98 | 0.96 | 0.48 | 0.32 | 0.25 |
| CloneScope (fused) | 1.00 | 1.00 | 1.00 | 0.97 | 0.95 | 0.81 |

## Stacked disguises (synthetic test, level 6 applied 1-3 times; AUC vs same-task solutions)

| Method | 1 round | 2 rounds | 3 rounds | recall after 3 rounds |
|---|---|---|---|---|
| Text diff | 0.7910 | 0.7518 | 0.6986 | 0.458 |
| Token matching | 0.9728 | 0.9376 | 0.9141 | 0.562 |
| Winnowing (MOSS-style) | 0.9982 | 0.9961 | 0.9928 | 0.810 |
| String tiling (JPlag-style) | 0.9996 | 0.9966 | 0.9911 | 0.802 |
| Neural encoder | 0.9999 | 0.9990 | 0.9978 | 0.838 |
| CloneScope (fused) | 0.9999 | 0.9992 | 0.9977 | 0.917 |

Recalibrated fusion (leave-one-task-out logistic regression on IR-Plag): IR-Plag AUC 0.728, per-task AUC 0.769.
