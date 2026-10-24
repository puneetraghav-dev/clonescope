# How CloneScope works: a plain-English walkthrough

This guide explains every part of CloneScope: what it does, why each piece exists, how the AI was trained and tested, and which file does what. The last section lists questions examiners are likely to ask in a viva, with answers.

---

## 1. The problem

In a programming lab, everyone solves the same assignment. Some students copy a friend's (or a senior's, or a website's) solution and then **disguise** it so the teacher won't notice. Common tricks:

| Level | What the student changes | Example |
|---|---|---|
| L1 | Comments, indentation, blank lines, brace style | `// calc sum` → `/* add up */` |
| L2 | Renames variables and functions | `total` → `sum1`, `getGrade` → `findGrade` |
| L3 | Changes declarations | `int a = 0, b = 1;` → `int a = 0;` `int b = 1;` |
| L4 | Moves functions and independent statements around | `average()` moved above `main()` |
| L5 | Rewrites statements | `for` → `while`, `i++` → `i += 1`, list comprehension → loop |
| L6 | Changes logic and pads the code | flips `if/else`, adds unused variables, extra parentheses, rewords output messages |

These six levels come from Faidhi & Robinson (1987), the standard way plagiarism research describes disguises.

A plain text comparison (like `diff`) is fooled by L1 and L2 already. Tools such as Stanford's **MOSS** and **JPlag** compare program *structure* instead of text, which handles L1–L3 well, but they are weaker at L4–L6. CloneScope combines their ideas with a **neural network** trained to recognise the same logic after rewrites, plus one more signal teachers rely on: copied output messages.

---

## 2. The big idea

Compare **what the code does structurally**, not how it looks.

CloneScope turns every submission into a sequence of *normalized tokens*, compares every pair of students with four independent signals, combines the signals into one **suspicion score** (0–100), and then **explains** the score by showing the matching code side by side and naming the disguises it found.

```
submissions ─▶ 1 normalize ─▶ 2 fingerprints ─┐
                         ├──▶ 3 tiling ───────┤
                         ├──▶ 4 neural model ─┼─▶ 6 fuse into one score ─▶ 7 explain, group, report
                         └──▶ 5 shared text ──┘
```

Everything runs **inside the browser** (JavaScript). Student code is never uploaded anywhere, which matters for privacy.

---

## 3. The pipeline, step by step

### Step 1 – Normalize (engine/tokenizer.js)

The tokenizer reads Python, Java, C and C++ and produces tokens, with these rules:

* comments, whitespace, blank lines and Python docstrings are thrown away;
* `#include`, `import` and `package` lines are thrown away (every student has them);
* every user-defined name becomes `ID`;
* every number becomes `NUM`, every string `STR`, every character `CHR`;
* keywords (`for`, `while`, `if`, `return`…), operators and well-known library names (`printf`, `System.out.println`, `len`, `range`, `cout`…) are kept as they are;
* Python indentation becomes `INDENT` / `DEDENT` / `NEWLINE` tokens, so a Python block looks like a `{ … }` block.

```
total += marks[i]      ──▶   ID += ID [ ID ]
sum1  += scores[k]     ──▶   ID += ID [ ID ]      (identical, so renaming hides nothing)
```

A subtle point: library names are kept only where they are actually used as library calls. A student variable called `sum` is still just `ID`, but the call `sum(marks)` keeps the token `sum`.

The same tokenizer file is used by the website **and** by the training pipeline (through Node.js). So the neural model is trained on exactly the tokens it later sees in the app. Engineers call this avoiding "training/serving skew".

### Step 2 – Fingerprints with winnowing (engine/winnow.js)

This is the algorithm behind MOSS (Schleimer, Wilkerson & Aiken, 2003).

1. Take every run of *k* = 6 consecutive tokens (a "k-gram") and hash it to a number.
2. Slide a window of *w* = 4 hashes over the list and keep the smallest hash in each window. The kept hashes are the program's **fingerprints**.
3. Two programs that share code share fingerprints. Winnowing guarantees that any shared run of at least *k + w − 1* = 9 tokens produces at least one shared fingerprint.

Signal: **fingerprint containment** = shared fingerprints ÷ fingerprints of the smaller program.

### Step 3 – Greedy String Tiling (engine/gst.js)

This is the matching algorithm used by JPlag (Wise, 1993). It finds the **longest common runs of tokens** ("tiles") between two programs, longest first, without letting tiles overlap. Because tiles can appear in any order, moving functions around (L4) does not hide them. A hash index of 8-token windows keeps it fast.

Signals: **coverage** = share of the tokens that lie inside tiles, for each program. The tiles are also what the app highlights in matching colours in the side-by-side view.

### Step 4 – The neural network (engine/model.js, training/train_encoder.py)

Steps 2 and 3 need *exact* runs of tokens. When a student rewrites a `for` loop as a `while` loop or adds dead code every few lines, the exact runs break into small pieces. The neural network is trained to look past that.

**Architecture: a Siamese encoder.** "Siamese" means both programs go through the *same* network, and we compare the outputs:

```
tokens ─▶ embedding (64 numbers per token)
       ─▶ 4 × [1-D convolution, 96 channels, kernel 3, dilation 1 / 2 / 4 / 8, ReLU, residual]
       ─▶ average and maximum over the whole program (192 numbers)
       ─▶ linear layer ─▶ 128 numbers, scaled to length 1  =  the program's "embedding"
similarity = cosine(embedding A, embedding B)      (1 = same, 0 = unrelated)
```

* Convolutions look at short neighbourhoods of tokens, like a statement. Dilation (skipping 1, 2, 4, 8 positions) widens the view to about 30 tokens without making the network big.
* Average and max pooling turn a program of any length into a fixed-size vector, and they don't care where in the file a pattern appears, which helps with reordering.
* The network has about 170,000 parameters. That is small enough to run in a web page in plain JavaScript, with no GPU and no server.

How it was trained is explained in section 4.

### Step 5 – Shared unusual text (engine/analyze.js: `literalSet`, `literalShare`)

Students who copy usually keep the **output messages and constants**: the same prompt `"Enter the no. of elements :"`, the same odd constant `0.12`. Normalization throws these away (they become `STR`/`NUM`), so CloneScope collects them separately:

* trivial literals are ignored (single digits, `"%d\n"`, `", "`, grade letters);
* in a class of 6 or more students, any literal used by at least 40% of the class is ignored too, because the assignment probably asked for that exact text;
* literals in the teacher's starter code are ignored.

Signal: **shared literals** = shared ÷ (all + 1). The "+1" means sharing a single literal counts as only a weak hint.

### Step 6 – Fusion into one score (engine/fusion.js, training/fit_fusion.py)

The signals are combined by **logistic regression**, the simplest trainable classifier. It learns one weight per signal:

```
z = bias + w1·neural + w2·fingerprints + w3·fingerprint_jaccard + w4·tiling_avg + w5·tiling_max
    + w6·length_difference + w7·shared_literals          (each signal standardized first)
suspicion score = 1 / (1 + e^(−z))                         (between 0 and 1, shown as 0–100)
```

The weights and the default threshold were fitted on **validation data only** (never on test data). The fitted weights (on standardized signals) are: neural 3.34, tiling max 2.28, tiling average 1.93, fingerprint containment 1.11, shared literals 0.28, fingerprint Jaccard 0.17, length difference −0.76. So the neural similarity and the tiling coverage carry most of the decision, and very different program lengths count against copying.

The threshold (0.597, shown as **60** in the app) was chosen for the best **balanced accuracy** between copies and *independent solutions of the same task*, the realistic hard case. Balanced accuracy is the average of "copies caught" and "honest pairs cleared", so both classes count equally even though the validation set has far more copies. Many thresholds tie on validation data, so the middle of the tie was taken.

### Step 7 – Explanations, groups and reports (engine/explain.js)

For a flagged pair the app explains **what** was disguised:

* **Renamed variables**: inside matching tiles, it compares the actual names (`total` in A vs `sum1` in B) and lists the renames.
* **Same unusual text**: the shared rare messages and constants.
* **Code moved around**: if the tiles appear in a different order in the two files (worked out with a longest-increasing-subsequence check).
* **Loops rewritten / counters rewritten / conditions flipped**: looks at the small gaps between matching tiles, e.g. `for` on one side and `while` on the other.
* **Extra code added**: lines in one file with no counterpart, while the other file is almost fully matched (padding).
* **Comments / formatting changed**: noted, and the app explains that these are ignored anyway.

**Copy groups**: students are nodes, flagged pairs are edges, and every connected component is a group ("these 5 students share one source"). **Class context**: each pair is ranked against all pairs in the class, because in a class where everyone solved the same small task, some similarity is normal.

**Starter code**: if the teacher gave a template, it is tokenized and every submission's tokens that match it (tiling again) are removed before comparing, so shared starter code never counts as copying.

---

## 4. How the AI was trained (self-supervised learning)

The difficulty with plagiarism detection is that **nobody has thousands of labelled "copied / not copied" examples**. CloneScope makes its own labels.

### 4.1 Real programs

* **Rosetta Code**: about 1,300–1,650 programming tasks, each solved *several times by different people* in Python, Java, C and C++.
* **TheAlgorithms** (MIT licence): thousands of classic algorithm implementations.

After filtering (the file must parse, 6–400 non-empty lines) and removing duplicates, 9,823 programs (3,271 Python, 2,720 Java, 1,991 C++ and 1,841 C) programs remained. They were split **by task** into train (80%), validation (10%) and test (10%), so no task appears in two splits.

### 4.2 The disguise generator (training/obfuscator/)

A program-rewriting tool built on **tree-sitter** (a real parser for all four languages) disguises code the way students do, at levels L1–L6: removing or adding comments, re-indenting, moving braces, renaming identifiers consistently, splitting/merging declarations, reordering functions and independent statements, `for` ⇄ `while`, `i++` ⇄ `i += 1` ⇄ `i = i + 1`, `x += y` ⇄ `x = x + y`, `a < b` ⇄ `b > a`, list comprehension ⇄ loop, for-each ⇄ index loop, flipping `if/else` with a negated condition, inserting dead code and unused helper functions, extracting temporary variables, adding parentheses, and rewording output messages.

After every single change the result is re-parsed. If it no longer parses (Python is also checked with Python's own compiler), the change is thrown away.

**Proof that the disguises keep programs working**: `tests/check_obfuscator.py` applies every operation 25 times to test programs in all four languages and compiles and runs each result. All 2,461 disguised test programs compile and run, and all 2,425 made by output-preserving operations print exactly the same output as the original (`results/obfuscator_check.txt`). Rewording messages is the one operation meant to change the output; for it the test only checks that the program still compiles and runs.

For every original program, 8 disguised copies were generated (one per level plus two random), 78,584 copies in total.

### 4.3 Labels for free

* **Positive pairs (copied)**: an original and its disguised copy, or two disguised copies of the same original. They are copies by construction.
* **Negative pairs (not copied)**: any two different programs. The most valuable negatives are **two different people's solutions to the same Rosetta Code task**: same problem, honestly written, which is exactly the hard case in a classroom. 2,069 such pairs were used. Solution pairs that are near-duplicates (probably one author's two versions) were excluded, because they would be wrong labels.

### 4.4 Contrastive training (InfoNCE / NT-Xent)

Each training step takes a batch of 128 programs. About a third of each batch is made of same-task pairs on purpose. For every program the trainer picks **two different disguised versions** ("views"), runs all 256 views through the network, and uses the **NT-Xent loss** (the one from SimCLR):

> For each view, make its similarity to *its own other view* high, and its similarity to the 254 other views in the batch low.

Because same-task solutions sit in the same batch, the network is forced to tell "the same program, disguised" apart from "a different program for the same task".

Extra noise during training, so the model doesn't overfit to the generator's habits:

* with probability 0.6, a few lines of unrelated code are pasted in, a small span is deleted or two statements are swapped (at the token level);
* 30% of the time the network sees only a short window (48–192 tokens), because many lab programs are tiny.

Settings: AdamW optimizer, learning rate 0.002 with warm-up and cosine decay, temperature 0.07, 20 epochs, about 30 minutes on a 2-core CPU (no GPU). The checkpoint with the best validation score was kept (epoch 12). On validation data, a disguised copy finds its own original as the nearest program 99.95% of the time. The average cosine similarity is 0.98 for copies and 0.27 for different people's solutions to the same task.

### 4.5 From PyTorch to the browser

The trained weights are exported as one flat array of float32 numbers (`model/encoder.bin`) plus a description of the tensor shapes (`model/encoder.json`). `engine/model.js` re-implements the forward pass in plain JavaScript: embedding lookup, convolutions, ReLU, residual sums, pooling, linear layer, normalisation. The automated test `tests/engine.test.mjs` checks that JavaScript and PyTorch produce the same embeddings to within 0.0001.

---

## 5. How it was tested

### 5.1 Two test sets

1. **Synthetic test set**: held-out Rosetta Code tasks the model never saw, with disguised copies at every level, independent same-task solutions and random different-task pairs.
2. **IR-Plag** (Karnalim et al., *Informatics in Education*, 2019; Apache-2.0 licence): 467 Java files for 7 introductory tasks. For each task there is one original, 15 solutions written *independently* by other students, and about 50 files that people **plagiarized by hand** at levels L1–L6. This is real human behaviour, not our generator, and CloneScope never trained on it.

### 5.2 Fair comparison

Every method scores exactly the same pairs:

| Method | What it is |
|---|---|
| Text diff | Python `difflib` line similarity: what a plain diff sees |
| Token matching | overlap of raw 5-token sequences, names **not** normalized: a naive checker |
| Winnowing (MOSS-style) | step 2 alone |
| String tiling (JPlag-style) | step 3 alone |
| Neural encoder | step 4 alone |
| **CloneScope (fused)** | all signals combined |

Each method's decision threshold was tuned on the **validation** set, then applied unchanged to the test sets. Nothing was tuned on IR-Plag.

Metrics: **AUC** (the probability that a random copied pair scores higher than a random honest pair; 1.0 is perfect, 0.5 is guessing), **precision** (of the flagged pairs, how many were really copied), **recall** (of the copied pairs, how many were flagged) and **F1** (their balance).

### 5.3 Results

All thresholds come from the validation split. "Held-out" = 986 programs from Rosetta Code tasks never seen in training: 7,864 disguised copies (L1–L6) against 198 pairs of independent same-task solutions and 3,000 different-task pairs. "Caught after 3× L6" = share of 2,949 copies still flagged after the strongest disguise was applied three times in a row. IR-Plag = 355 hand-plagiarized files against 105 independent solutions.

| Method | Held-out AUC | Caught after 3× L6 | IR-Plag AUC | IR-Plag AUC within a task | IR-Plag balanced accuracy | IR-Plag copies caught / false alarms |
|---|---|---|---|---|---|---|
| Text diff | 0.884 | 46% | 0.653 | 0.648 | 0.492 | 90% / 91% |
| Token matching | 0.989 | 56% | 0.622 | 0.641 | 0.510 | 100% / 98% |
| Winnowing (MOSS-style) | 1.000 | 81% | 0.681 | 0.680 | 0.561 | 88% / 76% |
| String tiling (JPlag-style) | 1.000 | 80% | 0.705 | 0.681 | 0.558 | 94% / 83% |
| Neural encoder | 1.000 | 84% | 0.629 | 0.648 | 0.530 | 66% / 60% |
| **CloneScope (fused)** | **1.000** | **92%** | **0.705** | **0.685** | **0.567** | 95% / 82% |

IR-Plag copies caught at each level (CloneScope): L1 100%, L2 100%, L3 100%, L4 97%, L5 95%, L6 81%.

Graphs: `results/stress.png` (stacked disguises), `results/recall_by_level.png`, `results/roc.png`, `results/score_distribution.png`. All numbers: `results/metrics.json` and `results/RESULTS.md`.

### 5.4 What the results mean

1. **Normalization is the biggest single step.** A plain text diff ranks copies well only at L1. Every method that normalizes tokens ranks held-out copies almost perfectly at all six levels.
2. **The combination matters when disguises pile up.** After the strongest disguise is applied three times, exact-run methods (MOSS-style 81%, JPlag-style 80%) start losing copies because the shared runs break into pieces. The neural similarity degrades least (84%), and the fused score keeps **92%**: when one signal weakens, the others still point the same way.
3. **IR-Plag is hard for every method, for a reason worth explaining.** Its seven tasks are short textbook exercises ("enter the radius and length of a cylinder…"). Honest students end up writing almost exactly the textbook solution, while the L4–L6 plagiarists *refactored* the original (moved code into new methods, changed the logic). So at L4–L6 the honest solutions are often *more* similar to the original than the copies are. Every method raises many false alarms at thresholds learned on realistic programs. CloneScope ties for the best overall AUC (0.705 vs 0.705 for tiling) and has the best ranking within a task (0.685) and the best balanced accuracy (0.567).
4. **The neural encoder alone is weak on IR-Plag (0.629).** That is not a bug: it correctly sees that honest textbook solutions are structurally near-identical to the original. What still separates copies there is **copied text**: plagiarists kept the exact prompts and messages, while honest students typed them slightly differently. That is why the shared-text signal is part of CloneScope.
5. **Calibration helps.** Refitting just the seven fusion weights on IR-Plag itself (leave-one-task-out cross-validation, so every task is scored by weights that never saw it) raises the within-task AUC from 0.685 to **0.769**. A college with a few confirmed cases could recalibrate CloneScope for its own courses.
6. **Development note (for honesty).** The shared-text signal was added after an error analysis of IR-Plag showed that copied prompts are a strong cue. Its design (ignored literals, smoothing, class-level filter) and its weight were then fixed on validation data only. But the *decision* to add it was informed by IR-Plag, so treat the IR-Plag numbers as slightly optimistic. The held-out and stacked-disguise results are not affected.

---

## 6. The web app

* `web/page.html`, `web/styles.css`, `web/app.js`: the interface (upload, results, comparison view, report).
* `tools/build.mjs` bundles the app, the engine, the trained model and the example classes into **one HTML file** (`dist/clonescope.html`, about 1 MB). It works offline: double-click it.
* **Upload**: drop a folder (one sub-folder per student, like a Moodle export), several files (one file per student) or a `.zip`. Nested zips (each student uploaded a zip) are opened too. A small built-in ZIP reader (`engine/zip.js`) uses the browser's own decompression.
* **Views**: flagged pairs (ranked, with reasons), copy groups (graph), similarity matrix (heatmap), all pairs (sortable table), how it works (with the evaluation results).
* **Comparison sheet**: evidence bars, the "why it was flagged" list, matching blocks (click to jump), and two code panes with matching code highlighted in the same colour.
* **Exports**: CSV of all pairs and an HTML report you can print to PDF.
* **Examples**: three fictional classes (Python, Java with starter code, C) of 10 students. Each hides 3 disguised copies, and you can show the answer key.

---

## 7. File-by-file tour

| Path | Purpose |
|---|---|
| `engine/tokenizer.js` | normalizing tokenizer for 4 languages; the fixed vocabulary |
| `engine/winnow.js` | k-gram hashing, winnowing, fingerprint similarity |
| `engine/gst.js` | greedy string tiling |
| `engine/model.js` | neural encoder forward pass in JavaScript |
| `engine/fusion.js` | logistic-regression score |
| `engine/analyze.js` | class pipeline: grouping files into students, starter code removal, all pairs, copy groups |
| `engine/explain.js` | plain-language explanations and highlight spans |
| `engine/zip.js` | dependency-free ZIP reader |
| `web/*` | the web app |
| `training/fetch_data.sh` | downloads Rosetta Code, TheAlgorithms, IR-Plag |
| `training/build_corpus.py` | filter, de-duplicate, split by task |
| `training/obfuscator/` | the disguise generator (tree-sitter) |
| `training/make_pairs.py` | 8 disguised copies per program |
| `training/tokenize_corpus.mjs` | tokenizes everything with the app's tokenizer |
| `training/train_encoder.py` | PyTorch model and contrastive training |
| `training/extract_features.mjs` | all classical signals for the evaluation pairs |
| `training/embed_pairs.py` | neural similarities for the evaluation pairs; JS parity cases |
| `training/fit_fusion.py` | fits the fusion weights and threshold |
| `training/evaluate.py` | baselines, metrics, graphs (`results/`) |
| `tools/make_samples.py` | builds the example classes (copies are compiled and run) |
| `tools/cli.mjs` | command-line version |
| `tests/` | unit tests, disguise check, browser end-to-end test |

---

## 8. Likely viva questions

**Q1. Why not just use MOSS or JPlag?**
They compare exact runs of normalized tokens. That works for L1–L3, but rewriting statements (L5) or padding with dead code (L6) breaks the runs into small pieces. CloneScope keeps their strengths (winnowing and tiling are inside it) and adds a learned similarity, the shared-text signal and explanations. It also runs entirely in the browser, with nothing to install and no code uploaded.

**Q2. Where did you get labelled training data?**
We generated it (self-supervised learning). A tree-sitter-based rewriter disguises real programs the way students do, so every (original, disguised) pair is a known copy. Independent solutions of the same Rosetta Code task are known non-copies.

**Q3. What does "Siamese network" mean?**
Two inputs pass through the same network with the same weights, and we compare the two outputs (here with cosine similarity). It learns a *similarity*, not a fixed list of classes, so it works for any new assignment without retraining.

**Q4. Why a CNN and not a Transformer?**
The model must run in a web page on an ordinary laptop or phone. A dilated CNN with about 170k parameters embeds a 500-token program in tens of milliseconds in plain JavaScript. The plagiarism signal is mostly local (statement patterns), and dilation gives a 31-token view. A Transformer would be heavier, with no clear gain at this scale.

**Q5. What is contrastive learning / NT-Xent?**
For each program, two disguised versions should end up close together, and everything else in the batch far apart. The loss is a softmax over similarities in which the correct partner should win. The temperature (0.07) controls how sharply it penalizes near-misses.

**Q6. What are hard negatives and why do they matter?**
Different students' honest solutions to the same task. In a real class *everyone* solves the same problem, so the model must not flag "same algorithm" as copying. Putting such pairs in the same batch teaches exactly that difference.

**Q7. How do you know the disguises are realistic?**
(a) They follow the standard L1–L6 taxonomy. (b) Every disguised program still parses, and on the test programs they compile and print identical output. (c) We test on IR-Plag, where *humans* did the plagiarising, and the model never saw it.

**Q8. How did you prevent data leakage?**
The data was split by *task*, not by file, so no task's solutions appear in both training and testing. IR-Plag was used only for testing. Thresholds and fusion weights were fitted on the validation split only.

**Q9. Why are the IR-Plag numbers lower than the synthetic ones?**
IR-Plag's tasks are tiny textbook exercises (11–34 lines). Honest students reproduce almost the textbook solution, while the L4–L6 plagiarists refactored theirs, so on structure alone honest pairs can look *more* similar than copies. Every method suffers there. CloneScope ties for the best overall AUC, has the best within-task AUC and the best balanced accuracy. Its extra signal, identical prompts and messages, is what still separates many copies. That is also why the app warns when a class's programs are short and shows each pair's rank within the class.

**Q10. Can it tell who copied from whom?**
No, and no tool can from the code alone. It shows *who shares code*. A group can come from one student, a senior's file, a website or an AI tool. The teacher decides.

**Q11. What about code generated by ChatGPT or other AI tools?**
If several students paste answers from the same AI prompt, their submissions are often near-identical and show up as a copy group. CloneScope does not claim to detect AI-written code in general. AI-text detectors have high false-positive rates, and we chose not to make that claim.

**Q12. Why logistic regression for fusion?**
It is simple, fast, interpretable (each signal has one weight you can read) and well calibrated. With only seven signals there is no need for anything bigger.

**Q13. What is AUC?**
The chance that a randomly chosen copied pair gets a higher score than a randomly chosen honest pair. 1.0 is perfect ranking, 0.5 is random guessing. It doesn't depend on a threshold.

**Q14. How fast is it?**
For a class of 10 it takes about a second in the browser. Every pair is compared: n students means n(n−1)/2 pairs, so 60 students means 1,770 pairs, which takes a few seconds.

**Q15. Is student data safe?**
The page has no server. All code is read and analysed inside the teacher's browser and never uploaded.

**Q16. How does starter code removal work?**
The teacher's template is tokenized and tiled against each submission. Matching tokens are masked out before any comparison, so a skeleton everyone received does not raise scores.

**Q17. What are the limitations?**
Very short programs; copying across languages (C to Python) is not detected; thresholds may need adjusting per course; the disguise generator cannot imitate every human trick; and the score is evidence, not proof.

**Q18. What would you add next?**
Cross-language detection (a shared intermediate representation), comparison against previous years' submissions, a server mode for very large classes, and an instructor feedback loop to retune the fusion weights.

---

## 9. Glossary

* **Token**: the smallest meaningful piece of code (`for`, `(`, `total`, `+=`).
* **Normalization**: replacing details that don't matter (names, literal values, comments) with placeholders.
* **k-gram**: k consecutive tokens.
* **Hash**: a function turning data into a number; equal inputs give equal numbers.
* **Winnowing**: picking the minimum hash in each window to keep a small, robust set of fingerprints.
* **Greedy string tiling**: finding the longest shared token runs first, without overlaps.
* **Embedding**: a list of numbers representing a program; similar programs have nearby embeddings.
* **Cosine similarity**: how much two vectors point the same way (1 = same direction).
* **Contrastive learning**: learning by pulling matching pairs together and pushing others apart.
* **Logistic regression**: a weighted sum of features squashed into 0–1.
* **AUC / precision / recall / F1**: see Q13 and section 5.2.
