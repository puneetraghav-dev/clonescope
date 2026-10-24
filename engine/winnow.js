// Winnowing fingerprints (Schleimer, Wilkerson & Aiken, SIGMOD 2003 - the algorithm behind MOSS)
// ----------------------------------------------------------------------------------------------
// 1. hash every k-gram (k consecutive normalized tokens)
// 2. slide a window of w hashes and keep the minimum of each window
// The kept hashes are the document's "fingerprints". Any shared run of at least
// k + w - 1 tokens is guaranteed to produce at least one shared fingerprint.

/** 32-bit finalizer from MurmurHash3: spreads bits so window minima are well distributed. */
function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const BASE = 1000003;

/** Rolling polynomial hash of every k-gram of `ids`. Returns Uint32Array of length max(0, n-k+1). */
export function kgramHashes(ids, k) {
  const n = ids.length;
  if (n < k) return new Uint32Array(0);
  const out = new Uint32Array(n - k + 1);
  let pow = 1;
  for (let i = 1; i < k; i++) pow = Math.imul(pow, BASE);
  let h = 0;
  for (let i = 0; i < k; i++) h = (Math.imul(h, BASE) + ids[i] + 1) | 0;
  out[0] = fmix32(h);
  for (let i = k; i < n; i++) {
    h = (h - Math.imul(ids[i - k] + 1, pow)) | 0;
    h = (Math.imul(h, BASE) + ids[i] + 1) | 0;
    out[i - k + 1] = fmix32(h);
  }
  return out;
}

/**
 * Winnowing. Returns { hashes, positions } where positions[i] is the token index
 * where the k-gram for hashes[i] starts.
 */
export function winnow(ids, k = 6, w = 4) {
  const hs = kgramHashes(ids, k);
  const m = hs.length;
  const hashes = [], positions = [];
  if (m === 0) {
    if (ids.length > 0) { // very short file: one fingerprint for the whole thing
      let h = 0;
      for (let i = 0; i < ids.length; i++) h = (Math.imul(h, BASE) + ids[i] + 1) | 0;
      hashes.push(fmix32(h)); positions.push(0);
    }
    return { hashes: Uint32Array.from(hashes), positions: Int32Array.from(positions) };
  }
  if (m <= w) {
    let best = 0;
    for (let i = 1; i < m; i++) if (hs[i] <= hs[best]) best = i;
    return { hashes: Uint32Array.of(hs[best]), positions: Int32Array.of(best) };
  }
  // monotonic deque of indices; front holds the minimum of the current window (rightmost on ties)
  const dq = new Int32Array(m);
  let head = 0, tail = 0, lastPicked = -1;
  for (let i = 0; i < m; i++) {
    while (tail > head && hs[dq[tail - 1]] >= hs[i]) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - w) head++;
    if (i >= w - 1) {
      const p = dq[head];
      if (p !== lastPicked) { hashes.push(hs[p]); positions.push(p); lastPicked = p; }
    }
  }
  return { hashes: Uint32Array.from(hashes), positions: Int32Array.from(positions) };
}

/** Sorted unique copy of the fingerprint hashes (for fast set intersection). */
export function fingerprintSet(fp) {
  const s = Uint32Array.from(fp.hashes).sort();
  let u = 0;
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i] !== s[i - 1]) s[u++] = s[i];
  return s.slice(0, u);
}

/** Size of the intersection of two sorted unique Uint32Arrays. */
export function intersectCount(a, b) {
  let i = 0, j = 0, c = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { c++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return c;
}

/** Jaccard and containment similarity between two fingerprint sets. */
export function fingerprintSimilarity(a, b) {
  if (!a.length || !b.length) return { jaccard: 0, containment: 0, shared: 0 };
  const shared = intersectCount(a, b);
  return {
    jaccard: shared / (a.length + b.length - shared),
    containment: shared / Math.min(a.length, b.length),
    shared,
  };
}

/** Removes fingerprints that also appear in `exclude` (e.g. the teacher's starter code). */
export function subtractSet(a, exclude) {
  if (!exclude || !exclude.length) return a;
  const out = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j < exclude.length && exclude[j] < a[i]) j++;
    if (j < exclude.length && exclude[j] === a[i]) continue;
    out.push(a[i]);
  }
  return Uint32Array.from(out);
}
