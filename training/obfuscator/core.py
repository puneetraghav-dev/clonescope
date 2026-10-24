"""Parsing helpers shared by all disguise transformations.

Everything works on UTF-8 *bytes* because tree-sitter reports byte offsets.
A transformation computes a list of edits (start, end, replacement) and
`apply_edits` applies them back-to-front so offsets stay valid.
"""
from __future__ import annotations

import re
from tree_sitter import Language, Parser
import tree_sitter_c as _ts_c
import tree_sitter_cpp as _ts_cpp
import tree_sitter_java as _ts_java
import tree_sitter_python as _ts_python

LANGUAGES = ("python", "java", "c", "cpp")

_TS_LANG = {
    "python": Language(_ts_python.language()),
    "java": Language(_ts_java.language()),
    "c": Language(_ts_c.language()),
    "cpp": Language(_ts_cpp.language()),
}
_PARSERS: dict[str, Parser] = {}

COMMENT_TYPES = {
    "python": {"comment"},
    "java": {"line_comment", "block_comment"},
    "c": {"comment"},
    "cpp": {"comment"},
}

# node types that hold a list of statements
BLOCK_TYPES = {
    "python": {"block", "module"},
    "java": {"block", "constructor_body"},
    "c": {"compound_statement"},
    "cpp": {"compound_statement"},
}

CALL_TYPES = {
    "python": {"call"},
    "java": {"method_invocation", "object_creation_expression"},
    "c": {"call_expression"},
    "cpp": {"call_expression", "new_expression"},
}

# statements after which nothing reachable may follow
TERMINATORS = {
    "python": {"return_statement", "break_statement", "continue_statement", "raise_statement"},
    "java": {"return_statement", "break_statement", "continue_statement", "throw_statement"},
    "c": {"return_statement", "break_statement", "continue_statement", "goto_statement"},
    "cpp": {"return_statement", "break_statement", "continue_statement", "goto_statement", "throw_statement"},
}


def get_parser(lang: str) -> Parser:
    p = _PARSERS.get(lang)
    if p is None:
        p = Parser(_TS_LANG[lang])
        _PARSERS[lang] = p
    return p


def parse(src: bytes, lang: str):
    return get_parser(lang).parse(src)


def is_valid(src: bytes, lang: str) -> bool:
    if parse(src, lang).root_node.has_error:
        return False
    if lang == "python":  # tree-sitter is lenient about indentation; CPython is not
        import ast
        import warnings
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                ast.parse(src)
        except (SyntaxError, ValueError):
            return False
    return True


def walk(node):
    """Pre-order traversal without recursion."""
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        if n.child_count:
            stack.extend(reversed(n.children))


def text(src: bytes, node) -> bytes:
    return src[node.start_byte:node.end_byte]


def apply_edits(src: bytes, edits) -> bytes:
    """Applies (start, end, replacement) edits. Overlapping edits are dropped (first one wins)."""
    accepted = []
    for s, e, r in edits:
        clash = False
        for a, b, _ in accepted:
            if s == e:  # insertion
                if a < s < b:
                    clash = True
                    break
            elif a == b:
                if s < a < e:
                    clash = True
                    break
            elif not (e <= a or s >= b):
                clash = True
                break
        if not clash:
            accepted.append((s, e, r))
    accepted.sort(key=lambda x: (x[0], x[1]), reverse=True)
    out = src
    for s, e, r in accepted:
        out = out[:s] + r + out[e:]
    return out


def line_start(src: bytes, pos: int) -> int:
    return src.rfind(b"\n", 0, pos) + 1


def line_indent(src: bytes, pos: int) -> bytes:
    """Leading whitespace of the line containing byte `pos`."""
    ls = line_start(src, pos)
    j = ls
    while j < len(src) and src[j] in b" \t":
        j += 1
    return src[ls:j]


def starts_line(src: bytes, pos: int) -> bool:
    """True if only whitespace precedes `pos` on its line."""
    ls = line_start(src, pos)
    return src[ls:pos].strip() == b""


def indent_unit(src: bytes) -> bytes:
    """Guesses the indentation step used by the file (tab, 2 or 4 spaces...)."""
    widths = []
    for line in src.split(b"\n"):
        m = re.match(rb"^([ \t]+)\S", line)
        if m:
            if b"\t" in m.group(1):
                return b"\t"
            widths.append(len(m.group(1)))
    if not widths:
        return b"    "
    import math
    g = 0
    for w in widths:
        g = math.gcd(g, w)
    g = g if g in (2, 3, 4, 8) else 4
    return b" " * g


def statements(block, lang: str):
    """Named statement children of a block (no comments, no braces)."""
    cts = COMMENT_TYPES[lang]
    return [c for c in block.named_children if c.type not in cts]


def contains_type(node, types) -> bool:
    for n in walk(node):
        if n.type in types:
            return True
    return False


def identifiers_in(src: bytes, node, types=("identifier",)) -> set[bytes]:
    return {text(src, n) for n in walk(node) if n.type in types}


def all_names(src: bytes, root) -> set[bytes]:
    return {text(src, n) for n in walk(root)
            if n.type in ("identifier", "field_identifier", "type_identifier", "namespace_identifier")}


def strip_semicolon(b: bytes) -> bytes:
    b = b.strip()
    while b.endswith(b";"):
        b = b[:-1].rstrip()
    return b
