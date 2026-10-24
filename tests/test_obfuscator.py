"""pytest: quick checks of the disguise generator (the full check is tests/check_obfuscator.py)."""
import os
import random
import shutil
import sys
import tempfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "training"))
sys.path.insert(0, HERE)

from obfuscator import OUTPUT_CHANGING, apply_op, disguise, operations  # noqa: E402
from obfuscator.core import is_valid  # noqa: E402
from check_obfuscator import FIXTURES, run_program  # noqa: E402


@pytest.mark.parametrize("lang", ["python", "java", "c", "cpp"])
def test_every_operation_keeps_code_parseable(lang):
    src = open(os.path.join(HERE, "fixtures", FIXTURES[lang]), "rb").read()
    applied = 0
    for level, ops in operations(lang).items():
        for name, fn in ops.items():
            for seed in range(3):
                new = apply_op(src, lang, fn, random.Random(seed))
                if new is not None:
                    applied += 1
                    assert is_valid(new, lang), (lang, name, seed)
    assert applied > 20


@pytest.mark.parametrize("level", [1, 2, 3, 4, 5, 6])
def test_python_disguise_keeps_output(level):
    src = open(os.path.join(HERE, "fixtures", "prog.py")).read()
    with tempfile.TemporaryDirectory() as wd:
        expected = run_program(src, "python", wd)
        for seed in range(3):
            code, ops = disguise(src, "python", level=level, rng=random.Random(seed), exclude=OUTPUT_CHANGING)
            assert ops, "no operation applied"
            assert run_program(code, "python", wd) == expected, ops


@pytest.mark.skipif(shutil.which("gcc") is None, reason="needs gcc")
def test_c_disguise_compiles_and_keeps_output():
    src = open(os.path.join(HERE, "fixtures", "prog.c")).read()
    with tempfile.TemporaryDirectory() as wd:
        expected = run_program(src, "c", wd)
        code, ops = disguise(src, "c", level=6, rng=random.Random(5), exclude=OUTPUT_CHANGING)
        assert run_program(code, "c", wd) == expected, ops


def test_rename_changes_names_but_not_structure():
    src = "def area(width, height):\n    result = width * height\n    return result\n\nprint(area(3, 4))\n"
    from obfuscator.t_rename import rename
    new = rename(src.encode(), "python", random.Random(1), frac=1.0).decode()
    assert "width" not in new and "height" not in new and "print(" in new
    assert new.count("\n") == src.count("\n")
