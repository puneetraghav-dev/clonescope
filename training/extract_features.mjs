// Step 5 - compute every similarity signal for the evaluation pairs, using the exact
// engine code that runs in the browser (so the numbers describe the real app).
//
//   node training/extract_features.mjs [--model model/encoder] [--irplag ../data/irplag_x/IR-Plag-Dataset]
//
// Writes results/features_{val,test,irplag}.jsonl, one line per pair:
//   {pair, dataset, lang, label, level, a, b, neural, wJaccard, wContainment, gstAvg, gstMax, lenRatio, rawTok}
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { tokenize, KIND, VOCAB } from '../engine/tokenizer.js';
import { winnow, fingerprintSet, fingerprintSimilarity } from '../engine/winnow.js';
import { greedyStringTiling, tilingSimilarity } from '../engine/gst.js';
import { CodeEncoder, cosine } from '../engine/model.js';
import { PARAMS, literalSet, literalShare } from '../engine/analyze.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const MODEL = args.model ?? 'model/encoder';
const IRPLAG = args.irplag ?? '../data/irplag_x/IR-Plag-Dataset';
const CORPUS = 'data/corpus';
fs.mkdirSync('results', { recursive: true });

// Neural similarity is filled in afterwards by training/embed_pairs.py (PyTorch, batched - much
// faster; tests/engine.test.mjs checks the JS encoder gives the same embeddings). Pass --neural js
// to compute it here with the browser's JavaScript encoder instead.
let encoder = null;
if (args.neural === 'js' && fs.existsSync(`${MODEL}.json`)) {
  const meta = JSON.parse(fs.readFileSync(`${MODEL}.json`, 'utf8'));
  const raw = fs.readFileSync(`${MODEL}.bin`);
  encoder = new CodeEncoder(meta, new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  console.log('using neural encoder from', MODEL);
} else console.log('neural feature left for embed_pairs.py');

// deterministic RNG
let seed = 12345;
const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };

/** Everything we need about one program. */
function profile(code, lang) {
  const tok = tokenize(code, lang);
  const ids = tok.ids.length > PARAMS.maxTokens ? tok.ids.slice(0, PARAMS.maxTokens) : tok.ids;
  // raw-token baseline: like a naive token matcher - names and literals are NOT normalized
  const rawToks = [];
  for (let i = 0; i < ids.length; i++) {
    const k = tok.kinds[i];
    rawToks.push(k === KIND.ID || k === KIND.NUM || k === KIND.STR || k === KIND.CHR ? code.slice(tok.starts[i], tok.ends[i]) : VOCAB[ids[i]]);
  }
  const shingles = new Set();
  for (let i = 0; i + 5 <= rawToks.length; i++) shingles.add(rawToks.slice(i, i + 5).join('\u0001'));
  const lits = literalSet([{ text: code, lang, tok }]);
  return { ids, fp: fingerprintSet(winnow(ids, PARAMS.k, PARAMS.w)), emb: encoder ? encoder.encode(ids) : null, shingles, lits };
}

function features(A, B) {
  const fs_ = fingerprintSimilarity(A.fp, B.fp);
  const g = greedyStringTiling(A.ids, B.ids, PARAMS.minMatch);
  const ts = tilingSimilarity(g.matched, A.ids.length, B.ids.length);
  let inter = 0;
  for (const s of A.shingles) if (B.shingles.has(s)) inter++;
  const uni = A.shingles.size + B.shingles.size - inter;
  return {
    neural: A.emb && B.emb ? +cosine(A.emb, B.emb).toFixed(5) : 0,
    wJaccard: +fs_.jaccard.toFixed(5), wContainment: +fs_.containment.toFixed(5),
    gstAvg: +ts.avg.toFixed(5), gstMax: +ts.max.toFixed(5),
    lenRatio: +Math.abs(Math.log((A.ids.length + 1) / (B.ids.length + 1))).toFixed(5),
    rawTok: uni ? +(inter / uni).toFixed(5) : 0,
    litShare: +literalShare(A.lits, B.lits).toFixed(5),
  };
}

async function* jsonl(p) {
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

// ------------------------------------------------------------------ synthetic val / test
async function synthetic() {
  const originals = new Map(), variants = new Map();
  for await (const r of jsonl(`${CORPUS}/originals.jsonl`)) if (r.split !== 'train') originals.set(r.id, r);
  for await (const r of jsonl(`${CORPUS}/variants.jsonl`)) if (r.split !== 'train') variants.set(r.id, r);
  const prof = new Map();
  const P = (r) => { if (!prof.has(r.id)) prof.set(r.id, profile(r.code, r.lang)); return prof.get(r.id); };
  const minTokens = (r) => P(r).ids.length >= 20;
  const tp = [];
  for await (const p of jsonl(`${CORPUS}/task_pairs.jsonl`)) tp.push(p);
  for (const split of ['val', 'test']) {
    const out = fs.createWriteStream(`results/features_${split}.jsonl`);
    const origs = [...originals.values()].filter((r) => r.split === split && minTokens(r));
    let pos = 0, hard = 0, rnd = 0;
    for (const o of origs) {
      for (const tag of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R1', 'R2']) {
        const v = variants.get(`${o.id}_${tag}`);
        if (!v) continue;
        out.write(JSON.stringify({ pair: `${o.id}|${v.id}`, dataset: `synthetic-${split}`, lang: o.lang, label: 1, level: tag, a: o.id, b: v.id, ...features(P(o), P(v)) }) + '\n');
        pos++;
      }
    }
    const ids = new Set(origs.map((r) => r.id));
    for (const p of tp) {
      if (!ids.has(p.a) || !ids.has(p.b) || p.gst_max >= 0.5) continue; // >= 0.5: same author's variant, not independent
      out.write(JSON.stringify({ pair: `${p.a}|${p.b}`, dataset: `synthetic-${split}`, lang: originals.get(p.a).lang, label: 0, level: 'same-task', a: p.a, b: p.b, ...features(P(originals.get(p.a)), P(originals.get(p.b))) }) + '\n');
      hard++;
    }
    const byLang = {};
    for (const o of origs) (byLang[o.lang] ??= []).push(o);
    const target = 3000;
    while (rnd < target) {
      const langs = Object.keys(byLang);
      const L = byLang[langs[Math.floor(rand() * langs.length)]];
      const a = L[Math.floor(rand() * L.length)], b = L[Math.floor(rand() * L.length)];
      if (a.id === b.id || a.task === b.task) continue;
      out.write(JSON.stringify({ pair: `${a.id}|${b.id}`, dataset: `synthetic-${split}`, lang: a.lang, label: 0, level: 'different-task', a: a.id, b: b.id, ...features(P(a), P(b)) }) + '\n');
      rnd++;
    }
    out.end();
    console.log(split, { positives: pos, sameTaskNegatives: hard, randomNegatives: rnd });
  }
}

// ---------------------------------------------------------------------------- IR-Plag
function listJava(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJava(p));
    else if (e.name.endsWith('.java')) out.push(p);
  }
  return out.sort();
}

function irplag() {
  if (!fs.existsSync(IRPLAG)) { console.log('IR-Plag not found at', IRPLAG); return; }
  const out = fs.createWriteStream('results/features_irplag.jsonl');
  const idsOut = {};
  let n = 0;
  for (const c of fs.readdirSync(IRPLAG).filter((d) => d.startsWith('case-')).sort()) {
    const base = path.join(IRPLAG, c);
    const orig = listJava(path.join(base, 'original'))[0];
    const rel = (p) => path.relative(IRPLAG, p);
    const prof = (p) => { const P = profile(fs.readFileSync(p, 'utf8'), 'java'); idsOut[rel(p)] = Array.from(P.ids); return P; };
    const O = prof(orig);
    for (const f of listJava(path.join(base, 'non-plagiarized'))) {
      out.write(JSON.stringify({ pair: `${rel(orig)}|${rel(f)}`, dataset: 'irplag', case: c, lang: 'java', label: 0, level: 'independent', a: rel(orig), b: rel(f), ...features(O, prof(f)) }) + '\n');
      n++;
    }
    for (const L of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      const d = path.join(base, 'plagiarized', L);
      if (!fs.existsSync(d)) continue;
      for (const f of listJava(d)) {
        out.write(JSON.stringify({ pair: `${rel(orig)}|${rel(f)}`, dataset: 'irplag', case: c, lang: 'java', label: 1, level: L, a: rel(orig), b: rel(f), ...features(O, prof(f)) }) + '\n');
        n++;
      }
    }
  }
  out.end();
  fs.writeFileSync('results/irplag_ids.json', JSON.stringify(idsOut));
  console.log('irplag pairs', n);
}

// ---------------------------------------------------------------------------- stress test
async function stress() {
  if (!fs.existsSync(`${CORPUS}/stress.jsonl`)) { console.log('no stress.jsonl - run training/stress_test.py'); return; }
  const originals = new Map();
  for await (const r of jsonl(`${CORPUS}/originals.jsonl`)) if (r.split === 'test') originals.set(r.id, r);
  const prof = new Map();
  const P = (r) => { if (!prof.has(r.id)) prof.set(r.id, profile(r.code, r.lang)); return prof.get(r.id); };
  const out = fs.createWriteStream('results/features_stress.jsonl');
  const ids = {};
  let pos = 0;
  for await (const v of jsonl(`${CORPUS}/stress.jsonl`)) {
    const o = originals.get(v.orig);
    if (!o || P(o).ids.length < 20) continue;
    const pv = P(v);
    ids[v.id] = Array.from(pv.ids);
    out.write(JSON.stringify({ pair: `${o.id}|${v.id}`, dataset: 'stress', lang: o.lang, label: 1, level: `S${v.rounds}`, a: o.id, b: v.id, ...features(P(o), pv) }) + '\n');
    pos++;
  }
  // the same negatives as the synthetic test split
  for await (const r of jsonl('results/features_test.jsonl')) {
    if (r.label === 0) out.write(JSON.stringify({ ...r, dataset: 'stress' }) + '\n');
  }
  out.end();
  fs.writeFileSync('results/stress_ids.json', JSON.stringify(ids));
  console.log('stress positives', pos);
}

if (!args.only || args.only === 'synthetic') await synthetic();
if (!args.only || args.only === 'irplag') irplag();
if (!args.only || args.only === 'stress') await stress();
