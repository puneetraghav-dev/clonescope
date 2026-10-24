// Explanations: *why* a pair was flagged, in plain words, plus the code regions to highlight.
import { KIND, VOCAB } from './tokenizer.js';
import { normalizeLiteral } from './analyze.js';

const ID = (t) => VOCAB.indexOf(t);
const T_FOR = ID('for'), T_WHILE = ID('while'), T_INC = ID('++'), T_DEC = ID('--'), T_PLUSEQ = ID('+='),
  T_MINUSEQ = ID('-='), T_NOT = ID('!'), T_NOTKW = ID('not'), T_IF = ID('if'), T_ELSE = ID('else');

function tokAt(S, k) { // k = index into S.kids
  const ci = S.kept[k];
  const f = S.file[ci], l = S.local[ci];
  const file = S.files[f];
  return { f, l, file, kind: file.tok.kinds[l], start: file.tok.starts[l], end: file.tok.ends[l], line: file.tok.lines[l] };
}

function raw(t) { return t.file.text.slice(t.start, t.end); }

/** Character spans to highlight for a run of tokens [k0, k0+len) of submission S. */
function spansFor(S, k0, len, tile) {
  const spans = [];
  let cur = null;
  for (let q = 0; q < len; q++) {
    const t = tokAt(S, k0 + q);
    if (t.end <= t.start) continue; // zero-width INDENT/DEDENT/NEWLINE
    if (cur && cur.file === t.f && S.kept[k0 + q] === cur.lastCi + 1) {
      cur.end = t.end; cur.lastCi = S.kept[k0 + q]; cur.endLine = t.line;
    } else if (cur && cur.file === t.f && S.kept[k0 + q] > cur.lastCi) {
      // tokens skipped as starter code split the span
      spans.push(cur);
      cur = { file: t.f, start: t.start, end: t.end, lastCi: S.kept[k0 + q], tile, line: t.line, endLine: t.line };
    } else {
      if (cur) spans.push(cur);
      cur = { file: t.f, start: t.start, end: t.end, lastCi: S.kept[k0 + q], tile, line: t.line, endLine: t.line };
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

function lisLength(arr) {
  const tails = [];
  for (const x of arr) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; }
    tails[lo] = x;
  }
  return tails.length;
}

function indentStyle(text) {
  let tabs = 0, two = 0, four = 0;
  for (const line of text.split('\n')) {
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) continue;
    if (m[1].includes('\t')) tabs++;
    else if (m[1].length % 4 === 0) four++;
    else if (m[1].length % 2 === 0) two++;
  }
  if (tabs > two && tabs > four) return 'tabs';
  if (two > four) return '2 spaces';
  return four ? '4 spaces' : 'none';
}

function braceStyle(text) {
  const own = (text.match(/\n\s*\{\s*(\n|$)/g) || []).length;
  const same = (text.match(/\)\s*\{\s*(\n|$)/g) || []).length;
  if (own + same < 2) return null;
  return own > same ? 'next line' : 'same line';
}

function countIn(S, from, to, ids) {
  let c = 0;
  for (let k = from; k < to; k++) if (ids.includes(S.kids[k])) c++;
  return c;
}

/**
 * @param A,B prepared submissions (analyze.js)
 * @param pair result of comparePair
 */
export function explainPair(A, B, pair) {
  const tiles = [...pair.tiles].sort((x, y) => x.a - y.a).map((t, i) => ({ ...t, id: i }));
  const spansA = [], spansB = [];
  for (const t of tiles) {
    spansA.push(...spansFor(A, t.a, t.len, t.id));
    spansB.push(...spansFor(B, t.b, t.len, t.id));
  }
  const nA = A.kids.length, nB = B.kids.length;
  const covA = nA ? pair.matched / nA : 0, covB = nB ? pair.matched / nB : 0;
  const findings = [];

  // 1. renamed identifiers inside matching code
  const pairsSeen = new Map();
  let sameNames = 0, idTokens = 0;
  const lits = new Set();
  for (const t of tiles) {
    for (let q = 0; q < t.len; q++) {
      const ta = tokAt(A, t.a + q), tb = tokAt(B, t.b + q);
      if (ta.kind === KIND.ID && tb.kind === KIND.ID) {
        idTokens++;
        const na = raw(ta), nb = raw(tb);
        if (na === nb) { sameNames++; continue; }
        const key = `${na}\u0000${nb}`;
        pairsSeen.set(key, (pairsSeen.get(key) || 0) + 1);
      } else if ((ta.kind === KIND.NUM || ta.kind === KIND.STR || ta.kind === KIND.CHR) && raw(ta) !== raw(tb)
        && normalizeLiteral(raw(ta), ta.kind, ta.file.lang) && normalizeLiteral(raw(tb), tb.kind, tb.file.lang)) {
        lits.add(`${raw(ta)}\u0000${raw(tb)}`); // only informative literals (not 0 / 1 / "%d")
      }
    }
  }
  const renames = [...pairsSeen.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => [...k.split('\u0000'), n]);
  const fromNames = new Set(renames.map((r) => r[0]));
  if (renames.length) {
    const renamedShare = idTokens ? 1 - sameNames / idTokens : 0;
    findings.push({
      type: 'rename', title: 'Renamed variables / functions',
      text: `${fromNames.size} name${fromNames.size > 1 ? 's were' : ' was'} changed inside the matching code `
        + `(${Math.round(renamedShare * 100)}% of name uses differ), but the logic around them is identical.`,
      examples: renames.slice(0, 6).map(([a, b]) => [a, b]),
    });
  }
  // literals that differ only because a renamed variable appears inside them (f-strings) don't count
  const renameMap = new Map(renames.map(([a, b]) => [a, b]));
  for (const k of [...lits]) {
    const [la, lb] = k.split('\u0000');
    const sub = la.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => renameMap.get(w) ?? w);
    if (sub === lb) lits.delete(k);
  }
  if (lits.size >= 2) {
    findings.push({
      type: 'literal', title: 'Changed messages or constants',
      text: `${lits.size} text messages or numbers were edited while the surrounding code stayed the same.`,
      examples: [...lits].slice(0, 4).map((k) => k.split('\u0000').map((s) => (s.length > 40 ? s.slice(0, 37) + '...' : s))),
    });
  }

  // 1b. the same unusual messages / constants (literals most of the class also uses are ignored)
  const la = A.litsU || A.lits, lb = B.litsU || B.lits;
  if (la && lb) {
    const shared = [...la].filter((x) => lb.has(x));
    if (shared.length) {
      const show = shared.filter((x) => x.startsWith('s:')).concat(shared.filter((x) => x.startsWith('n:')))
        .slice(0, 4).map((x) => (x.startsWith('s:') ? `"${x.slice(2)}"` : x.slice(2)))
        .map((x) => (x.length > 44 ? x.slice(0, 41) + '...' : x));
      findings.push({
        type: 'shared-literal', title: 'Same unusual text or constants',
        text: `${shared.length} output message${shared.length > 1 ? 's or constants appear' : ' or constant appears'} in both files but not in most other submissions.`,
        examples: show.map((x) => [x]),
      });
    }
  }

  // 2. reordering: are the matching blocks in the same order in both files?
  if (tiles.length >= 2) {
    const bOrder = tiles.map((t) => t.b);
    const inOrder = lisLength(bOrder);
    const moved = tiles.length - inOrder;
    if (moved >= 1) {
      findings.push({
        type: 'reorder', title: 'Code moved around',
        text: `${moved} of ${tiles.length} matching block${tiles.length > 1 ? 's' : ''} appear in a different order `
          + `(functions or statements were rearranged).`,
      });
    }
  }

  // 3. statement-level rewrites between neighbouring matches
  let loopRewrites = 0, incRewrites = 0, ifRewrites = 0;
  const gapsA = [], gapsB = [];
  const byB = [...tiles].sort((x, y) => x.b - y.b);
  for (let i = 0; i + 1 < tiles.length; i++) {
    const t1 = tiles[i], t2 = tiles[i + 1];
    const j = byB.indexOf(t1);
    if (byB[j + 1] !== t2) continue; // only compare gaps that line up in both files
    gapsA.push([t1.a + t1.len, t2.a]);
    gapsB.push([t1.b + t1.len, t2.b]);
  }
  for (let g = 0; g < gapsA.length; g++) {
    const [a0, a1] = gapsA[g], [b0, b1] = gapsB[g];
    if (a1 - a0 > 80 || b1 - b0 > 80) continue;
    const fa = countIn(A, a0, a1, [T_FOR]), wa = countIn(A, a0, a1, [T_WHILE]);
    const fb = countIn(B, b0, b1, [T_FOR]), wb = countIn(B, b0, b1, [T_WHILE]);
    if ((fa > fb && wb > wa) || (fb > fa && wa > wb)) loopRewrites++;
    const ia = countIn(A, a0, a1, [T_INC, T_DEC]), pa = countIn(A, a0, a1, [T_PLUSEQ, T_MINUSEQ]);
    const ib = countIn(B, b0, b1, [T_INC, T_DEC]), pb = countIn(B, b0, b1, [T_PLUSEQ, T_MINUSEQ]);
    if ((ia > ib && pb > pa) || (ib > ia && pa > pb)) incRewrites++;
    const na = countIn(A, a0, a1, [T_NOT, T_NOTKW]), nb = countIn(B, b0, b1, [T_NOT, T_NOTKW]);
    const ea = countIn(A, a0, a1, [T_IF, T_ELSE]), eb = countIn(B, b0, b1, [T_IF, T_ELSE]);
    if (ea && eb && na !== nb) ifRewrites++;
  }
  if (loopRewrites) findings.push({ type: 'loop', title: 'Loops rewritten', text: `${loopRewrites} place${loopRewrites > 1 ? 's' : ''} where a for-loop was turned into a while-loop (or the other way round) between otherwise identical code.` });
  if (incRewrites) findings.push({ type: 'increment', title: 'Counters written differently', text: `${incRewrites} place${incRewrites > 1 ? 's' : ''} where i++ / i += 1 / i = i + 1 were swapped.` });
  if (ifRewrites) findings.push({ type: 'condition', title: 'Conditions flipped', text: `${ifRewrites} if/else block${ifRewrites > 1 ? 's look' : ' looks'} inverted (condition negated, branches swapped).` });

  // 4. code that exists in only one of the files
  const unmatchedLines = (S, n, cov, tilesKey) => {
    const marked = new Uint8Array(n);
    for (const t of tiles) for (let q = 0; q < t.len; q++) marked[t[tilesKey] + q] = 1;
    const lines = new Set();
    for (let k = 0; k < n; k++) if (!marked[k]) { const t = tokAt(S, k); if (t.end > t.start) lines.add(`${t.f}:${t.line}`); }
    return lines.size;
  };
  const extraA = unmatchedLines(A, nA, covA, 'a'), extraB = unmatchedLines(B, nB, covB, 'b');
  const big = Math.max(extraA, extraB), small = Math.min(extraA, extraB);
  if (Math.max(covA, covB) >= 0.6 && big >= 4 && big >= 1.6 * small + 2) {
    const [X, Y, nx, ny] = extraA > extraB ? [A, B, extraA, extraB] : [B, A, extraB, extraA];
    findings.push({ type: 'padding', title: `Extra code in ${X.name}`, text: `${X.name} has about ${nx} line${nx > 1 ? 's' : ''} with no match in ${Y.name} (${Y.name}: ${ny}). Copies are often padded with extra declarations or code that does nothing.` });
  }

  // 5. cosmetic changes
  const textA = A.files.map((f) => f.text).join('\n'), textB = B.files.map((f) => f.text).join('\n');
  const comA = A.files.reduce((s, f) => s + f.tok.comments.length, 0), comB = B.files.reduce((s, f) => s + f.tok.comments.length, 0);
  if (pair.score >= 0.3 && Math.abs(comA - comB) >= 2) {
    findings.push({ type: 'comments', title: 'Comments added or removed', text: `${A.name} has ${comA} comment${comA === 1 ? '' : 's'}, ${B.name} has ${comB} - comments are ignored by the checker, so this does not hide copying.` });
  }
  const ia = indentStyle(textA), ib = indentStyle(textB), ba = braceStyle(textA), bb = braceStyle(textB);
  if (pair.score >= 0.3 && ((ia !== ib && ia !== 'none' && ib !== 'none') || (ba && bb && ba !== bb))) {
    const bits = [];
    if (ia !== ib) bits.push(`indentation ${ia} vs ${ib}`);
    if (ba && bb && ba !== bb) bits.push(`braces on ${ba} vs ${bb}`);
    findings.push({ type: 'format', title: 'Formatting changed', text: `Different layout (${bits.join(', ')}) - layout is ignored, so it does not hide copying.` });
  }

  if (Math.max(covA, covB) < 0.25) {
    findings.length = 0;
    findings.push({ type: 'weak', title: 'Only small fragments match', text: 'The overlap is limited to short, common patterns (loops, input/output lines) that independent solutions of the same task usually share.' });
  }

  const longest = tiles.reduce((m, t) => Math.max(m, t.len), 0);
  let longestLines = 0;
  for (const t of tiles) if (t.len === longest) {
    const s = tokAt(A, t.a), e = tokAt(A, t.a + t.len - 1);
    longestLines = e.line - s.line + 1;
    break;
  }
  return { tiles, spansA, spansB, coverageA: covA, coverageB: covB, findings, longest, longestLines, extraA, extraB };
}

/** Plain-language verdict for a score. */
export function verdict(score, threshold) {
  if (score >= Math.max(0.85, threshold + 0.25)) return { level: 'high', label: 'Very likely copied' };
  if (score >= threshold) return { level: 'medium', label: 'Likely copied' };
  if (score >= threshold * 0.6) return { level: 'low', label: 'Some similarity' };
  return { level: 'none', label: 'Looks independent' };
}
