// Unit tests for the JavaScript engine:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tokenize, tokenStrings, detectLanguage, languageFamily, winnow, fingerprintSet, fingerprintSimilarity,
  greedyStringTiling, tilingSimilarity, groupFiles, analyzeClass, explainPair, readZip, decodeText,
  CodeEncoder, vocabHash,
} from '../engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (f) => fs.readFileSync(path.join(HERE, 'fixtures', f), 'utf8');

test('tokenizer normalizes names, literals, comments and docstrings (Python)', () => {
  const a = tokenStrings(tokenize('def f(x):\n    """doc"""\n    # c\n    return x + 1  # inline\n', 'python'));
  const b = tokenStrings(tokenize('def g(value):\n    return value + 42\n', 'python'));
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['def', 'ID', '(', 'ID', ')', ':', 'NEWLINE', 'INDENT', 'return', 'ID', '+', 'NUM', 'NEWLINE', 'DEDENT']);
});

test('tokenizer keeps library calls but not shadowed builtins', () => {
  const t = tokenStrings(tokenize('sum = 0\nprint(sum(range(3)), len(x))\n', 'python'));
  assert.equal(t[0], 'ID');           // variable called sum
  assert.ok(t.includes('print') && t.includes('range') && t.includes('len'));
  assert.equal(t.filter((x) => x === 'sum').length, 1); // the call sum(...)
});

test('tokenizer handles C/C++/Java specifics', () => {
  const c = tokenStrings(tokenize('#include <stdio.h>\n#define N 10\nint main(){ /* x */ char c = \'\\n\'; printf("%d", N); }', 'c'));
  assert.deepEqual(c, ['#define', 'ID', 'NUM', 'int', 'main', '(', ')', '{', 'char', 'ID', '=', 'CHR', ';', 'printf', '(', 'STR', ',', 'ID', ')', ';', '}']);
  const j = tokenStrings(tokenize('package p;\nimport java.util.*;\nclass A { int f(int[] a){ return a.length >>> 1; } }', 'java'));
  assert.ok(!j.includes('import') && !j.includes('package'));
  assert.ok(j.includes('length') && j.includes('>>>'));
  const cpp = tokenStrings(tokenize('int main(){ if (a and not b) std::cout << "x" << std::endl; }', 'cpp'));
  assert.ok(cpp.includes('&&') && cpp.includes('!') && cpp.includes('cout') && cpp.includes('endl'));
});

test('token offsets point back into the source', () => {
  const src = 'int total = count + 1;';
  const t = tokenize(src, 'c');
  assert.equal(src.slice(t.starts[1], t.ends[1]), 'total');
  assert.equal(src.slice(t.starts[3], t.ends[3]), 'count');
});

test('language detection and families', () => {
  assert.equal(detectLanguage('a/b/Main.java'), 'java');
  assert.equal(detectLanguage('x.PY'), 'python');
  assert.equal(detectLanguage('lab.cc'), 'cpp');
  assert.equal(detectLanguage('util.h', 'class A {};'), 'cpp');
  assert.equal(detectLanguage('notes.txt'), null);
  assert.equal(languageFamily('c'), languageFamily('cpp'));
});

test('winnowing is unchanged by renaming and finds shared code', () => {
  const p = fixture('prog.c');
  const q = p.replace(/\bmarks\b/g, 'scores').replace(/\btotal\b/g, 'tot').replace(/\/\*[^]*?\*\//g, '');
  const a = fingerprintSet(winnow(tokenize(p, 'c').ids)), b = fingerprintSet(winnow(tokenize(q, 'c').ids));
  assert.equal(fingerprintSimilarity(a, b).jaccard, 1);
  const other = fingerprintSet(winnow(tokenize(fixture('prog.cpp'), 'cpp').ids));
  assert.ok(fingerprintSimilarity(a, other).jaccard < 0.2);
});

test('greedy string tiling survives reordered functions', () => {
  const a = 'def f(x):\n    return x * 2 + 1\n\ndef g(y):\n    total = 0\n    for i in range(y):\n        total += i\n    return total\n';
  const b = 'def g(y):\n    total = 0\n    for i in range(y):\n        total += i\n    return total\n\ndef f(x):\n    return x * 2 + 1\n';
  const ta = tokenize(a, 'python'), tb = tokenize(b, 'python');
  const g = greedyStringTiling(ta.ids, tb.ids, 6);
  const s = tilingSimilarity(g.matched, ta.n, tb.n);
  assert.ok(s.avg > 0.9, `coverage ${s.avg}`);
  assert.ok(g.tiles.length >= 2);
  for (const t of g.tiles) for (let q = 0; q < t.len; q++) assert.equal(ta.ids[t.a + q], tb.ids[t.b + q]);
});

test('groupFiles: folder per student, Moodle names, flat files', () => {
  const g1 = groupFiles([
    { path: 'Lab5/Asha Rao_1201_assignsubmission_file_/main.c', text: 'int main(){}' },
    { path: 'Lab5/Asha Rao_1201_assignsubmission_file_/util.c', text: 'int u(){}' },
    { path: 'Lab5/Vikram_1202_assignsubmission_file_/main.c', text: 'int main(){}' },
    { path: 'Lab5/Vikram_1202_assignsubmission_file_/readme.txt', text: 'hi' },
    { path: '__MACOSX/Lab5/._main.c', text: 'junk' },
  ]);
  assert.equal(g1.length, 2);
  assert.equal(g1[0].name, 'Asha Rao');
  assert.equal(g1[0].files.length, 2);
  const g2 = groupFiles([{ path: '21CS001.py', text: 'x=1' }, { path: '21CS002.py', text: 'y=2' }]);
  assert.deepEqual(g2.map((s) => s.name), ['21CS001', '21CS002']);
});

test('zip reader inflates entries and nested zips', async () => {
  const buf = fs.readFileSync(path.join(HERE, 'fixtures', 'class.zip'));
  const files = await readZip(buf);
  const names = files.map((f) => f.path).sort();
  assert.ok(names.includes('class/ravi/prog.py'));
  assert.ok(names.some((n) => n.startsWith('class/nested/')), names.join(','));
  const py = files.find((f) => f.path === 'class/ravi/prog.py');
  assert.match(decodeText(py.data), /Student marks analysis/);
});

test('class analysis flags a disguised copy above an independent program', async () => {
  const subs = [
    { id: 's0', name: 'original', files: [{ path: 'a.py', text: fixture('prog.py') }] },
    { id: 's1', name: 'disguised', files: [{ path: 'b.py', text: fixture('prog_disguised.py') }] },
    { id: 's2', name: 'other', files: [{ path: 'c.py', text: 'n = int(input())\nfor i in range(n):\n    print(i * i)\n' }] },
  ];
  const r = await analyzeClass(subs, {});
  const top = r.pairs[0];
  assert.deepEqual([top.a, top.b].sort(), ['s0', 's1']);
  assert.ok(top.gstMax > 0.5);
  const e = explainPair(r.byId.get(top.a), r.byId.get(top.b), top);
  assert.ok(e.findings.some((f) => f.type === 'rename'));
  assert.ok(e.spansA.length > 0 && e.spansB.length > 0);
});

test('neural encoder in JS matches PyTorch (if a trained model is present)', { skip: !fs.existsSync(path.join(HERE, '..', 'model', 'parity.json')) }, () => {
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'model', 'encoder.json'), 'utf8'));
  assert.equal(meta.vocab_hash, vocabHash(), 'model was trained with a different vocabulary');
  const raw = fs.readFileSync(path.join(HERE, '..', 'model', 'encoder.bin'));
  const w = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const enc = new CodeEncoder(meta, w);
  const parity = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'model', 'parity.json'), 'utf8'));
  for (const c of parity.cases) {
    const z = enc.encode(c.ids);
    let maxDiff = 0;
    for (let i = 0; i < z.length; i++) maxDiff = Math.max(maxDiff, Math.abs(z[i] - c.embedding[i]));
    assert.ok(maxDiff < 1e-4, `max diff ${maxDiff}`);
  }
});
