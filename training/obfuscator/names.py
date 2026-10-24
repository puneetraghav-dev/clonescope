"""Name pools used when a 'student' renames identifiers."""
from __future__ import annotations

import json
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "reserved_names.json"), encoding="utf-8") as f:
    _VOCAB_NAMES = set(json.load(f))

# Language keywords / builtins / library names we must never generate.
RESERVED = _VOCAB_NAMES | {
    # python builtins not in the vocab lists
    "abs", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes", "callable",
    "chr", "compile", "complex", "delattr", "dict", "dir", "divmod", "enumerate", "eval", "exec",
    "filter", "float", "format", "frozenset", "getattr", "globals", "hasattr", "hash", "help",
    "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len", "list", "locals", "map",
    "max", "memoryview", "min", "next", "object", "oct", "open", "ord", "pow", "print", "property",
    "range", "repr", "reversed", "round", "set", "setattr", "slice", "sorted", "staticmethod",
    "str", "sum", "super", "tuple", "type", "vars", "zip", "match", "case", "type", "_",
    # c / c++ / java words that are dangerous as names
    "main", "printf", "scanf", "std", "string", "vector", "map", "list", "array", "time", "exit",
    "index", "count", "y0", "y1", "j0", "j1", "jn", "yn", "signal", "log", "exp", "gamma", "remove",
    "rename", "link", "read", "write", "free", "abs", "div", "random", "select", "connect",
}

SYNONYMS = {
    "count": ["cnt", "counter", "num_items", "c", "tally"],
    "cnt": ["count", "counter", "c", "k"],
    "sum": ["total", "s", "acc", "tot", "summ"],
    "total": ["sum1", "tot", "acc", "res", "grand"],
    "result": ["res", "ans", "output", "r", "answer"],
    "res": ["result", "ans", "out", "r"],
    "ans": ["result", "res", "answer", "out"],
    "temp": ["tmp", "t", "aux", "hold", "swap_val"],
    "tmp": ["temp", "t", "aux", "hold"],
    "i": ["j", "k", "idx", "p", "x", "ii", "m"],
    "j": ["k", "m", "q", "y", "jj", "l"],
    "k": ["m", "p", "z", "kk", "t"],
    "n": ["num", "size", "length1", "N", "limit", "cnt_n"],
    "num": ["n", "number", "val", "x", "value"],
    "number": ["num", "n", "val", "x", "inp"],
    "arr": ["a", "array1", "nums", "list1", "values", "data", "elements"],
    "a": ["arr", "x", "first", "p", "num1"],
    "b": ["y", "second", "q", "num2"],
    "x": ["a", "val", "u", "p", "xx"],
    "y": ["b", "v", "q", "yy"],
    "max": ["mx", "largest", "maximum", "big", "high"],
    "min": ["mn", "smallest", "minimum", "small", "low"],
    "flag": ["found", "ok", "status", "f", "is_ok"],
    "found": ["flag", "present", "ok", "got"],
    "s": ["st", "text", "word", "string1", "line"],
    "str": ["s", "text", "word", "line"],
    "word": ["w", "token", "s", "term"],
    "text": ["s", "txt", "sentence", "line"],
    "left": ["lo", "l", "start", "low"],
    "right": ["hi", "r", "end1", "high"],
    "low": ["lo", "left", "l", "start"],
    "high": ["hi", "right", "h", "end1"],
    "mid": ["middle", "m", "center", "midpoint"],
    "key": ["k", "target", "item", "x"],
    "target": ["key", "goal", "find", "x"],
    "node": ["curr", "nd", "elem", "p"],
    "head": ["start", "first", "root", "h"],
    "root": ["head", "top", "r", "base"],
    "prev": ["before", "last", "p", "previous"],
    "curr": ["cur", "current", "node", "now"],
    "matrix": ["mat", "grid", "m", "table"],
    "row": ["r", "rows", "line", "ri"],
    "col": ["c", "column", "cj", "cols"],
    "length": ["len1", "size", "n", "l"],
    "size": ["n", "length1", "sz", "cap"],
    "average": ["avg", "mean", "av"],
    "avg": ["average", "mean", "av"],
    "factorial": ["fact", "fac", "f", "product"],
    "fact": ["factorial", "f", "prod"],
    "is_prime": ["isPrime", "prime_check", "check_prime", "prime"],
    "isPrime": ["is_prime", "checkPrime", "prime", "testPrime"],
    "swap": ["exchange", "swap_vals", "sw"],
    "value": ["val", "v", "x", "item"],
    "val": ["value", "v", "x", "item"],
    "data": ["values", "items", "arr", "lst"],
    "items": ["data", "elements", "lst", "things"],
    "lst": ["items", "arr", "values", "lis"],
}

GENERIC = ["a", "b", "c", "x", "y", "z", "p", "q", "u", "v", "w", "val", "var1", "var2", "temp1",
           "data", "item", "elem", "value", "number", "first", "second", "k1", "obj", "res1",
           "node", "curr", "prev", "nxt", "left", "right", "low", "high", "mid", "key", "pos",
           "step", "limit", "size1", "ptr", "head", "tail", "root", "flag1", "aux", "acc", "it",
           "m", "t", "d", "e1", "f", "g", "h", "r", "s1", "s2", "n1", "n2", "x1", "x2", "y1_",
           "alpha", "beta", "gamma1", "num1", "num2", "my_var", "foo", "bar", "baz", "qux", "tmp2"]

FUNC_GENERIC = ["calc", "compute", "process", "helper", "solve", "do_work", "find", "check",
                "get_value", "run_task", "handle", "work", "evaluate", "perform", "func1", "fn",
                "method1", "logic", "operate", "doIt", "calculate", "find_result", "util"]

TYPE_GENERIC = ["Solver", "Helper", "Program", "Demo", "Test", "Item", "Node1", "Element",
                "Record", "Entity", "Thing", "Box", "Holder", "MyClass", "Pair1", "Data1", "Info"]

PREFIXES = ["my", "the", "new", "tmp", "local", "cur", "x"]
SUFFIXES = ["1", "2", "_val", "_v", "x", "_new", "0", "_tmp"]

_CAMEL = re.compile(r"(?<!^)(?=[A-Z])")


def to_snake(name: str) -> str:
    return _CAMEL.sub("_", name).lower()


def to_camel(name: str) -> str:
    parts = [p for p in name.split("_") if p]
    if not parts:
        return name
    return parts[0].lower() + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def is_style_changeable(name: str) -> bool:
    return "_" in name.strip("_") or bool(re.search(r"[a-z][A-Z]", name))


class NameGenerator:
    """Generates fresh, collision-free replacement names in a per-file 'style'."""

    def __init__(self, rng, taken: set[str], style: str | None = None):
        self.rng = rng
        self.taken = set(taken) | RESERVED
        self.style = style or rng.choice(["synonym", "synonym", "style", "generic", "affix"])
        self.affix = (rng.choice(PREFIXES), rng.choice(SUFFIXES))

    def _free(self, cand: str) -> str | None:
        if not cand or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", cand):
            return None
        if cand in self.taken:
            return None
        self.taken.add(cand)
        return cand

    def fresh(self, old: str, kind: str = "var") -> str:
        rng = self.rng
        cands = []
        style = self.style
        if style == "synonym" and old in SYNONYMS:
            cands += rng.sample(SYNONYMS[old], len(SYNONYMS[old]))
        if style == "style" and is_style_changeable(old):
            cands.append(to_camel(old) if "_" in old else to_snake(old))
        if style == "affix":
            pre, suf = self.affix
            cands.append(pre + old[:1].upper() + old[1:] if rng.random() < 0.5 else old + suf)
        if old in SYNONYMS and rng.random() < 0.5:
            cands += rng.sample(SYNONYMS[old], len(SYNONYMS[old]))
        pool = {"var": GENERIC, "func": FUNC_GENERIC, "type": TYPE_GENERIC}.get(kind, GENERIC)
        cands += rng.sample(pool, min(len(pool), 12))
        for c in cands:
            if kind == "type" and c[:1].islower():
                c = c[:1].upper() + c[1:]
            got = self._free(c)
            if got:
                return got
        base = (old[:3] or "v") if kind != "type" else "T"
        k = 2
        while True:
            got = self._free(f"{base}{k}")
            if got:
                return got
            k += 1
