# 5-minute demo script (for the project presentation / viva)

Open the live link (or `dist/clonescope.html`) before you start. It works offline, so a projector with no internet is fine.

**1. The problem (30 s).** "In every programming lab some students copy and disguise the code: they rename variables, change comments, swap `for` for `while`, move functions around. Checking 60 students means 1,770 pairs by hand. CloneScope does it in seconds, entirely in the browser."

**2. Example class (45 s).** The Python example (Lab 4 · Marks report, 10 students) is already analysed.
* Point at the summary: 45 pairs compared, the flagged pairs and copy groups, and the time.
* Click **Show answer key**: "Three of these students handed in disguised copies. Let's see if it found them." The flagged pairs carry **✓ planted copy** badges.

**3. Open the hardest copy (90 s).** Click the pair with **Ishita Das** (a level-6 disguise).
* *Evidence*: the suspicion score, AI similarity, fingerprint overlap, matched code.
* *Why it was flagged*: renamed variables (with `old → new` names), code moved around, padding.
* Scroll to the code. The same colour marks the same logic in both files. Click a block in *Matching blocks* to jump both panes. Hover over a highlighted line to see its twin.
* "Every name is different, the functions are in a different order and there's dead code, yet the structure is the same."

**4. Groups and matrix (30 s).** *Copy groups* tab: "three students share one source, and two others share another." *Similarity matrix*: the red squares stand out against an otherwise pale class.

**5. Starter code (30 s).** Click the **Java** example. "This lab came with a skeleton file. CloneScope ignores it automatically, so the shared skeleton doesn't make everyone look like a copier." Point at "starter code ignored" in the dataset line.

**6. Your own files (30 s).** Drag a folder or a zip onto the drop zone (for example `samples/c/class`). "Moodle and Google Classroom downloads work as they are."

**7. How it works and results (60 s).** Open *How it works*.
* The pipeline: normalize → fingerprints (MOSS) → tiling (JPlag) → neural network → shared text → fusion.
* "The neural network was trained with self-supervised contrastive learning on about 10,000 real programs and 78,000 disguised copies that our own generator made. Nobody labelled anything by hand."
* The results table: "On IR-Plag, hand-made plagiarism from a published dataset that the model never saw, CloneScope is compared with a text diff and with MOSS-style and JPlag-style matching, each given its best threshold on our validation data."

**8. Close (15 s).** "It never says *who* copied, and it never punishes automatically. It gives the teacher ranked evidence and explanations in seconds, and the code never leaves the teacher's computer."

---

**If they ask for a live disguise:** open `tests/fixtures/prog.py` and edit it in front of them (rename variables, delete comments, turn a `for` into a `while`). Save it as a second "student", drop both files in, and the pair still scores high.
