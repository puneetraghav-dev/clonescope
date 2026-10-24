// Greedy String Tiling (Wise 1993; the matching algorithm used by JPlag)
// ---------------------------------------------------------------------
// Finds the longest common runs ("tiles") of tokens between two programs,
// longest first, never letting two tiles overlap. Unlike a line diff, tiles
// can appear in a different order in the two files, so moving functions or
// blocks around does not hide copying. Tiles are also what we highlight in the
// side-by-side view.

import { kgramHashes } from './winnow.js';

const MAX_CANDIDATES = 48; // cap per hash bucket so repetitive code can't blow up runtime

/**
 * @param {ArrayLike<number>} a  token ids of program A
 * @param {ArrayLike<number>} b  token ids of program B
 * @param {number} minLen        minimum tile length in tokens
 * @param {Uint8Array} [maskA]   tokens of A to ignore (e.g. starter code), 1 = ignore
 * @param {Uint8Array} [maskB]
 * @returns {{tiles: {a:number,b:number,len:number}[], matched:number}}
 */
export function greedyStringTiling(a, b, minLen = 8, maskA = null, maskB = null) {
  const n = a.length, m = b.length;
  const tiles = [];
  if (n < minLen || m < minLen) return { tiles, matched: 0 };
  const markA = maskA ? Uint8Array.from(maskA) : new Uint8Array(n);
  const markB = maskB ? Uint8Array.from(maskB) : new Uint8Array(m);
  const ha = kgramHashes(a, minLen);
  const hb = kgramHashes(b, minLen);
  let matched = 0;

  for (let iter = 0; iter < 64; iter++) {
    // index all fully-unmarked windows of B
    const prefB = new Int32Array(m + 1);
    for (let j = 0; j < m; j++) prefB[j + 1] = prefB[j] + markB[j];
    const index = new Map();
    for (let j = 0; j + minLen <= m; j++) {
      if (prefB[j + minLen] - prefB[j] !== 0) continue;
      const h = hb[j];
      const list = index.get(h);
      if (list === undefined) index.set(h, [j]);
      else if (list.length < MAX_CANDIDATES) list.push(j);
    }
    const prefA = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) prefA[i + 1] = prefA[i] + markA[i];

    // collect maximal matches
    const matches = [];
    for (let i = 0; i + minLen <= n; i++) {
      if (prefA[i + minLen] - prefA[i] !== 0) continue;
      const cands = index.get(ha[i]);
      if (cands === undefined) continue;
      for (let c = 0; c < cands.length; c++) {
        const j = cands[c];
        // only start at the beginning of a match (otherwise it's a suffix of a longer one)
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && !markA[i - 1] && !markB[j - 1]) continue;
        let k = 0;
        while (i + k < n && j + k < m && a[i + k] === b[j + k] && !markA[i + k] && !markB[j + k]) k++;
        if (k >= minLen) matches.push(i, j, k);
      }
    }
    if (matches.length === 0) break;

    // longest first; mark tiles that don't overlap previously marked tokens
    const order = [];
    for (let t = 0; t < matches.length; t += 3) order.push(t);
    order.sort((x, y) => matches[y + 2] - matches[x + 2] || matches[x] - matches[y]);
    let added = 0;
    for (const t of order) {
      const i = matches[t], j = matches[t + 1], k = matches[t + 2];
      let free = true;
      for (let q = 0; q < k; q++) if (markA[i + q] || markB[j + q]) { free = false; break; }
      if (!free) continue;
      for (let q = 0; q < k; q++) { markA[i + q] = 1; markB[j + q] = 1; }
      tiles.push({ a: i, b: j, len: k });
      matched += k;
      added++;
    }
    if (added === 0) break;
  }
  tiles.sort((x, y) => x.a - y.a);
  return { tiles, matched };
}

/** Similarity measures derived from a tiling. `nA`/`nB` = number of (non-ignored) tokens. */
export function tilingSimilarity(matched, nA, nB) {
  if (nA <= 0 || nB <= 0) return { avg: 0, max: 0 };
  return {
    avg: Math.min(1, (2 * matched) / (nA + nB)), // JPlag "average similarity"
    max: Math.min(1, matched / Math.min(nA, nB)),  // share of the smaller program that is matched
  };
}
