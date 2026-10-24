"""Structural disguises for C, C++ and Java (levels 3-6)."""
from __future__ import annotations

from .core import (BLOCK_TYPES, CALL_TYPES, TERMINATORS, apply_edits, contains_type, indent_unit, line_indent,
                   line_start, parse, starts_line, statements, strip_semicolon, text, walk, all_names)
from .names import NameGenerator

DECL_TYPES = {"java": {"local_variable_declaration"}, "c": {"declaration"}, "cpp": {"declaration"}}
FIELD_DECL = {"java": {"field_declaration"}, "c": set(), "cpp": set()}
COMPARE_OPS = {b"<": b">", b">": b"<", b"<=": b">=", b">=": b"<=", b"==": b"==", b"!=": b"!="}
NEGATE_OPS = {b"<": b">=", b">": b"<=", b"<=": b">", b">=": b"<", b"==": b"!=", b"!=": b"=="}
PURE_CALLS = {b"sqrt", b"pow", b"abs", b"fabs", b"max", b"min", b"strlen", b"floor", b"ceil", b"length", b"size"}
PRIMITIVE = {b"int", b"long", b"double", b"float", b"short", b"long long", b"unsigned int", b"unsigned"}


def _blocks(root, lang):
    for n in walk(root):
        if n.type in BLOCK_TYPES[lang]:
            yield n


def _in_block(node, lang) -> bool:
    p = node.parent
    return p is not None and (p.type in BLOCK_TYPES[lang] or p.type in ("translation_unit", "class_body"))


def _split_top(s: bytes, sep: bytes) -> list[bytes]:
    """Split on `sep` at nesting depth 0, ignoring separators inside quotes."""
    parts, depth, cur, q, i = [], 0, bytearray(), None, 0
    while i < len(s):
        ch = s[i:i + 1]
        if q:
            cur += ch
            if ch == b"\\" and i + 1 < len(s):
                cur += s[i + 1:i + 2]
                i += 2
                continue
            if ch == q:
                q = None
        elif ch in (b'"', b"'"):
            q = ch
            cur += ch
        elif ch in b"([{":
            depth += 1
            cur += ch
        elif ch in b")]}":
            depth -= 1
            cur += ch
        elif ch == sep and depth == 0:
            parts.append(bytes(cur))
            cur = bytearray()
        else:
            cur += ch
        i += 1
    parts.append(bytes(cur))
    return parts


def _declarators(node):
    return [ch for i, ch in enumerate(node.children) if node.field_name_for_child(i) == "declarator"]


def _decl_name(src, d):
    while d is not None and d.type not in ("identifier", "field_identifier"):
        nxt = d.child_by_field_name("declarator") or d.child_by_field_name("name")
        if nxt is None:
            nxt = next((c for c in d.named_children if c.type in ("identifier", "field_identifier")), None)
        d = nxt
    return text(src, d) if d is not None else None


def _has_calls(node, lang, src) -> bool:
    for n in walk(node):
        if n.type in CALL_TYPES[lang]:
            f = n.child_by_field_name("function") or n.child_by_field_name("name")
            if f is None or text(src, f).split(b".")[-1].split(b"::")[-1] not in PURE_CALLS:
                return True
    return False


# --------------------------------------------------------------------------------- L3: declarations
def split_decl(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type not in DECL_TYPES[lang] | FIELD_DECL[lang] or not _in_block(n, lang):
            continue
        ds = _declarators(n)
        if len(ds) < 2:
            continue
        prefix = src[n.start_byte:ds[0].start_byte]
        ind = line_indent(src, n.start_byte)
        parts = [prefix + text(src, d) + b";" for d in ds]
        edits.append((n.start_byte, n.end_byte, (b"\n" + ind).join(parts)))
    return apply_edits(src, edits) if edits else None


def merge_decl(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for blk in _blocks(tree.root_node, lang):
        st = statements(blk, lang)
        i = 0
        while i + 1 < len(st):
            a, b = st[i], st[i + 1]
            if a.type in DECL_TYPES[lang] and b.type == a.type:
                da, db = _declarators(a), _declarators(b)
                if len(da) == 1 and len(db) == 1:
                    pa = src[a.start_byte:da[0].start_byte]
                    pb = src[b.start_byte:db[0].start_byte]
                    if pa == pb and b"[" not in pa and b"auto" not in pa and b"var" not in pa.split():
                        new = pa + text(src, da[0]) + b", " + text(src, db[0]) + b";"
                        edits.append((a.start_byte, b.end_byte, new))
                        i += 2
                        continue
            i += 1
    return apply_edits(src, edits) if edits else None


def split_init(src, lang, rng):
    """int x = expr;  ->  int x;  x = expr;"""
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type not in DECL_TYPES[lang] or not _in_block(n, lang) or n.parent.type in ("translation_unit", "class_body"):
            continue
        ds = _declarators(n)
        if len(ds) != 1:
            continue
        d = ds[0]
        prefix = src[n.start_byte:d.start_byte]
        words = set(prefix.replace(b"*", b" ").split())
        if words & {b"const", b"final", b"static", b"auto", b"var", b"constexpr", b"&"} or b"&" in prefix:
            continue
        if lang == "java":
            if d.type != "variable_declarator":
                continue
            name, value = d.child_by_field_name("name"), d.child_by_field_name("value")
            if value is None or value.type == "array_initializer":
                continue
            decl_part = text(src, d)[: value.start_byte - d.start_byte].rstrip().rstrip(b"=").rstrip()
        else:
            if d.type != "init_declarator":
                continue
            value = d.child_by_field_name("value")
            inner = d.child_by_field_name("declarator")
            if value is None or inner is None or value.type in ("initializer_list", "argument_list"):
                continue
            if inner.type == "reference_declarator":
                continue
            name = inner
            while name is not None and name.type != "identifier":
                name = name.child_by_field_name("declarator")
            if name is None:
                continue
            decl_part = text(src, inner)
        if rng.random() < 0.6:
            ind = line_indent(src, n.start_byte)
            new = prefix + decl_part + b";\n" + ind + text(src, name) + b" = " + text(src, value) + b";"
            edits.append((n.start_byte, n.end_byte, new))
    return apply_edits(src, edits) if edits else None


def type_change(src, lang, rng):
    """float -> double (C++/Java), int -> long long (C++ locals)."""
    if lang == "c":
        return None
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type not in DECL_TYPES[lang]:
            continue
        ty = n.child_by_field_name("type")
        if ty is None:
            continue
        t = text(src, ty)
        if t == b"float" and rng.random() < 0.8:
            edits.append((ty.start_byte, ty.end_byte, b"double"))
        elif lang == "cpp" and t == b"int" and n.parent.type == "compound_statement" and rng.random() < 0.4:
            edits.append((ty.start_byte, ty.end_byte, rng.choice([b"long long", b"long"])))
    return apply_edits(src, edits) if edits else None


# ---------------------------------------------------------------------------------- L4: reordering
def reorder_functions(src, lang, rng):
    tree = parse(src, lang)
    root = tree.root_node
    edits = []
    if lang == "java":
        for body in (n for n in walk(root) if n.type == "class_body"):
            members = [c for c in body.named_children if c.type in ("method_declaration", "constructor_declaration")]
            if len(members) < 2:
                continue
            order = members[:]
            for _ in range(5):
                rng.shuffle(order)
                if [m.start_byte for m in order] != [m.start_byte for m in members]:
                    break
            for slot, m in zip(members, order):
                if slot.start_byte != m.start_byte:
                    edits.append((slot.start_byte, slot.end_byte, text(src, m)))
        return apply_edits(src, edits) if edits else None
    funcs = [c for c in root.named_children if c.type == "function_definition"]
    if len(funcs) < 2:
        return None
    order = funcs[:]
    for _ in range(5):
        rng.shuffle(order)
        if [m.start_byte for m in order] != [m.start_byte for m in funcs]:
            break
    else:
        return None
    for slot, m in zip(funcs, order):
        if slot.start_byte != m.start_byte:
            edits.append((slot.start_byte, slot.end_byte, text(src, m)))
    # add prototypes so every function is declared before use
    protos = []
    for f in funcs:
        body = f.child_by_field_name("body")
        decl = f.child_by_field_name("declarator")
        if body is None or decl is None:
            continue
        name = _decl_name(src, decl)
        if name == b"main" or name is None:
            continue
        sig = src[f.start_byte:body.start_byte].strip()
        if b"=" in sig or b"::" in sig or b"template" in sig:
            return None
        protos.append(sig + b";")
    if protos:
        edits.append((funcs[0].start_byte, funcs[0].start_byte, b"\n".join(protos) + b"\n\n"))
    return apply_edits(src, edits)


def _rw_sets(src, node, lang):
    writes, reads = set(), set()
    for n in walk(node):
        t = n.type
        if t in ("identifier", "field_identifier"):
            reads.add(text(src, n))
        if t in ("assignment_expression",):
            left = n.child_by_field_name("left")
            for x in walk(left):
                if x.type == "identifier":
                    writes.add(text(src, x))
                    break
        elif t == "update_expression":
            for x in walk(n):
                if x.type == "identifier":
                    writes.add(text(src, x))
                    break
        elif t in DECL_TYPES[lang]:
            for d in _declarators(n):
                nm = _decl_name(src, d)
                if nm:
                    writes.add(nm)
    return writes, reads


def reorder_statements(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    simple = DECL_TYPES[lang] | {"expression_statement"}
    for blk in _blocks(tree.root_node, lang):
        st = statements(blk, lang)
        i = 0
        while i + 1 < len(st):
            a, b = st[i], st[i + 1]
            if a.type in simple and b.type in simple and not _has_calls(a, lang, src) and not _has_calls(b, lang, src) \
                    and starts_line(src, a.start_byte) and starts_line(src, b.start_byte):
                wa, ra = _rw_sets(src, a, lang)
                wb, rb = _rw_sets(src, b, lang)
                if wa and wb and not (wa & (rb | wb)) and not (wb & ra) and rng.random() < 0.6:
                    edits.append((a.start_byte, a.end_byte, text(src, b)))
                    edits.append((b.start_byte, b.end_byte, text(src, a)))
                    i += 2
                    continue
            i += 1
    return apply_edits(src, edits) if edits else None


# ------------------------------------------------------------------------- L5: statement rewrites
def _paren_bounds(node):
    lp = rp = None
    for ch in node.children:
        if ch.type == "(" and lp is None:
            lp = ch
        if ch.type == ")":
            rp = ch
            if node.type == "for_statement":
                break
    return lp, rp


def _body_parts(src, body, lang):
    """Returns (is_block, inner_text) for a loop body."""
    if body.type in ("compound_statement", "block"):
        lb = next(c for c in body.children if c.type == "{")
        rb = [c for c in body.children if c.type == "}"]
        if not rb:
            return None
        return True, src[lb.end_byte:rb[-1].start_byte]
    return False, text(src, body)


def for_to_while(src, lang, rng):
    tree = parse(src, lang)
    root = tree.root_node
    unit = indent_unit(src)
    edits = []
    for n in walk(root):
        if n.type != "for_statement":
            continue
        body = n.child_by_field_name("body")
        if body is None or contains_type(body, {"continue_statement"}) or rng.random() < 0.3:
            continue
        lp, rp = _paren_bounds(n)
        if lp is None or rp is None:
            continue
        header = src[lp.end_byte:rp.start_byte]
        parts = _split_top(header, b";")
        if len(parts) != 3:
            continue
        init, cond, upd = (p.strip() for p in parts)
        if b":" in init and not cond:  # range-for
            continue
        ind = line_indent(src, n.start_byte)
        bind = ind + unit
        cond = cond or (b"true" if lang == "java" else b"1")
        updates = [u.strip() + b";" for u in _split_top(upd, b",") if u.strip()]
        bp = _body_parts(src, body, lang)
        if bp is None:
            continue
        is_block, inner = bp
        tail = b"".join(b"\n" + bind + u for u in updates)
        if is_block:
            new_body = b"{" + inner.rstrip() + tail + b"\n" + ind + b"}"
        else:
            new_body = b"{\n" + bind + inner + tail + b"\n" + ind + b"}"
        loop = b"while (" + cond + b") " + new_body
        new = loop
        if init:
            first = init + b";"
            new = first + b"\n" + ind + loop
            # a declared loop variable could clash with a later declaration of the same name -> wrap
            init_node = n.child_by_field_name("initializer") or n.child_by_field_name("init")
            needs_wrap = not _in_block(n, lang)
            if init_node is not None and init_node.type in DECL_TYPES[lang]:
                nm = None
                ds = _declarators(init_node)
                if ds:
                    nm = _decl_name(src, ds[0])
                fn = n.parent
                while fn is not None and fn.type not in ("function_definition", "method_declaration",
                                                          "constructor_declaration", "lambda_expression"):
                    fn = fn.parent
                scope = fn if fn is not None else root
                cnt = 0
                for x in walk(scope):
                    if x.type in DECL_TYPES[lang] or x.type in ("for_range_loop", "enhanced_for_statement",
                                                                 "formal_parameter", "parameter_declaration"):
                        for d in _declarators(x) or ([x.child_by_field_name("name")] if x.child_by_field_name("name") else []):
                            if d is not None and _decl_name(src, d) == nm:
                                cnt += 1
                if cnt > 1:
                    needs_wrap = True
            if needs_wrap:
                new = b"{\n" + bind + first + b"\n" + bind + loop.replace(b"\n", b"\n" + unit) + b"\n" + ind + b"}"
        elif not _in_block(n, lang):
            pass
        edits.append((n.start_byte, n.end_byte, new))
    return apply_edits(src, edits) if edits else None


def _increment_of(src, node, var):
    """Is `node` (an expression statement) `var++`, `++var`, `var += k` or `var = var + k`?"""
    if node is None or node.type != "expression_statement" or node.named_child_count != 1:
        return None
    e = node.named_children[0]
    return _as_increment(src, e, var)


def _as_increment(src, e, var=None):
    if e.type == "update_expression":
        ids = [c for c in e.children if c.type == "identifier"]
        ops = [c for c in e.children if c.type in ("++", "--")]
        if len(ids) == 1 and ops and (var is None or text(src, ids[0]) == var):
            return text(src, ids[0]), (b"+" if ops[0].type == "++" else b"-"), b"1"
    if e.type == "assignment_expression":
        left, right = e.child_by_field_name("left"), e.child_by_field_name("right")
        op = e.child_by_field_name("operator")
        if left is None or right is None or left.type != "identifier":
            return None
        v = text(src, left)
        if var is not None and v != var:
            return None
        opt = text(src, op) if op is not None else b""
        if opt in (b"+=", b"-=") and right.type in ("number_literal", "decimal_integer_literal"):
            return v, opt[:1], text(src, right)
        if opt == b"=" and right.type == "binary_expression":
            rl, rr = right.child_by_field_name("left"), right.child_by_field_name("right")
            rop = right.child_by_field_name("operator")
            if rl is not None and rr is not None and text(src, rl) == v and \
                    rr.type in ("number_literal", "decimal_integer_literal") and text(src, rop) in (b"+", b"-"):
                return v, text(src, rop), text(src, rr)
    return None


def while_to_for(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for blk in _blocks(tree.root_node, lang):
        st = statements(blk, lang)
        for i, w in enumerate(st):
            if w.type != "while_statement" or rng.random() < 0.3:
                continue
            cond = w.child_by_field_name("condition")
            body = w.child_by_field_name("body")
            if cond is None or body is None or body.type not in ("compound_statement", "block"):
                continue
            if contains_type(body, {"continue_statement"}):
                continue
            ctext = text(src, cond)
            if ctext.startswith(b"(") and ctext.endswith(b")"):
                ctext = ctext[1:-1].strip()
            bst = statements(body, lang)
            if i == 0 or not bst:
                continue
            prev = st[i - 1]
            init_var = init_text = None
            prev_new = b""
            if prev.type == "expression_statement" and prev.named_child_count == 1 and \
                    prev.named_children[0].type == "assignment_expression":
                ae = prev.named_children[0]
                left = ae.child_by_field_name("left")
                op = ae.child_by_field_name("operator")
                if left is not None and left.type == "identifier" and text(src, op) == b"=":
                    init_var, init_text = text(src, left), strip_semicolon(text(src, prev))
                    prev_new = b""
            elif prev.type in DECL_TYPES[lang]:
                ds = _declarators(prev)
                if len(ds) == 1:
                    d = ds[0]
                    nm = _decl_name(src, d)
                    val = d.child_by_field_name("value")
                    if nm and val is not None and d.type in ("init_declarator", "variable_declarator") and \
                            val.type not in ("initializer_list", "array_initializer", "argument_list"):
                        prefix = src[prev.start_byte:d.start_byte]
                        if b"const" not in prefix and b"final" not in prefix and b"auto" not in prefix and \
                                b"var" not in prefix.split():
                            init_var = nm
                            init_text = nm + b" = " + text(src, val)
                            prev_new = prefix + nm + b";"
            last = bst[-1]
            inc = _increment_of(src, last, init_var) if init_var else None
            if not init_var or not inc or init_var not in ctext:
                continue
            v, sign, k = inc
            upd = v + (b"++" if sign == b"+" else b"--") if k == b"1" else v + b" " + sign + b"= " + k
            lb = next(c for c in body.children if c.type == "{")
            inner = src[lb.end_byte:last.start_byte].rstrip()
            ind = line_indent(src, w.start_byte)
            new_loop = b"for (" + init_text + b"; " + ctext + b"; " + upd + b") {" + inner + b"\n" + ind + b"}"
            if prev_new:
                edits.append((prev.start_byte, prev.end_byte, prev_new))
                edits.append((w.start_byte, w.end_byte, new_loop))
            else:
                edits.append((prev.start_byte, w.end_byte, new_loop))
    return apply_edits(src, edits) if edits else None


def increment_style(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    targets = []
    for n in walk(tree.root_node):
        if n.type == "expression_statement" and n.named_child_count == 1:
            targets.append(n.named_children[0])
        elif n.type == "for_statement":
            for i, ch in enumerate(n.children):
                if n.field_name_for_child(i) == "update":
                    targets.append(ch)
    for e in targets:
        inc = _as_increment(src, e)
        if not inc or rng.random() < 0.35:
            continue
        v, sign, k = inc
        if k != b"1":
            forms = [v + b" " + sign + b"= " + k, v + b" = " + v + b" " + sign + b" " + k]
        else:
            forms = [v + sign + sign, sign + sign + v, v + b" " + sign + b"= 1", v + b" = " + v + b" " + sign + b" 1"]
        cur = text(src, e)
        forms = [f for f in forms if f.replace(b" ", b"") != cur.replace(b" ", b"")]
        edits.append((e.start_byte, e.end_byte, rng.choice(forms)))
    return apply_edits(src, edits) if edits else None


def compound_assign(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type != "assignment_expression" or rng.random() < 0.4:
            continue
        left, right, op = n.child_by_field_name("left"), n.child_by_field_name("right"), n.child_by_field_name("operator")
        if left is None or right is None or op is None:
            continue
        if _has_calls(left, lang, src) or contains_type(left, {"update_expression", "assignment_expression"}):
            continue
        ot = text(src, op)
        lt = text(src, left)
        if ot in (b"+=", b"-=", b"*=", b"/=", b"%=") and not (ot in (b"+=", b"-=") and text(src, right) == b"1"):
            r = text(src, right)
            if right.type in ("binary_expression", "conditional_expression", "assignment_expression"):
                r = b"(" + r + b")"
            edits.append((n.start_byte, n.end_byte, lt + b" = " + lt + b" " + ot[:1] + b" " + r))
        elif ot == b"=" and right.type == "binary_expression":
            rl, rr, rop = right.child_by_field_name("left"), right.child_by_field_name("right"), right.child_by_field_name("operator")
            if rl is None or rr is None or rop is None:
                continue
            ro = text(src, rop)
            if ro not in (b"+", b"-", b"*", b"/", b"%"):
                continue
            if text(src, rl) == lt:
                edits.append((n.start_byte, n.end_byte, lt + b" " + ro + b"= " + text(src, rr)))
            elif ro in (b"*",) and text(src, rr) == lt:
                edits.append((n.start_byte, n.end_byte, lt + b" " + ro + b"= " + text(src, rl)))
    return apply_edits(src, edits) if edits else None


def _simple(node, lang, src) -> bool:
    return not _has_calls(node, lang, src) and not contains_type(node, {"update_expression", "assignment_expression"})


def comparison_flip(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type != "binary_expression":
            continue
        op = n.child_by_field_name("operator")
        if op is None or text(src, op) not in COMPARE_OPS or rng.random() < 0.5:
            continue
        l, r = n.child_by_field_name("left"), n.child_by_field_name("right")
        if l is None or r is None or not _simple(l, lang, src) or not _simple(r, lang, src):
            continue
        if l.type == "binary_expression" or r.type == "binary_expression":
            continue
        new = text(src, r) + b" " + COMPARE_OPS[text(src, op)] + b" " + text(src, l)
        edits.append((n.start_byte, n.end_byte, new))
    return apply_edits(src, edits) if edits else None


# --------------------------------------------------------------------------- L6: logic & padding
def _negate(src, cond_inner, lang):
    if cond_inner.type == "binary_expression":
        op = cond_inner.child_by_field_name("operator")
        if op is not None and text(src, op) in NEGATE_OPS:
            l, r = cond_inner.child_by_field_name("left"), cond_inner.child_by_field_name("right")
            return text(src, l) + b" " + NEGATE_OPS[text(src, op)] + b" " + text(src, r)
    if cond_inner.type == "unary_expression" and text(src, cond_inner).startswith(b"!"):
        arg = cond_inner.child_by_field_name("argument")
        if arg is not None:
            t = text(src, arg)
            if t.startswith(b"(") and t.endswith(b")"):
                t = t[1:-1]
            return t
    return b"!(" + text(src, cond_inner) + b")"


def flip_if_else(src, lang, rng):
    tree = parse(src, lang)
    edits = []
    for n in walk(tree.root_node):
        if n.type != "if_statement" or rng.random() < 0.3:
            continue
        cons = n.child_by_field_name("consequence")
        alt = n.child_by_field_name("alternative")
        cond = n.child_by_field_name("condition")
        if cons is None or alt is None or cond is None:
            continue
        if alt.type == "else_clause":
            stmts = [c for c in alt.named_children]
            if len(stmts) != 1:
                continue
            alt = stmts[0]
        if alt.type == "if_statement" or cons.type == "if_statement":
            continue
        inner = cond.named_children[0] if cond.type in ("parenthesized_expression", "condition_clause") and cond.named_child_count == 1 else None
        if inner is None:
            continue
        neg = _negate(src, inner, lang)
        edits.append((inner.start_byte, inner.end_byte, neg))
        edits.append((cons.start_byte, cons.end_byte, text(src, alt)))
        edits.append((alt.start_byte, alt.end_byte, text(src, cons)))
    return apply_edits(src, edits) if edits else None


DEAD_C = [
    "int {t} = 0;", "int {t} = {k};", "if (0) {{ int {t} = 1; {t}++; }}", "for (int {u} = 0; {u} < 0; {u}++) {{ }}",
    "{{ int {t} = {k}; {t} = {t} * 1; }}", "while (0) {{ }}", "int {t} = {k} * 0;",
]
DEAD_JAVA = [
    "int {t} = 0;", "boolean {t} = false;", 'String {t} = "";', 'if (false) {{ System.out.print(""); }}',
    "for (int {u} = 0; {u} < 0; {u}++) {{ }}", "int[] {t} = new int[1];", "int {t} = {k} * 0;", "double {t} = 0.0;",
]


def dead_code(src, lang, rng):
    tree = parse(src, lang)
    root = tree.root_node
    gen = NameGenerator(rng, {x.decode("utf-8", "replace") for x in all_names(src, root)}, style="generic")
    cands = []
    for blk in _blocks(root, lang):
        if blk.parent is None or blk.parent.type in ("translation_unit",):
            continue
        for st in statements(blk, lang):
            if st.type in TERMINATORS[lang] or not starts_line(src, st.start_byte):
                continue
            if st.type in ("labeled_statement", "case_statement"):
                continue
            cands.append(st)
    seen_end = set()
    cands = [c for c in cands if not (c.end_byte in seen_end or seen_end.add(c.end_byte))]
    edits = []
    if cands:
        for st in rng.sample(cands, min(len(cands), rng.randint(1, 3))):
            tpl = rng.choice(DEAD_JAVA if lang == "java" else DEAD_C)
            code = tpl.format(t=gen.fresh("tmp"), u=gen.fresh("k"), k=rng.randint(1, 9))
            edits.append((st.end_byte, st.end_byte, b"\n" + line_indent(src, st.start_byte) + code.encode()))
    if rng.random() < 0.35:
        unit = indent_unit(src)
        name = gen.fresh("helper", "func").encode()
        if lang == "java":
            body = next((n for n in walk(root) if n.type == "class_body"), None)
            if body is not None:
                lb = body.children[0]
                fn = (b"\n" + unit + b"static int " + name + b"(int v) {\n" + unit * 2 + b"return v + 0;\n" + unit + b"}\n")
                edits.append((lb.end_byte, lb.end_byte, fn))
        else:
            first = next((c for c in root.named_children if c.type == "function_definition"), None)
            if first is not None:
                fn = b"int " + name + b"(int a) {\n" + unit + b"return a * 1;\n}\n\n"
                edits.append((first.start_byte, first.start_byte, fn))
    return apply_edits(src, edits) if edits else None


def extract_temp(src, lang, rng):
    tree = parse(src, lang)
    root = tree.root_node
    gen = NameGenerator(rng, {x.decode("utf-8", "replace") for x in all_names(src, root)}, style="generic")
    edits = []
    for n in walk(root):
        if n.type not in DECL_TYPES[lang] or not _in_block(n, lang) or rng.random() < 0.5:
            continue
        ty = n.child_by_field_name("type")
        ds = _declarators(n)
        if ty is None or len(ds) != 1 or text(src, ty) not in PRIMITIVE:
            continue
        d = ds[0]
        val = d.child_by_field_name("value")
        if val is None or val.type != "binary_expression":
            continue
        l, r = val.child_by_field_name("left"), val.child_by_field_name("right")
        sub = l if l is not None and l.type in ("binary_expression", "call_expression", "method_invocation",
                                                "parenthesized_expression") else r
        if sub is None or sub.type not in ("binary_expression", "call_expression", "method_invocation",
                                           "parenthesized_expression"):
            continue
        st = text(src, sub)
        if st.startswith(b"(") and st.endswith(b")"):
            st = st[1:-1]
        tmp = gen.fresh("tmp").encode()
        ind = line_indent(src, n.start_byte)
        edits.append((n.start_byte, n.start_byte, text(src, ty) + b" " + tmp + b" = " + st + b";\n" + ind))
        edits.append((sub.start_byte, sub.end_byte, tmp))
    return apply_edits(src, edits) if edits else None


def redundant_parens(src, lang, rng):
    tree = parse(src, lang)
    cands = []
    for n in walk(tree.root_node):
        if n.type == "binary_expression" and n.parent is not None and n.parent.type not in (
                "parenthesized_expression", "preproc_def", "template_argument_list"):
            cands.append(n)
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
