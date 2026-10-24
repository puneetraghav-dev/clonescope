"""Level 2 disguise: consistent renaming of user-defined identifiers.

Only names that are *declared in the file* are renamed (variables, parameters,
functions, classes, struct fields, self.attributes). Library names are left
alone, so the program keeps working.
"""
from __future__ import annotations

from .core import apply_edits, parse, text, walk
from .names import RESERVED, NameGenerator

PY_PROTECT = {"self", "cls", "main", "_"}
JAVA_PROTECT = {"main", "toString", "equals", "hashCode", "compareTo", "compare", "run", "clone",
                "finalize", "iterator", "hasNext", "next", "close", "accept", "apply", "test",
                "call", "get", "set", "args"}
C_PROTECT = {"main", "argc", "argv"}


def _same(a, b) -> bool:
    return a is not None and b is not None and a.start_byte == b.start_byte and a.end_byte == b.end_byte \
        and a.type == b.type


# --------------------------------------------------------------------------------------- Python
def _py_targets(node, out):
    if node is None:
        return
    t = node.type
    if t == "identifier":
        out.append(node)
    elif t in ("pattern_list", "tuple_pattern", "list_pattern", "tuple", "list", "parenthesized_expression",
               "list_splat_pattern", "expression_list"):
        for ch in node.named_children:
            _py_targets(ch, out)


def _py_params(src, params, out: set):
    if params is None:
        return
    for ch in params.named_children:
        t = ch.type
        if t == "identifier":
            out.add(text(src, ch))
        elif t in ("default_parameter", "typed_default_parameter"):
            nm = ch.child_by_field_name("name")
            if nm is not None and nm.type == "identifier":
                out.add(text(src, nm))
        elif t in ("typed_parameter", "list_splat_pattern", "dictionary_splat_pattern"):
            for c in ch.named_children:
                if c.type == "identifier":
                    out.add(text(src, c))
                    break


def _collect_python(src, root):
    vars_, funcs, types, fields, imported, called = set(), set(), set(), set(), set(), set()
    for n in walk(root):
        t = n.type
        if t == "function_definition":
            funcs.add(text(src, n.child_by_field_name("name")))
            _py_params(src, n.child_by_field_name("parameters"), vars_)
        elif t == "lambda":
            _py_params(src, n.child_by_field_name("parameters"), vars_)
        elif t == "class_definition":
            types.add(text(src, n.child_by_field_name("name")))
        elif t in ("assignment", "augmented_assignment"):
            left = n.child_by_field_name("left")
            ids = []
            _py_targets(left, ids)
            vars_ |= {text(src, i) for i in ids}
            cands = [left] + (list(left.named_children) if left is not None else [])
            for a in cands:
                if a is not None and a.type == "attribute":
                    obj, attr = a.child_by_field_name("object"), a.child_by_field_name("attribute")
                    if obj is not None and text(src, obj) == b"self" and attr is not None:
                        fields.add(text(src, attr))
        elif t in ("for_statement", "for_in_clause"):
            ids = []
            _py_targets(n.child_by_field_name("left"), ids)
            vars_ |= {text(src, i) for i in ids}
        elif t == "as_pattern":
            alias = n.child_by_field_name("alias")
            if alias is not None:
                for c in walk(alias):
                    if c.type == "identifier":
                        vars_.add(text(src, c))
        elif t == "named_expression":
            nm = n.child_by_field_name("name")
            if nm is not None:
                vars_.add(text(src, nm))
        elif t in ("global_statement", "nonlocal_statement"):
            for c in n.named_children:
                if c.type == "identifier":
                    vars_.add(text(src, c))
        elif t in ("import_statement", "import_from_statement", "future_import_statement"):
            for c in walk(n):
                if c.type == "identifier":
                    imported.add(text(src, c))
        elif t == "call":
            f = n.child_by_field_name("function")
            if f is not None and f.type == "identifier":
                called.add(text(src, f))
    return vars_, funcs, types, fields, imported, called


def _rename_python(src, root, rng, frac):
    vars_, funcs, types, fields, imported, called = _collect_python(src, root)
    dec = lambda s: {x.decode("utf-8", "replace") for x in s}
    vars_, funcs, types, fields, imported, called = map(dec, (vars_, funcs, types, fields, imported, called))
    builtin_called = {c for c in called if c in RESERVED and c not in funcs}
    candidates = {}
    for name in vars_ | funcs | types:
        if name in PY_PROTECT or name in imported or (name.startswith("__") and name.endswith("__")):
            continue
        if name in builtin_called:
            continue
        candidates[name] = "type" if name in types else "func" if name in funcs else "var"
    field_cands = {f for f in fields if f not in RESERVED and not f.startswith("__") and f not in PY_PROTECT}
    taken = {text(src, n).decode("utf-8", "replace") for n in walk(root) if n.type == "identifier"}
    gen = NameGenerator(rng, taken)
    mapping = _choose(candidates, gen, rng, frac)
    fmap = {}
    for f in sorted(field_cands):
        if rng.random() < frac:
            fmap[f] = gen.fresh(f, "var")
    if not mapping and not fmap:
        return None
    edits = []
    for n in walk(root):
        if n.type != "identifier":
            continue
        name = text(src, n).decode("utf-8", "replace")
        p = n.parent
        if p is not None and p.type == "attribute" and _same(p.child_by_field_name("attribute"), n):
            if name in fmap:
                edits.append((n.start_byte, n.end_byte, fmap[name].encode()))
            continue
        if p is not None and p.type == "keyword_argument" and _same(p.child_by_field_name("name"), n):
            call = p.parent.parent if p.parent is not None else None
            fn = call.child_by_field_name("function") if call is not None and call.type == "call" else None
            user = False
            if fn is not None:
                if fn.type == "identifier":
                    user = text(src, fn).decode() in funcs
                elif fn.type == "attribute":
                    a = fn.child_by_field_name("attribute")
                    user = a is not None and text(src, a).decode() in funcs
            if user and name in mapping:
                edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
            continue
        if p is not None and p.type in ("dotted_name", "aliased_import"):
            continue
        if name in mapping:
            edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
    return apply_edits(src, edits) if edits else None


# ----------------------------------------------------------------------------------------- Java
def _collect_java(src, root):
    vars_, methods, types = set(), set(), set()
    for n in walk(root):
        t = n.type
        if t in ("class_declaration", "interface_declaration", "enum_declaration", "record_declaration"):
            nm = n.child_by_field_name("name")
            if nm is not None:
                types.add(text(src, nm))
        elif t == "method_declaration":
            nm = n.child_by_field_name("name")
            if nm is not None:
                methods.add(text(src, nm))
        elif t in ("variable_declarator", "formal_parameter", "catch_formal_parameter", "enhanced_for_statement",
                   "enum_constant", "resource"):
            nm = n.child_by_field_name("name")
            if nm is not None and nm.type == "identifier":
                vars_.add(text(src, nm))
        elif t == "lambda_expression":
            ps = n.child_by_field_name("parameters")
            if ps is not None:
                if ps.type == "identifier":
                    vars_.add(text(src, ps))
                elif ps.type == "inferred_parameters":
                    for c in ps.named_children:
                        if c.type == "identifier":
                            vars_.add(text(src, c))
    return vars_, methods, types


def _rename_java(src, root, rng, frac):
    vars_, methods, types = (_dec(s) for s in _collect_java(src, root))
    cands = {}
    for v in vars_:
        if v not in JAVA_PROTECT:
            cands[v] = "var"
    for m in methods:
        if m not in JAVA_PROTECT and m not in RESERVED:
            cands[m] = "func"
    for ty in types:
        if ty not in RESERVED:
            cands[ty] = "type"
    taken = {text(src, n).decode("utf-8", "replace") for n in walk(root) if n.type in ("identifier", "type_identifier")}
    gen = NameGenerator(rng, taken)
    mapping = _choose(cands, gen, rng, frac)
    if not mapping:
        return None
    edits = []
    for n in walk(root):
        if n.type not in ("identifier", "type_identifier"):
            continue
        name = text(src, n).decode("utf-8", "replace")
        if name not in mapping:
            continue
        kind = cands[name]
        p = n.parent
        ptype = p.type if p is not None else ""
        if n.type == "type_identifier":
            if kind == "type":
                edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
            continue
        if ptype in ("method_invocation", "method_declaration") and _same(p.child_by_field_name("name"), n):
            if kind == "func":
                edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
            continue
        if ptype == "scoped_identifier" or ptype == "method_reference":
            continue
        edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
    return apply_edits(src, edits) if edits else None


# ------------------------------------------------------------------------------------- C / C++
_DECL_CHAIN = ("init_declarator", "pointer_declarator", "array_declarator", "function_declarator",
               "parenthesized_declarator", "reference_declarator", "attributed_declarator")


def _dig(node):
    """Returns (name_node, is_function) for a declarator."""
    is_fn = False
    while node is not None:
        t = node.type
        if t in ("identifier", "field_identifier", "type_identifier"):
            return node, is_fn
        if t == "function_declarator":
            is_fn = True
        if t in _DECL_CHAIN:
            d = node.child_by_field_name("declarator")
            if d is None:
                d = next((c for c in node.named_children if c.type not in ("type_qualifier",)), None)
            node = d
            continue
        return None, is_fn
    return None, is_fn


def _collect_c(src, root):
    vars_, funcs, fields, types, called = set(), set(), set(), set(), set()
    for n in walk(root):
        t = n.type
        if t in ("function_definition", "declaration", "field_declaration", "parameter_declaration",
                 "optional_parameter_declaration", "for_range_loop"):
            for i, ch in enumerate(n.children):
                if n.field_name_for_child(i) != "declarator":
                    continue
                nm, is_fn = _dig(ch)
                if nm is None:
                    continue
                name = text(src, nm)
                if nm.type == "field_identifier":
                    fields.add(name)
                elif is_fn:
                    funcs.add(name)
                elif nm.type == "identifier":
                    vars_.add(name)
        elif t in ("struct_specifier", "union_specifier", "enum_specifier", "class_specifier"):
            nm, body = n.child_by_field_name("name"), n.child_by_field_name("body")
            if nm is not None and body is not None and nm.type == "type_identifier":
                types.add(text(src, nm))
        elif t == "type_definition":
            for i, ch in enumerate(n.children):
                if n.field_name_for_child(i) == "declarator":
                    nm, _ = _dig(ch)
                    if nm is not None and nm.type == "type_identifier":
                        types.add(text(src, nm))
        elif t == "enumerator":
            nm = n.child_by_field_name("name")
            if nm is not None:
                vars_.add(text(src, nm))
        elif t in ("preproc_def", "preproc_function_def"):
            nm = n.child_by_field_name("name")
            if nm is not None:
                vars_.add(text(src, nm))
        elif t == "call_expression":
            f = n.child_by_field_name("function")
            if f is not None and f.type == "identifier":
                called.add(text(src, f))
    return vars_, funcs, fields, types, called


def _rename_c(src, root, rng, frac, lang):
    vars_, funcs, fields, types, called = (_dec(s) for s in _collect_c(src, root))
    lib_called = {c for c in called if c not in funcs}
    cands = {}
    for v in vars_:
        if v not in C_PROTECT and v not in lib_called:
            cands[v] = "var"
    for f in funcs:
        if f not in C_PROTECT and f not in RESERVED:
            cands[f] = "func"
    fcands = {f: "var" for f in fields if f not in RESERVED}
    tcands = {ty: "type" for ty in types if ty not in RESERVED}
    taken = {text(src, n).decode("utf-8", "replace") for n in walk(root)
             if n.type in ("identifier", "field_identifier", "type_identifier")}
    gen = NameGenerator(rng, taken)
    # constructors/destructors share the class name: rename them together with the type
    for ty in tcands:
        cands.pop(ty, None)
    mapping = _choose(cands, gen, rng, frac)
    fmap = _choose(fcands, gen, rng, frac)
    tmap = _choose(tcands, gen, rng, frac)
    for ty, new in tmap.items():
        mapping[ty] = new
    # C++ methods use fields without `this->`: a member name must map to one new name everywhere
    for f in list(fmap):
        if f in mapping:
            fmap[f] = mapping[f]
        elif f in cands:
            mapping[f] = fmap[f]
        elif lang == "cpp":
            mapping[f] = fmap[f]
    if not (mapping or fmap or tmap):
        return None
    edits = []
    for n in walk(root):
        t = n.type
        if t == "identifier":
            name = text(src, n).decode("utf-8", "replace")
            p = n.parent
            if p is not None and p.type in ("qualified_identifier", "namespace_identifier"):
                continue
            if name in mapping:
                edits.append((n.start_byte, n.end_byte, mapping[name].encode()))
        elif t == "field_identifier":
            name = text(src, n).decode("utf-8", "replace")
            if name in fmap:
                edits.append((n.start_byte, n.end_byte, fmap[name].encode()))
        elif t == "type_identifier":
            name = text(src, n).decode("utf-8", "replace")
            if name in tmap:
                edits.append((n.start_byte, n.end_byte, tmap[name].encode()))
    return apply_edits(src, edits) if edits else None


# ---------------------------------------------------------------------------------------- shared
def _dec(s):
    return {x.decode("utf-8", "replace") for x in s}


def _choose(cands: dict, gen: NameGenerator, rng, frac: float) -> dict:
    names = sorted(cands)
    rng.shuffle(names)
    k = max(1, round(frac * len(names))) if names else 0
    return {nm: gen.fresh(nm, cands[nm]) for nm in names[:k]}


def rename(src: bytes, lang: str, rng, frac: float | None = None):
    if frac is None:
        frac = rng.uniform(0.55, 1.0)
    root = parse(src, lang).root_node
    if lang == "python":
        return _rename_python(src, root, rng, frac)
    if lang == "java":
        return _rename_java(src, root, rng, frac)
    return _rename_c(src, root, rng, frac, lang)
