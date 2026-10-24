"""Editing output messages - students often reword prompts and messages in copied code.

Only the plain text parts of string literals are changed; escape sequences, format
specifiers (%d, %.2f, {}) and f-string expressions are left alone, so programs still
compile (their printed text changes, of course).
"""
from __future__ import annotations

import re

from .core import apply_edits, parse, text, walk

WORDS = {
    "enter": ["input", "give", "type", "Enter the"], "number": ["num", "value", "no."], "numbers": ["values", "nums"],
    "average": ["avg", "mean", "Average value"], "total": ["sum", "grand total"], "sum": ["total", "addition"],
    "maximum": ["max", "largest"], "minimum": ["min", "smallest"], "max": ["maximum", "highest"],
    "min": ["minimum", "lowest"], "result": ["answer", "output"], "element": ["item", "value"],
    "elements": ["items", "values"], "array": ["list"], "largest": ["biggest", "greatest"], "smallest": ["least"],
    "highest": ["top", "maximum"], "lowest": ["bottom", "minimum"], "student": ["learner", "stud"],
    "marks": ["score", "points"], "salary": ["pay"], "employee": ["emp", "worker"], "below": ["under", "less than"],
    "reversed": ["reverse", "in reverse"], "count": ["no. of", "total"], "string": ["text", "word"],
    "is": ["=", "is:"], "the": [""], "please": [""], "value": ["val"], "list": ["array"], "yes": ["YES", "True"],
    "no": ["NO", "False"], "even": ["Even numbers"], "odd": ["Odd numbers"], "second": ["2nd"],
    "name": ["Name of"], "gross": ["Gross pay"], "net": ["Net pay"], "topper": ["Top scorer", "Best"],
}
WORD_RE = re.compile(r"(?<![%\\0-9.])\b[A-Za-z][A-Za-z]+\b")

CONTENT_TYPES = {"string_content", "string_fragment"}


def _rewrite(s: str, rng) -> str:
    out = s
    mode = rng.random()
    if mode < 0.65:
        def sub(m):
            w = m.group(0)
            alts = WORDS.get(w.lower())
            if not alts or rng.random() < 0.35:
                return w
            r = rng.choice(alts)
            if w[0].isupper() and r:
                r = r[0].upper() + r[1:]
            return r
        out = WORD_RE.sub(sub, out)
        out = re.sub(r"  +", " ", out)
    if mode >= 0.4 and rng.random() < 0.7:
        out = out.replace(": ", rng.choice([" = ", " : ", " - ", ":", " -> "]), 1)
    if rng.random() < 0.25:
        out = WORD_RE.sub(lambda m: m.group(0).lower() if rng.random() < 0.5 else m.group(0).upper(), out)
    return out


def change_literals(src: bytes, lang: str, rng):
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type not in CONTENT_TYPES:
            continue
        p = n.parent
        # skip Python docstrings (handled as comments elsewhere)
        if lang == "python" and p is not None and p.parent is not None and p.parent.type == "expression_statement" \
                and p.parent.named_child_count == 1:
            continue
        t = text(src, n).decode("utf-8", "replace")
        if not re.search(r"[A-Za-z]{2,}", t) or rng.random() < 0.4:
            continue
        new = _rewrite(t, rng)
        if new != t and new.strip():
            edits.append((n.start_byte, n.end_byte, new.encode()))
    return apply_edits(src, edits) if edits else None
