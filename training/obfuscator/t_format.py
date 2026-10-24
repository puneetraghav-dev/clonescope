"""Level 1 disguises: comments, indentation, braces, blank lines, spacing.

None of these change the normalized token stream - they model the cheapest
tricks students use, and they matter for the raw text-diff baseline.
"""
from __future__ import annotations

from .core import (BLOCK_TYPES, COMMENT_TYPES, apply_edits, indent_unit, line_indent, line_start,
                   parse, starts_line, statements, text, walk)

PHRASES = [
    "calculate the result", "loop through all elements", "check the condition", "initialize variables",
    "update the value", "print the output", "helper function", "main logic", "read input from user",
    "store the answer", "temporary variable", "increment the counter", "base case", "swap the values",
    "find the maximum", "compute sum", "iterate over the list", "return final answer", "edge case",
    "process each item", "validate input", "declare variables", "display result", "logic for the problem",
    "this part does the work", "step 1", "step 2", "important", "do not change", "my code",
    "using loop", "nested loop", "check if valid", "get the length", "end of loop", "call the function",
]


def _comment_line(lang: str, rng) -> bytes:
    p = rng.choice(PHRASES)
    if lang == "python":
        return ("# " + p).encode()
    if rng.random() < 0.25:
        return ("/* " + p + " */").encode()
    return ("// " + p).encode()


def remove_comments(src: bytes, lang: str, rng):
    tree = parse(src, lang)
    ctypes = COMMENT_TYPES[lang]
    edits = []
    for n in walk(tree.root_node):
        if n.type not in ctypes:
            continue
        s, e = n.start_byte, n.end_byte
        nl = src.find(b"\n", e)
        rest = src[e:nl if nl >= 0 else len(src)]
        if starts_line(src, s) and rest.strip() == b"":
            ls = line_start(src, s)
            edits.append((ls, nl + 1 if nl >= 0 else len(src), b""))
        else:
            k = s
            while k > 0 and src[k - 1] in b" \t":
                k -= 1
            edits.append((k, e, b""))
    if lang == "python":
        edits += _docstring_edits(src, tree)
    return apply_edits(src, edits) if edits else None


def _docstring_edits(src: bytes, tree):
    edits = []
    for n in walk(tree.root_node):
        if n.type not in ("block", "module"):
            continue
        stmts = statements(n, "python")
        if not stmts:
            continue
        first = stmts[0]
        if first.type == "expression_statement" and first.named_child_count == 1 and \
                first.named_children[0].type in ("string", "concatenated_string"):
            if len(stmts) == 1:
                edits.append((first.start_byte, first.end_byte, b"pass"))
            elif starts_line(src, first.start_byte):
                ls = line_start(src, first.start_byte)
                nl = src.find(b"\n", first.end_byte)
                edits.append((ls, nl + 1 if nl >= 0 else len(src), b""))
    return edits


def add_comments(src: bytes, lang: str, rng):
    tree = parse(src, lang)
    cands = []
    for n in walk(tree.root_node):
        if n.type in BLOCK_TYPES[lang]:
            for st in statements(n, lang):
                if starts_line(src, st.start_byte):
                    cands.append(st)
    if not cands:
        return None
    k = min(len(cands), rng.randint(1, 4))
    edits = []
    for st in rng.sample(cands, k):
        ind = line_indent(src, st.start_byte)
        edits.append((st.start_byte, st.start_byte, _comment_line(lang, rng) + b"\n" + ind))
    return apply_edits(src, edits)


def rewrite_comments(src: bytes, lang: str, rng):
    tree = parse(src, lang)
    ctypes = COMMENT_TYPES[lang]
    edits = []
    for n in walk(tree.root_node):
        if n.type in ctypes and text(src, n).count(b"\n") == 0:
            t = text(src, n)
            if lang == "python" or t.startswith(b"//"):
                pre = b"# " if lang == "python" else b"// "
                edits.append((n.start_byte, n.end_byte, pre + rng.choice(PHRASES).encode()))
            elif t.startswith(b"/*"):
                edits.append((n.start_byte, n.end_byte, b"/* " + rng.choice(PHRASES).encode() + b" */"))
    return apply_edits(src, edits) if edits else None


def _protected_lines(src: bytes, lang: str):
    """Line numbers (0-based) that lie inside multi-line strings/comments: never re-indent them."""
    tree = parse(src, lang)
    prot = set()
    for n in walk(tree.root_node):
        if n.type in ("string", "string_literal", "raw_string_literal", "text_block", "block_comment", "comment",
                      "concatenated_string"):
            a, b = n.start_point[0], n.end_point[0]
            for ln in range(a + 1, b + 1):
                prot.add(ln)
    return prot


def reindent(src: bytes, lang: str, rng):
    old = indent_unit(src)
    choices = [b"  ", b"    ", b"\t", b"   "]
    choices = [c for c in choices if c != old]
    new = rng.choice(choices)
    prot = _protected_lines(src, lang)
    old_w = 8 if old == b"\t" else len(old)
    out = []
    for i, line in enumerate(src.split(b"\n")):
        if i in prot or not line.strip():
            out.append(line)
            continue
        j = 0
        width = 0
        while j < len(line) and line[j] in b" \t":
            width = (width // 8 + 1) * 8 if line[j] == 9 else width + 1
            j += 1
        if width == 0:
            out.append(line)
            continue
        levels, rem = divmod(width, old_w)
        out.append(new * levels + b" " * rem + line[j:])
    res = b"\n".join(out)
    return res if res != src else None


_BRACE_PARENTS = {"compound_statement", "block", "class_body", "field_declaration_list", "enum_body",
                  "declaration_list", "interface_body", "constructor_body", "switch_body",
                  "enumerator_list", "switch_block"}


def brace_style(src: bytes, lang: str, rng):
    if lang == "python":
        return None
    tree = parse(src, lang)
    braces = []
    for n in walk(tree.root_node):
        if n.type in _BRACE_PARENTS:
            for ch in n.children:
                if ch.type == "{":
                    braces.append(ch)
                    break
    if not braces:
        return None
    same_line = [b for b in braces if not starts_line(src, b.start_byte)]
    own_line = [b for b in braces if starts_line(src, b.start_byte)]
    to_allman = len(same_line) >= len(own_line)
    edits = []
    if to_allman:
        for b in same_line:
            k = b.start_byte
            while k > 0 and src[k - 1] in b" \t":
                k -= 1
            if k == 0 or src[k - 1] in b"=,(":  # initializer lists etc.
                continue
            ind = line_indent(src, b.start_byte)
            edits.append((k, b.start_byte, b"\n" + ind))
    else:
        for b in own_line:
            k = line_start(src, b.start_byte) - 1  # the '\n' before
            j = k
            while j > 0 and src[j - 1] in b" \t\r\n":
                j -= 1
            if j <= 0 or src[j - 1:j] in (b";", b"{", b"}", b"/", b":"):
                continue
            # don't join onto a line comment
            ls = line_start(src, j - 1)
            if b"//" in src[ls:j]:
                continue
            edits.append((j, b.start_byte, b" "))
    return apply_edits(src, edits) if edits else None


def blank_lines(src: bytes, lang: str, rng):
    lines = src.split(b"\n")
    prot = _protected_lines(src, lang)
    if rng.random() < 0.5:
        # remove blank lines (keep at most one between top-level python defs to stay readable)
        out = [l for i, l in enumerate(lines) if l.strip() or i in prot]
    else:
        out = []
        for i, l in enumerate(lines):
            if l.strip() and i not in prot and rng.random() < 0.12 and i > 0:
                out.append(b"")
            out.append(l)
    res = b"\n".join(out)
    return res if res != src else None


_BIN_TYPES = {"binary_expression", "binary_operator", "comparison_operator", "boolean_operator",
              "assignment_expression", "augmented_assignment", "assignment"}


def spacing(src: bytes, lang: str, rng):
    """Writes binary operators consistently either tight (a+b) or spaced (a + b)."""
    tree = parse(src, lang)
    tight = rng.random() < 0.5
    edits = []
    for n in walk(tree.root_node):
        if n.type not in _BIN_TYPES or n.child_count < 3:
            continue
        kids = n.children
        for idx in range(1, len(kids) - 1):
            op = kids[idx]
            if op.is_named:
                continue
            ot = text(src, op)
            if lang == "python" and ot in (b"and", b"or", b"not", b"in", b"is"):
                continue
            if tight and lang == "python" and n.type == "assignment":
                continue
            left, right = kids[idx - 1], kids[idx + 1]
            g1 = src[left.end_byte:op.start_byte]
            g2 = src[op.end_byte:right.start_byte]
            if b"\n" in g1 or b"\n" in g2 or g1.strip() or g2.strip():
                continue
            want = b"" if tight else b" "
            # never glue tokens that would merge (e.g. a - -b, x < -y)
            if tight and (src[right.start_byte:right.start_byte + 1] in b"-+*&<>=!/%" or
                          src[left.end_byte - 1:left.end_byte] in b"-+*&<>=!/%"):
                continue
            if g1 != want:
                edits.append((left.end_byte, op.start_byte, want))
            if g2 != want:
                edits.append((op.end_byte, right.start_byte, want))
    return apply_edits(src, edits) if edits else None
