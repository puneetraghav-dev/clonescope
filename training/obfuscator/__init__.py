"""CloneScope disguise generator.

Rewrites a program the way a student might when hiding copied code, following
the plagiarism levels of Faidhi & Robinson (1987):

  L1  comments, indentation, braces, blank lines, spacing
  L2  + renaming identifiers
  L3  + changing declarations (split / merge / move initialisation)
  L4  + reordering functions and independent statements
  L5  + rewriting statements (for <-> while, i++ <-> i += 1, x += y <-> x = x + y, a < b <-> b > a,
        list comprehension <-> loop, for-each <-> index loop)
  L6  + changing logic / padding (flipping if/else, dead code, temporary variables, extra parentheses)

Every step re-parses the result with tree-sitter and is discarded if it would
produce code with syntax errors, so disguised programs stay valid.

    >>> from obfuscator import disguise
    >>> new_code, applied = disguise(code, "python", level=5, rng=random.Random(1))
"""
from __future__ import annotations

import random as _random

from . import t_clike as C
from . import t_format as F
from . import t_python as P
from . import t_rename as R
from .t_literals import change_literals
from .core import LANGUAGES, is_valid

_FORMAT = {"remove_comments": F.remove_comments, "add_comments": F.add_comments,
           "rewrite_comments": F.rewrite_comments, "reindent": F.reindent, "brace_style": F.brace_style,
           "blank_lines": F.blank_lines, "spacing": F.spacing}

_LEVELS_CLIKE = {
    2: {"rename": R.rename},
    3: {"split_decl": C.split_decl, "merge_decl": C.merge_decl, "split_init": C.split_init,
        "type_change": C.type_change},
    4: {"reorder_functions": C.reorder_functions, "reorder_statements": C.reorder_statements},
    5: {"for_to_while": C.for_to_while, "while_to_for": C.while_to_for, "increment_style": C.increment_style,
        "compound_assign": C.compound_assign, "comparison_flip": C.comparison_flip},
    6: {"flip_if_else": C.flip_if_else, "dead_code": C.dead_code, "extract_temp": C.extract_temp,
        "redundant_parens": C.redundant_parens, "change_literals": change_literals},
}
_LEVELS_PY = {
    2: {"rename": R.rename},
    3: {"split_tuple": P.split_tuple, "merge_assign": P.merge_assign},
    4: {"reorder_functions": P.reorder_functions, "reorder_statements": P.reorder_statements},
    5: {"for_range_to_while": P.for_range_to_while, "while_to_for_range": P.while_to_for_range,
        "foreach_to_index": P.foreach_to_index, "index_to_foreach": P.index_to_foreach,
        "compound_assign": P.compound_assign, "comparison_flip": P.comparison_flip,
        "comprehension_to_loop": P.comprehension_to_loop, "loop_to_comprehension": P.loop_to_comprehension},
    6: {"flip_if_else": P.flip_if_else, "dead_code": P.dead_code, "extract_temp": P.extract_temp,
        "redundant_parens": P.redundant_parens, "change_literals": change_literals},
}

# operations that change what the program prints (all others keep the output identical)
OUTPUT_CHANGING = {"change_literals"}


def operations(lang: str) -> dict[int, dict]:
    """All transformations available for `lang`, grouped by level."""
    levels = dict(_LEVELS_PY if lang == "python" else _LEVELS_CLIKE)
    levels[1] = _FORMAT
    return levels


def apply_op(src: bytes, lang: str, fn, rng) -> bytes | None:
    try:
        new = fn(src, lang, rng)
    except (IndexError, StopIteration, ValueError, AttributeError, TypeError, UnicodeDecodeError):
        return None
    if new is None or new == src or not is_valid(new, lang):
        return None
    return new


def disguise(code, lang: str, level: int | None = None, rng=None, intensity: float | None = None,
             exclude: set | None = None):
    """Returns (disguised_code, list_of_applied_operations).

    level      1..6, cumulative (L4 also applies L1-L3). None = random level.
    intensity  probability of trying each optional operation of the included levels.
    exclude    operation names to skip (e.g. OUTPUT_CHANGING to keep the printed output identical).
    """
    if lang not in LANGUAGES:
        raise ValueError(lang)
    rng = rng or _random.Random()
    src = code.encode("utf-8") if isinstance(code, str) else code
    if level is None:
        level = rng.choices([1, 2, 3, 4, 5, 6], weights=[1, 2, 2, 3, 4, 5])[0]
    p = intensity if intensity is not None else rng.uniform(0.45, 0.9)
    ops = operations(lang)
    applied = []
    order = [2, 3, 4, 5, 6, 1]  # rename, restructure, pad, then reformat - like a student would
    for lv in order:
        if lv > level:
            continue
        names = [n for n in ops[lv] if not exclude or n not in exclude]
        rng.shuffle(names)
        tried_any = False
        for name in names:
            must = (lv == level and not tried_any and name == names[-1]) or (lv == 2)
            if not must and rng.random() > p:
                continue
            new = apply_op(src, lang, ops[lv][name], rng)
            if new is not None:
                src = new
                applied.append(name)
                tried_any = True
        if lv == level and not tried_any and lv > 1:
            # make sure the top level is represented if any of its operations applies
            for name in names:
                new = apply_op(src, lang, ops[lv][name], rng)
                if new is not None:
                    src = new
                    applied.append(name)
                    break
    if 1 <= level and not any(a in _FORMAT for a in applied):
        for name in rng.sample(list(_FORMAT), len(_FORMAT)):
            new = apply_op(src, lang, _FORMAT[name], rng)
            if new is not None:
                src = new
                applied.append(name)
                break
    return src.decode("utf-8", "replace"), applied


__all__ = ["disguise", "operations", "apply_op", "LANGUAGES", "OUTPUT_CHANGING"]
