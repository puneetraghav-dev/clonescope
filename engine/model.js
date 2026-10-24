// Neural code encoder - inference in plain JavaScript (no libraries).
// ------------------------------------------------------------------
// Mirrors training/train_encoder.py exactly:
//   embedding -> 4 x [dilated Conv1d -> ReLU (-> + residual)] -> mean & max pool -> Linear -> L2 norm
// Weights are trained in PyTorch and exported to a flat float32 array (model/encoder.bin).

export class CodeEncoder {
  /**
   * @param {object} meta     contents of model/encoder.json
   * @param {Float32Array} w  all weights, in the order listed in meta.tensors
   */
  constructor(meta, w) {
    if (!(w instanceof Float32Array)) throw new Error('weights must be a Float32Array');
    if (w.length !== meta.total_floats) throw new Error(`expected ${meta.total_floats} weights, got ${w.length}`);
    this.meta = meta;
    const cfg = meta.config;
    this.E = cfg.emb; this.C = cfg.channels; this.K = cfg.kernel; this.D = cfg.out_dim; this.V = cfg.vocab_size;
    const get = (name) => {
      const t = meta.tensors.find((x) => x.name === name);
      if (!t) throw new Error(`missing tensor ${name}`);
      return w.subarray(t.offset, t.offset + t.size);
    };
    this.emb = get('emb.weight');
    this.layers = cfg.dilations.map((d, i) => ({
      w: get(`convs.${i}.weight`), b: get(`convs.${i}.bias`), d, cin: i === 0 ? this.E : this.C,
    }));
    this.pw = get('proj.weight');
    this.pb = get('proj.bias');
  }

  /** Builds an encoder from metadata + base64-encoded little-endian float32 weights. */
  static fromBase64(meta, b64) {
    let bytes;
    if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return new CodeEncoder(meta, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
  }

  /**
   * Embeds one program.
   * @param {ArrayLike<number>} ids normalized token ids (from tokenizer.js)
   * @param {number} maxLen tokens beyond this are ignored (keeps big files fast)
   * @returns {Float32Array} unit vector of length out_dim
   */
  encode(ids, maxLen = 2048) {
    const T = Math.min(ids.length, maxLen);
    const { E, C, K, D } = this;
    const out = new Float32Array(D);
    if (T === 0) return out;
    let x = new Float32Array(E * T);
    for (let t = 0; t < T; t++) {
      let id = ids[t];
      if (id >= this.V) id = 1; // <unk>
      const base = id * E;
      for (let c = 0; c < E; c++) x[c * T + t] = this.emb[base + c];
    }
    const half = (K - 1) / 2;
    for (let li = 0; li < this.layers.length; li++) {
      const { w, b, d, cin } = this.layers[li];
      const y = new Float32Array(C * T);
      // four output channels at a time: every input value loaded once feeds four multiply-adds
      let o = 0;
      for (; o + 4 <= C; o += 4) {
        const y0 = o * T, y1 = y0 + T, y2 = y1 + T, y3 = y2 + T;
        y.fill(b[o], y0, y0 + T); y.fill(b[o + 1], y1, y1 + T); y.fill(b[o + 2], y2, y2 + T); y.fill(b[o + 3], y3, y3 + T);
        for (let c = 0; c < cin; c++) {
          const xc = c * T;
          for (let k = 0; k < K; k++) {
            const w0 = w[(o * cin + c) * K + k], w1 = w[((o + 1) * cin + c) * K + k];
            const w2 = w[((o + 2) * cin + c) * K + k], w3 = w[((o + 3) * cin + c) * K + k];
            const shift = (k - half) * d;
            const t0 = shift < 0 ? -shift : 0;
            const t1 = shift > 0 ? T - shift : T;
            for (let t = t0; t < t1; t++) {
              const xv = x[xc + t + shift];
              y[y0 + t] += w0 * xv; y[y1 + t] += w1 * xv; y[y2 + t] += w2 * xv; y[y3 + t] += w3 * xv;
            }
          }
        }
      }
      for (; o < C; o++) {
        const yo = o * T;
        y.fill(b[o], yo, yo + T);
        for (let c = 0; c < cin; c++) {
          const xc = c * T;
          for (let k = 0; k < K; k++) {
            const wv = w[(o * cin + c) * K + k];
            const shift = (k - half) * d;
            const t0 = shift < 0 ? -shift : 0;
            const t1 = shift > 0 ? T - shift : T;
            for (let t = t0; t < t1; t++) y[yo + t] += wv * x[xc + t + shift];
          }
        }
      }
      for (let i = 0; i < y.length; i++) if (y[i] < 0) y[i] = 0;
      if (li > 0) for (let i = 0; i < y.length; i++) y[i] += x[i];
      x = y;
    }
    // mean and max pooling over the sequence
    const pooled = new Float32Array(2 * C);
    for (let c = 0; c < C; c++) {
      let s = 0, m = -Infinity;
      const xc = c * T;
      for (let t = 0; t < T; t++) { const v = x[xc + t]; s += v; if (v > m) m = v; }
      pooled[c] = s / T;
      pooled[C + c] = m;
    }
    let norm = 0;
    for (let o = 0; o < D; o++) {
      let s = this.pb[o];
      const row = o * 2 * C;
      for (let i = 0; i < 2 * C; i++) s += this.pw[row + i] * pooled[i];
      out[o] = s;
      norm += s * s;
    }
    norm = Math.sqrt(norm) || 1;
    for (let o = 0; o < D; o++) out[o] /= norm;
    return out;
  }
}

/** Cosine similarity of two unit vectors. */
export function cosine(a, b) {
  if (!a || !b) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
