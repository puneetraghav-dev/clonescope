// Class-level analysis: submissions in, ranked suspicious pairs and copy groups out.
import { detectLanguage, KIND, languageFamily, LANGUAGE_NAMES, tokenize } from './tokenizer.js';
import { fingerprintSet, fingerprintSimilarity, winnow } from './winnow.js';
import { greedyStringTiling, tilingSimilarity } from './gst.js';
import { cosine } from './model.js';
import { fuse, FALLBACK_FUSION } from './fusion.js';

export const PARAMS = { k: 6, w: 4, minMatch: 8, maxTokens: 12000 };

const IGNORE = /(^|\/)(__MACOSX|\.git|\.svn|\.idea|\.vscode|node_modules|__pycache__|bin|obj|build|out|target|venv|\.venv|dist|cmake-build-[^/]*)\//i;

function prettyName(key) {
  let s = key.replace(/\.[^./]+$/, '');
  s = s.replace(/_assignsubmission_[a-z]+_?$/i, '').replace(/_\d{4,}$/, ''); // Moodle export folders
  return s.replace(/[_]+/g, ' ').trim() || key;
}

/**
 * Groups uploaded files into submissions.
 * - one sub-folder per student  -> one submission per folder (all its source files)
 * - a flat list of files        -> one submission per file
 * @param {{path:string,text:string}[]} files
 */
export function groupFiles(files) {
  const src = files
    .map((f) => ({ ...f, path: String(f.path).replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter((f) => !IGNORE.test(f.path) && !/(^|\/)\.[^/]/.test(f.path) && detectLanguage(f.path, f.text));
  if (!src.length) return [];
  let parts = src.map((f) => f.path.split('/'));
  while (parts.every((p) => p.length > 1) && parts.every((p) => p[0] === parts[0][0])) parts = parts.map((p) => p.slice(1));
  const nested = parts.filter((p) => p.length > 1).length;
  const byFolder = nested >= parts.length / 2;
  const groups = new Map();
  parts.forEach((p, i) => {
    const key = byFolder && p.length > 1 ? p[0] : p.join('/');
    const rel = byFolder && p.length > 1 ? p.slice(1).join('/') : p[p.length - 1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ path: rel, text: src[i].text });
  });
  return [...groups.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))
    .map(([key, fs], i) => ({ id: `s${i}`, name: prettyName(key), key, files: fs.sort((a, b) => a.path.localeCompare(b.path)) }));
}

function concatTokens(files) {
  let total = 0;
  for (const f of files) total += f.tok.n;
  const ids = new Uint16Array(total), file = new Uint16Array(total), local = new Int32Array(total);
  let p = 0;
  files.forEach((f, fi) => {
    for (let i = 0; i < f.tok.n; i++) { ids[p] = f.tok.ids[i]; file[p] = fi; local[p] = i; p++; }
  });
  return { ids, file, local };
}

/** Tokenizes the teacher's starter code (if any) so it can be ignored in every submission. */
export function prepareTemplate(files) {
  if (!files || !files.length) return null;
  const fs = files.filter((f) => detectLanguage(f.path, f.text)).map((f) => {
    const lang = detectLanguage(f.path, f.text);
    return { ...f, lang, tok: tokenize(f.text, lang) };
  });
  if (!fs.length) return null;
  return { files: fs, ...concatTokens(fs) };
}

const TRIVIAL_NUMBERS = new Set(['10', '100', '1000', '0.0', '1.0', '0.5', '2.0', '0l', '1l', '0.0f', '1.0f']);
// boilerplate strings every program may contain (not evidence of copying)
const BOILERPLATE = new Set(['__main__', 'utf-8', 'utf8', 'ascii', 'rb', 'wb', 'ab', 'r+', 'w+', 'true', 'false', 'null', 'none']);
const FORMAT_RE = /%[-+ #0]*\d*(?:\.\d+)?[hlLqjzt]*[diouxXeEfFgGaAcspn%]|\\.|\{[^{}]*\}/g;
const QUOTES = /^(?:[A-Za-z0-9]{1,3})?("{3}|'{3}|"|')([\s\S]*?)(?:\1)?$/;

/**
 * Normalized "unusual literal" for one string / char / number token, or null if it is too
 * common to be evidence (single digits, "%d\n", ", ", grade letters...).
 */
export function normalizeLiteral(raw, kind, lang) {
  if (kind === KIND.NUM) {
    const t = raw.toLowerCase();
    if (/^\d$/.test(t) || TRIVIAL_NUMBERS.has(t)) return null;
    return `n:${t}`;
  }
  const isF = lang === 'python' && /^[rRbBuU]?[fF]/.test(raw);
  const m = QUOTES.exec(raw);
  let s = m ? m[2] : raw;
  if (isF) s = s.replace(/\{[^{}]*\}/g, '{}');
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const core = s.replace(FORMAT_RE, '').replace(/[^\p{L}\p{N}]+/gu, '');
  if (core.length < 2 || BOILERPLATE.has(s)) return null;
  return `s:${s}`;
}

/** Set of unusual literals in a submission (starter-code tokens excluded). */
export function literalSet(files, tmask = null) {
  const out = new Set();
  let ci = 0;
  for (const f of files) {
    const t = f.tok;
    for (let i = 0; i < t.n; i++, ci++) {
      if (tmask && tmask[ci]) continue;
      const k = t.kinds[i];
      if (k !== KIND.STR && k !== KIND.CHR && k !== KIND.NUM) continue;
      const lit = normalizeLiteral(f.text.slice(t.starts[i], t.ends[i]), k, f.lang);
      if (lit) out.add(lit);
    }
  }
  return out;
}

/** Shared unusual literals, smoothed: sharing 1 of 1 literal gives 0.5, not 1. */
export function literalShare(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter + 1);
}

/** Tokenizes, removes starter code, fingerprints and embeds one submission. */
export function prepareSubmission(sub, { template = null, encoder = null, params = PARAMS } = {}) {
  const files = sub.files.map((f) => {
    const lang = detectLanguage(f.path, f.text);
    return { path: f.path, text: f.text, lang, tok: tokenize(f.text, lang) };
  });
  const weight = {};
  for (const f of files) weight[f.lang] = (weight[f.lang] || 0) + f.tok.n + 1;
  const lang = Object.entries(weight).sort((a, b) => b[1] - a[1])[0][0];
  const { ids, file, local } = concatTokens(files);
  let tmask = null, templateTokens = 0;
  if (template && template.ids.length >= params.minMatch && ids.length) {
    const g = greedyStringTiling(ids, template.ids, params.minMatch);
    tmask = new Uint8Array(ids.length);
    for (const t of g.tiles) for (let q = 0; q < t.len; q++) tmask[t.a + q] = 1;
    templateTokens = g.matched;
  }
  const keep = [];
  for (let i = 0; i < ids.length && keep.length < params.maxTokens; i++) if (!tmask || !tmask[i]) keep.push(i);
  const kept = Int32Array.from(keep);
  const kids = new Uint16Array(kept.length);
  for (let i = 0; i < kept.length; i++) kids[i] = ids[kept[i]];
  const fp = fingerprintSet(winnow(kids, params.k, params.w));
  const lines = files.reduce((s, f) => s + f.text.split('\n').filter((l) => l.trim()).length, 0);
  return {
    id: sub.id, name: sub.name, key: sub.key ?? sub.name, lang, langName: LANGUAGE_NAMES[lang], family: languageFamily(lang),
    files, ids, file, local, kept, kids, tmask, templateTokens, fp, lines,
    lits: literalSet(files, tmask),
    emb: encoder && kids.length ? encoder.encode(kids) : null,
  };
}

/** All similarity signals + fused score for one pair of prepared submissions. */
export function comparePair(A, B, { fusion, params = PARAMS }) {
  const fs = fingerprintSimilarity(A.fp, B.fp);
  const g = greedyStringTiling(A.kids, B.kids, params.minMatch);
  const ts = tilingSimilarity(g.matched, A.kids.length, B.kids.length);
  const hasNeural = !!(A.emb && B.emb);
  const f = {
    neural: hasNeural ? cosine(A.emb, B.emb) : 0,
    wJaccard: fs.jaccard,
    wContainment: fs.containment,
    gstAvg: ts.avg,
    gstMax: ts.max,
    lenRatio: Math.abs(Math.log((A.kids.length + 1) / (B.kids.length + 1))),
    litShare: literalShare(A.litsU || A.lits, B.litsU || B.lits),
  };
  const model = hasNeural ? (fusion?.full || fusion || FALLBACK_FUSION) : (fusion?.classic || FALLBACK_FUSION);
  const score = fuse(f, model);
  return { a: A.id, b: B.id, ...f, hasNeural, score, tiles: g.tiles, matched: g.matched };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Copy groups = connected components of the graph whose edges are pairs scoring >= threshold. */
export function findGroups(pairs, threshold) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const edges = pairs.filter((p) => p.score >= threshold);
  for (const p of edges) { if (!parent.has(p.a)) parent.set(p.a, p.a); if (!parent.has(p.b)) parent.set(p.b, p.b); }
  for (const p of edges) { const ra = find(p.a), rb = find(p.b); if (ra !== rb) parent.set(ra, rb); }
  const comps = new Map();
  for (const x of parent.keys()) { const r = find(x); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(x); }
  return [...comps.values()].map((members) => {
    const set = new Set(members);
    const es = edges.filter((p) => set.has(p.a) && set.has(p.b));
    return { members, edges: es, maxScore: Math.max(...es.map((e) => e.score)) };
  }).sort((x, y) => y.members.length - x.members.length || y.maxScore - x.maxScore);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Full pipeline.
 * @param {{id,name,files:{path,text}[]}[]} submissions
 * @param {{encoder?, fusion?, templateFiles?, threshold?, onProgress?:(stage,done,total)=>void}} opts
 */
export async function analyzeClass(submissions, opts = {}) {
  const { encoder = null, fusion = null, templateFiles = null, onProgress = () => {} } = opts;
  const params = { ...PARAMS, ...(opts.params || {}) };
  const t0 = Date.now();
  const template = prepareTemplate(templateFiles);
  const prepared = [];
  for (let i = 0; i < submissions.length; i++) {
    prepared.push(prepareSubmission(submissions[i], { template, encoder, params }));
    if (i % 4 === 3) { onProgress('Reading and embedding code', i + 1, submissions.length); await tick(); }
  }
  onProgress('Reading and embedding code', submissions.length, submissions.length);
  const tPrep = Date.now() - t0;
  const byFamily = new Map();
  for (const s of prepared) {
    if (!s.kids.length) continue;
    if (!byFamily.has(s.family)) byFamily.set(s.family, []);
    byFamily.get(s.family).push(s);
  }
  // literals used by many students were probably required by the assignment: they are not evidence
  for (const g of byFamily.values()) {
    const df = new Map();
    for (const s of g) for (const l of s.lits) df.set(l, (df.get(l) || 0) + 1);
    const limit = Math.max(3, Math.ceil(0.4 * g.length));
    for (const s of g) {
      s.litsU = g.length >= 6 ? new Set([...s.lits].filter((l) => df.get(l) < limit)) : s.lits;
    }
  }
  let totalPairs = 0;
  for (const g of byFamily.values()) totalPairs += (g.length * (g.length - 1)) / 2;
  const pairs = [];
  let done = 0;
  for (const g of byFamily.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        pairs.push(comparePair(g[i], g[j], { fusion, params }));
        done++;
        if (done % 150 === 0) { onProgress('Comparing every pair', done, totalPairs); await tick(); }
      }
    }
  }
  onProgress('Comparing every pair', totalPairs, totalPairs);
  // how unusual is each pair compared with the rest of the class?
  const families = [];
  for (const [fam, g] of byFamily) {
    const ps = pairs.filter((p) => g.some((s) => s.id === p.a));
    const scores = ps.map((p) => p.score);
    const med = median(scores);
    const mad = median(scores.map((s) => Math.abs(s - med))) || 0.01;
    for (const p of ps) p.classZ = (p.score - med) / (1.4826 * mad);
    families.push({ family: fam, count: g.length, pairs: ps.length, median: med });
  }
  pairs.sort((x, y) => y.score - x.score);
  const threshold = opts.threshold ?? fusion?.threshold ?? 0.5;
  return {
    submissions: prepared,
    byId: new Map(prepared.map((s) => [s.id, s])),
    pairs, families, threshold,
    groups: findGroups(pairs, threshold),
    usedNeural: !!encoder,
    hasTemplate: !!template,
    timings: { prepareMs: tPrep, totalMs: Date.now() - t0 },
  };
}
