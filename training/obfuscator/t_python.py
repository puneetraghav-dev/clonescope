"""Structural disguises for Python (levels 3-6)."""
from __future__ import annotations

from .core import (TERMINATORS, all_names, apply_edits, contains_type, indent_unit, line_indent, line_start,
                   parse, starts_line, statements, text, walk)
from .names import NameGenerator

COMPARE_OPS = {b"<": b">", b">": b"<", b"<=": b">=", b">=": b"<=", b"==": b"==", b"!=": b"!="}
NEGATE_OPS = {b"<": b">=", b">": b"<=", b"<=": b">", b">=": b"<", b"==": b"!=", b"!=": b"=="}
PURE = {b"len", b"abs", b"min", b"max", b"int", b"float", b"str", b"round", b"sqrt", b"math.sqrt", b"pow"}


def _blocks(root):
    for n in walk(root):
        if n.type in ("block", "module"):
            yield n


def _gen(src, root, rng, style="generic"):
    return NameGenerator(rng, {x.decode("utf-8", "replace") for x in all_names(src, root)}, style=style)


def _assign(stmt):
    """The assignment node of a simple `x = ...` expression statement, else None."""
    if stmt.type == "expression_statement" and stmt.named_child_count == 1 and \
            stmt.named_children[0].type == "assignment":
        return stmt.named_children[0]
    return None


def _has_calls(src, node):
    for n in walk(node):
        if n.type == "call":
            f = n.child_by_field_name("function")
            if f is None or text(src, f) not in PURE:
                return True
    return False


def _ids(src, node):
    return {text(src, n) for n in walk(node) if n.type == "identifier"}


def _single_line_header(src, node, body):
    """True if the block body starts on the same line as its header (e.g. `for x in y: print(x)`)."""
    return src.count(b"\n", node.start_byte, body.start_byte) == 0


# ------------------------------------------------------------------------------- L3: assignments
def split_tuple(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for n in walk(tree.root_node):
        a = _assign(n)
        if a is None or not starts_line(src, n.start_byte):
            continue
        left, right = a.child_by_field_name("left"), a.child_by_field_name("right")
        if left is None or right is None or left.type != "pattern_list" or right.type != "expression_list":
            continue
        ls, rs = left.named_children, right.named_children
        if len(ls) != len(rs) or any(x.type != "identifier" for x in ls):
            continue
        lnames = {text(src, x) for x in ls}
        if any(_ids(src, r) & lnames for r in rs):
            continue  # a, b = b, a  must stay a tuple swap
        ind = line_indent(src, n.start_byte)
        lines = [text(src, l) + b" = " + text(src, r) for l, r in zip(ls, rs)]
        edits.append((n.start_byte, n.end_byte, (b"\n" + ind).join(lines)))
    return apply_edits(src, edits) if edits else None


def merge_assign(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for blk in _blocks(tree.root_node):
        st = statements(blk, "python")
        i = 0
        while i + 1 < len(st):
            a1, a2 = _assign(st[i]), _assign(st[i + 1])
            ok = False
            if a1 is not None and a2 is not None and rng.random() < 0.6:
                l1, r1 = a1.child_by_field_name("left"), a1.child_by_field_name("right")
                l2, r2 = a2.child_by_field_name("left"), a2.child_by_field_name("right")
                if l1 is not None and l2 is not None and r1 is not None and r2 is not None and \
                        l1.type == "identifier" and l2.type == "identifier" and \
                        a1.child_by_field_name("type") is None and a2.child_by_field_name("type") is None:
                        n1, n2 = text(src, l1), text(src, l2)
                        if n1 != n2 and n1 not in _ids(src, r2) and n2 not in _ids(src, r1) and \
                                not _has_calls(src, r1) and not _has_calls(src, r2) and \
                                r1.type != "expression_list" and r2.type != "expression_list" and \
                                b"\n" not in text(src, r1) + text(src, r2):
                            ok = True
            if ok:
                new = n1 + b", " + n2 + b" = " + text(src, r1) + b", " + text(src, r2)
                edits.append((st[i].start_byte, st[i + 1].end_byte, new))
                i += 2
            else:
                i += 1
    return apply_edits(src, edits) if edits else None


# --------------------------------------------------------------------------------- L4: reorder
def reorder_functions(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    containers = [tree.root_node] + [n.child_by_field_name("body") for n in walk(tree.root_node)
                                     if n.type == "class_definition"]
    for cont in containers:
        if cont is None:
            continue
        st = statements(cont, "python")
        runs, cur = [], []
        for s in st:
            if s.type in ("function_definition", "decorated_definition") or (
                    s.type == "class_definition" and cont.type == "module"):
                cur.append(s)
            else:
                if len(cur) >= 2:
                    runs.append(cur)
                cur = []
        if len(cur) >= 2:
            runs.append(cur)
        for run in runs:
            order = run[:]
            for _ in range(5):
                rng.shuffle(order)
                if [x.start_byte for x in order] != [x.start_byte for x in run]:
                    break
            for slot, m in zip(run, order):
                if slot.start_byte != m.start_byte:
                    edits.append((slot.start_byte, slot.end_byte, text(src, m)))
    return apply_edits(src, edits) if edits else None


def _rw(src, stmt):
    writes, reads = set(), _ids(src, stmt)
    for n in walk(stmt):
        if n.type in ("assignment", "augmented_assignment"):
            left = n.child_by_field_name("left")
            for x in walk(left):
                if x.type == "identifier":
                    writes.add(text(src, x))
                    break
    return writes, reads


def reorder_statements(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for blk in _blocks(tree.root_node):
        st = statements(blk, "python")
        i = 0
        while i + 1 < len(st):
            a, b = st[i], st[i + 1]
            if _assign(a) is not None and _assign(b) is not None and not _has_calls(src, a) and \
                    not _has_calls(src, b) and starts_line(src, a.start_byte) and starts_line(src, b.start_byte) \
                    and b"\n" not in text(src, a) and b"\n" not in text(src, b):
                wa, ra = _rw(src, a)
                wb, rb = _rw(src, b)
                if wa and wb and not (wa & (rb | wb)) and not (wb & ra) and rng.random() < 0.6:
                    edits.append((a.start_byte, a.end_byte, text(src, b)))
                    edits.append((b.start_byte, b.end_byte, text(src, a)))
                    i += 2
                    continue
            i += 1
    return apply_edits(src, edits) if edits else None


# ------------------------------------------------------------------------ L5: statement rewrites
def _range_args(src, call):
    if call is None or call.type != "call":
        return None
    f = call.child_by_field_name("function")
    if f is None or text(src, f) != b"range":
        return None
    args = call.child_by_field_name("arguments")
    if args is None:
        return None
    a = list(args.named_children)
    if not 1 <= len(a) <= 3 or any(x.type in ("keyword_argument", "list_splat", "dictionary_splat") for x in a):
        return None
    return [text(src, x) for x in a]


def for_range_to_while(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for n in walk(tree.root_node):
        if n.type != "for_statement" or rng.random() < 0.3:
            continue
        left, right, body = n.child_by_field_name("left"), n.child_by_field_name("right"), n.child_by_field_name("body")
        if left is None or left.type != "identifier" or body is None or n.child_by_field_name("alternative"):
            continue
        args = _range_args(src, right)
        if args is None or contains_type(body, {"continue_statement"}) or _single_line_header(src, n, body):
            continue
        if not starts_line(src, n.start_byte):
            continue
        v = text(src, left)
        if len(args) == 1:
            start, stop, step = b"0", args[0], b"1"
        elif len(args) == 2:
            start, stop, step = args[0], args[1], b"1"
        else:
            start, stop, step = args
            try:
                sv = int(step.decode())
            except ValueError:
                continue
            if sv == 0:
                continue
        neg = step.startswith(b"-")
        cmp = b">" if neg else b"<"
        ind = line_indent(src, n.start_byte)
        bstmts = statements(body, "python")
        if not bstmts:
            continue
        bind = line_indent(src, bstmts[0].start_byte)
        colon = next((c for c in n.children if c.type == ":"), None)
        if colon is None:
            continue
        rest = src[colon.end_byte:body.end_byte]
        inc = (v + b" -= " + step[1:]) if neg else (v + b" += " + step)
        new = v + b" = " + start + b"\n" + ind + b"while " + v + b" " + cmp + b" " + stop + b":" + rest + \
            b"\n" + bind + inc
        edits.append((n.start_byte, n.end_byte, new))
    return apply_edits(src, edits) if edits else None


def while_to_for_range(src, lang, rng):
    """i = a / while i < b: ... i += 1   ->   for i in range(a, b): ..."""
    tree = parse(src, "python")
    edits = []
    for blk in _blocks(tree.root_node):
        st = statements(blk, "python")
        for i in range(1, len(st)):
            w = st[i]
            if w.type != "while_statement" or w.child_by_field_name("alternative") or rng.random() < 0.3:
                continue
            init = _assign(st[i - 1])
            cond = w.child_by_field_name("condition")
            body = w.child_by_field_name("body")
            if init is None or cond is None or body is None or cond.type != "comparison_operator":
                continue
            left = init.child_by_field_name("left")
            if left is None or left.type != "identifier":
                continue
            v = text(src, left)
            ops = [c for c in cond.children if not c.is_named]
            operands = cond.named_children
            if len(operands) != 2 or len(ops) != 1 or text(src, ops[0]) != b"<" or text(src, operands[0]) != v:
                continue
            bst = statements(body, "python")
            if len(bst) < 2 or contains_type(body, {"continue_statement"}):
                continue
            last = bst[-1]
            ok = False
            if last.type == "expression_statement" and last.named_child_count == 1:
                e = last.named_children[0]
                if e.type == "augmented_assignment" and text(src, e.child_by_field_name("left")) == v and \
                        text(src, e.child_by_field_name("operator")) == b"+=" and \
                        text(src, e.child_by_field_name("right")) == b"1":
                    ok = True
            if not ok:
                continue
            # the loop variable must not be modified elsewhere in the body
            if any(_rw(src, s)[0] & {v} for s in bst[:-1]):
                continue
            stop = text(src, operands[1])
            start = text(src, init.child_by_field_name("right"))
            rng_txt = b"range(" + (stop if start == b"0" and rng.random() < 0.7 else start + b", " + stop) + b")"
            colon = next((c for c in w.children if c.type == ":"), None)
            if colon is None:
                continue
            inner = src[colon.end_byte:bst[-2].end_byte]
            new = b"for " + v + b" in " + rng_txt + b":" + inner
            edits.append((st[i - 1].start_byte, w.end_byte, new))
    return apply_edits(src, edits) if edits else None


def foreach_to_index(src, lang, rng):
    tree = parse(src, "python")
    root = tree.root_node
    gen = _gen(src, root, rng)
    edits = []
    for n in walk(root):
        if n.type != "for_statement" or rng.random() < 0.4:
            continue
        left, right, body = n.child_by_field_name("left"), n.child_by_field_name("right"), n.child_by_field_name("body")
        if left is None or right is None or body is None or left.type != "identifier" or \
                right.type != "identifier" or n.child_by_field_name("alternative") or \
                _single_line_header(src, n, body):
            continue
        bst = statements(body, "python")
        if not bst or text(src, right) in {x for s in bst for x in _rw(src, s)[0]}:
            continue
        idx = gen.fresh("i").encode()
        seq = text(src, right)
        bind = line_indent(src, bst[0].start_byte)
        edits.append((left.start_byte, right.end_byte, idx + b" in range(len(" + seq + b"))"))
        edits.append((bst[0].start_byte, bst[0].start_byte, text(src, left) + b" = " + seq + b"[" + idx + b"]\n" + bind))
    return apply_edits(src, edits) if edits else None


def index_to_foreach(src, lang, rng):
    tree = parse(src, "python")
    root = tree.root_node
    gen = _gen(src, root, rng)
    edits = []
    for n in walk(root):
        if n.type != "for_statement":
            continue
        left, right, body = n.child_by_field_name("left"), n.child_by_field_name("right"), n.child_by_field_name("body")
        if left is None or left.type != "identifier" or body is None:
            continue
        args = _range_args(src, right)
        if not args or len(args) != 1 or not args[0].startswith(b"len(") or not args[0].endswith(b")"):
            continue
        seq = args[0][4:-1].strip()
        i = text(src, left)
        uses, ok = [], True
        for x in walk(body):
            if x.type == "identifier" and text(src, x) == i:
                p = x.parent
                if p is not None and p.type == "subscript" and text(src, p.child_by_field_name("value")) == seq and \
                        p.child_by_field_name("subscript") is not None and \
                        p.child_by_field_name("subscript").start_byte == x.start_byte:
                    gp = p.parent
                    if gp is not None and gp.type in ("assignment", "augmented_assignment") and \
                            gp.child_by_field_name("left") is not None and \
                            gp.child_by_field_name("left").start_byte == p.start_byte:
                        ok = False
                        break
                    uses.append(p)
                else:
                    ok = False
                    break
        if not ok or not uses:
            continue
        item = gen.fresh("item").encode()
        edits.append((left.start_byte, right.end_byte, item + b" in " + seq))
        for p in uses:
            edits.append((p.start_byte, p.end_byte, item))
    return apply_edits(src, edits) if edits else None


def compound_assign(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for n in walk(tree.root_node):
        if rng.random() < 0.4:
            continue
        if n.type == "augmented_assignment":
            left, right, op = n.child_by_field_name("left"), n.child_by_field_name("right"), n.child_by_field_name("operator")
            if left is None or right is None or op is None or _has_calls(src, left):
                continue
            o = text(src, op)[:-1]
            if o not in (b"+", b"-", b"*", b"/", b"//", b"%", b"**"):
                continue
            r = text(src, right)
            if right.type in ("binary_operator", "boolean_operator", "comparison_operator", "conditional_expression",
                              "not_operator", "lambda"):
                r = b"(" + r + b")"
            lt = text(src, left)
            edits.append((n.start_byte, n.end_byte, lt + b" = " + lt + b" " + o + b" " + r))
        elif n.type == "assignment":
            left, right = n.child_by_field_name("left"), n.child_by_field_name("right")
            if left is None or right is None or right.type != "binary_operator" or n.child_by_field_name("type"):
                continue
            rl, rr, rop = right.child_by_field_name("left"), right.child_by_field_name("right"), \
                right.child_by_field_name("operator")
            if rl is None or rr is None or rop is None:
                continue
            o = text(src, rop)
            if o in (b"+", b"-", b"*", b"/", b"//", b"%") and text(src, rl) == text(src, left):
                edits.append((n.start_byte, n.end_byte, text(src, left) + b" " + o + b"= " + text(src, rr)))
    return apply_edits(src, edits) if edits else None


def comparison_flip(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for n in walk(tree.root_node):
        if n.type != "comparison_operator" or rng.random() < 0.5:
            continue
        ops = [c for c in n.children if not c.is_named]
        operands = n.named_children
        if len(ops) != 1 or len(operands) != 2 or text(src, ops[0]) not in COMPARE_OPS:
            continue
        l, r = operands
        if _has_calls(src, l) or _has_calls(src, r):
            continue
        if l.type in ("binary_operator", "boolean_operator", "not_operator", "conditional_expression") or \
                r.type in ("binary_operator", "boolean_operator", "not_operator", "conditional_expression"):
            continue
        edits.append((n.start_byte, n.end_byte, text(src, r) + b" " + COMPARE_OPS[text(src, ops[0])] + b" " + text(src, l)))
    return apply_edits(src, edits) if edits else None


def comprehension_to_loop(src, lang, rng):
    tree = parse(src, "python")
    unit = indent_unit(src)
    edits = []
    for n in walk(tree.root_node):
        a = _assign(n)
        if a is None or not starts_line(src, n.start_byte):
            continue
        left, right = a.child_by_field_name("left"), a.child_by_field_name("right")
        if left is None or right is None or left.type != "identifier" or right.type != "list_comprehension":
            continue
        clauses = [c for c in right.named_children if c.type in ("for_in_clause", "if_clause")]
        fors = [c for c in clauses if c.type == "for_in_clause"]
        ifs = [c for c in clauses if c.type == "if_clause"]
        body = right.child_by_field_name("body")
        if len(fors) != 1 or len(ifs) > 1 or body is None:
            continue
        if b"\n" in text(src, right):
            continue
        fc = fors[0]
        tgt, it = fc.child_by_field_name("left"), fc.child_by_field_name("right")
        if tgt is None or it is None:
            continue
        name = text(src, left)
        ind = line_indent(src, n.start_byte)
        lines = [name + b" = []", ind + b"for " + text(src, tgt) + b" in " + text(src, it) + b":"]
        inner = ind + unit
        if ifs:
            cond = ifs[0].named_children[0] if ifs[0].named_child_count else None
            if cond is None:
                continue
            lines.append(inner + b"if " + text(src, cond) + b":")
            inner += unit
        lines.append(inner + name + b".append(" + text(src, body) + b")")
        edits.append((n.start_byte, n.end_byte, b"\n".join(lines)))
    return apply_edits(src, edits) if edits else None


def loop_to_comprehension(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for blk in _blocks(tree.root_node):
        st = statements(blk, "python")
        for i in range(len(st) - 1):
            a = _assign(st[i])
            loop = st[i + 1]
            if a is None or loop.type != "for_statement" or loop.child_by_field_name("alternative"):
                continue
            left, right = a.child_by_field_name("left"), a.child_by_field_name("right")
            if left is None or right is None or left.type != "identifier" or text(src, right) != b"[]":
                continue
            name = text(src, left)
            body = loop.child_by_field_name("body")
            bst = statements(body, "python") if body is not None else []
            if len(bst) != 1:
                continue
            cond = None
            inner = bst[0]
            if inner.type == "if_statement":
                if inner.child_by_field_name("alternative") is not None:
                    continue
                c = inner.child_by_field_name("consequence")
                cst = statements(c, "python") if c is not None else []
                if len(cst) != 1:
                    continue
                cond = inner.child_by_field_name("condition")
                inner = cst[0]
            if inner.type != "expression_statement" or inner.named_child_count != 1:
                continue
            call = inner.named_children[0]
            if call.type != "call":
                continue
            f = call.child_by_field_name("function")
            args = call.child_by_field_name("arguments")
            if f is None or args is None or text(src, f) != name + b".append" or args.named_child_count != 1:
                continue
            expr = text(src, args.named_children[0])
            tgt, it = loop.child_by_field_name("left"), loop.child_by_field_name("right")
            comp = b"[" + expr + b" for " + text(src, tgt) + b" in " + text(src, it)
            if cond is not None:
                comp += b" if " + text(src, cond)
            comp += b"]"
            if b"\n" in comp:
                continue
            edits.append((st[i].start_byte, loop.end_byte, name + b" = " + comp))
    return apply_edits(src, edits) if edits else None


# ----------------------------------------------------------------------------- L6: logic, padding
def _negate(src, cond):
    if cond.type == "comparison_operator":
        ops = [c for c in cond.children if not c.is_named]
        operands = cond.named_children
        if len(ops) == 1 and len(operands) == 2 and text(src, ops[0]) in NEGATE_OPS:
            return text(src, operands[0]) + b" " + NEGATE_OPS[text(src, ops[0])] + b" " + text(src, operands[1])
    if cond.type == "not_operator":
        arg = cond.child_by_field_name("argument")
        if arg is not None:
            return text(src, arg)
    if cond.type in ("identifier", "call", "attribute", "subscript", "parenthesized_expression"):
        return b"not " + text(src, cond)
    return b"not (" + text(src, cond) + b")"


def flip_if_else(src, lang, rng):
    tree = parse(src, "python")
    edits = []
    for n in walk(tree.root_node):
        if n.type != "if_statement" or rng.random() < 0.3:
            continue
        alts = [c for i, c in enumerate(n.children) if n.field_name_for_child(i) == "alternative"]
        if len(alts) != 1 or alts[0].type != "else_clause":
            continue
        cons = n.child_by_field_name("consequence")
        ebody = alts[0].child_by_field_name("body")
        cond = n.child_by_field_name("condition")
        if cons is None or ebody is None or cond is None:
            continue
        if _single_line_header(src, n, cons) or _single_line_header(src, alts[0], ebody):
            continue
        if line_indent(src, cons.start_byte) != line_indent(src, ebody.start_byte):
            continue
        edits.append((cond.start_byte, cond.end_byte, _negate(src, cond)))
        edits.append((cons.start_byte, cons.end_byte, text(src, ebody)))
        edits.append((ebody.start_byte, ebody.end_byte, text(src, cons)))
    return apply_edits(src, edits) if edits else None


DEAD_PY = ["{t} = 0", "{t} = False", "if False:\n{ind}{unit}pass", "{t} = len([])", "{t} = None", "pass",
           "for {u} in range(0):\n{ind}{unit}pass", "{t} = {k} * 0", "{t} = []"]


def dead_code(src, lang, rng):
    tree = parse(src, "python")
    root = tree.root_node
    gen = _gen(src, root, rng)
    unit = indent_unit(src)
    cands = []
    for blk in _blocks(root):
        for st in statements(blk, "python"):
            if st.type in TERMINATORS["python"] or not starts_line(src, st.start_byte):
                continue
            if st.type in ("function_definition", "class_definition", "decorated_definition") and blk.type == "module":
                continue
            if st.type == "expression_statement" and st.named_child_count and \
                    st.named_children[0].type in ("string",):
                continue
            cands.append(st)
    seen_end = set()
    cands = [c for c in cands if not (c.end_byte in seen_end or seen_end.add(c.end_byte))]
    edits = []
    if cands:
        for st in rng.sample(cands, min(len(cands), rng.randint(1, 3))):
            ind = line_indent(src, st.start_byte)
            code = rng.choice(DEAD_PY).format(t=gen.fresh("tmp"), u=gen.fresh("k"), k=rng.randint(1, 9),
                                              ind=ind.decode(), unit=unit.decode())
            edits.append((st.end_byte, st.end_byte, b"\n" + ind + code.encode()))
    if rng.random() < 0.3:
        first = next((c for c in root.named_children if c.type in ("function_definition", "decorated_definition")), None)
        if first is not None and not line_indent(src, first.start_byte):
            name = gen.fresh("helper", "func").encode()
            fn = b"def " + name + b"(x):\n" + unit + b"return x\n\n\n"
            edits.append((first.start_byte, first.start_byte, fn))
    return apply_edits(src, edits) if edits else None


def extract_temp(src, lang, rng):
    tree = parse(src, "python")
    root = tree.root_node
    gen = _gen(src, root, rng)
    edits = []
    for n in walk(root):
        a = _assign(n)
        if a is None or not starts_line(src, n.start_byte) or rng.random() < 0.5:
            continue
        right = a.child_by_field_name("right")
        if right is None or right.type != "binary_operator" or b"\n" in text(src, right):
            continue
        l, r = right.child_by_field_name("left"), right.child_by_field_name("right")
        sub = l if l is not None and l.type in ("binary_operator", "call", "parenthesized_expression") else r
        if sub is None or sub.type not in ("binary_operator", "call", "parenthesized_expression"):
            continue
        st = text(src, sub)
        if st.startswith(b"(") and st.endswith(b")"):
            st = st[1:-1]
        tmp = gen.fresh("tmp").encode()
        ind = line_indent(src, n.start_byte)
        edits.append((n.start_byte, n.start_byte, tmp + b" = " + st + b"\n" + ind))
        edits.append((sub.start_byte, sub.end_byte, tmp))
    return apply_edits(src, edits) if edits else None


def redundant_parens(src, lang, rng):
    tree = parse(src, "python")
    cands = [n for n in walk(tree.root_node)
             if n.type in ("binary_operator", "comparison_operator") and n.parent is not None
             and n.parent.type != "parenthesized_expression" and b"\n" not in text(src, n)]
    if not cands:
        return None
    picked = []
    for n in rng.sample(cands, len(cands)):
        if len(picked) >= 3:
            break
        if any(not (n.end_byte <= p.start_byte or n.start_byte >= p.end_byte) for p in picked):
            continue
        picked.append(n)
    edits = []
    for n in picked:
        edits.append((n.start_byte, n.start_byte, b"("))
        edits.append((n.end_byte, n.end_byte, b")"))
    return apply_edits(src, edits)
