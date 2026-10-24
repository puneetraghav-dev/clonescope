// Score fusion
// ------------
// Each pair of submissions gets several similarity signals:
//   neural        cosine similarity of the two neural embeddings      (learned, robust to rewrites)
//   wJaccard      overlap of winnowing fingerprints                   (MOSS-style)
//   wContainment  share of the smaller program's fingerprints found in the other
//   gstAvg        share of all tokens covered by matched tiles        (JPlag-style)
//   gstMax        share of the smaller program covered by tiles
//   lenRatio      |log(len A / len B)|  - very different sizes are less likely to be copies
//   litShare      shared unusual text / constants ("Enter the no. of elements :"), smoothed Jaccard
// A logistic-regression model (fitted in training/fit_fusion.py) turns them into one
// probability-like "suspicion score" between 0 and 1.

export const FEATURES = ['neural', 'wJaccard', 'wContainment', 'gstAvg', 'gstMax', 'lenRatio', 'litShare'];

export function featureVector(f) {
  return FEATURES.map((k) => f[k] ?? 0);
}

/** @param fusion {features, mean, std, weights, bias} - from model/fusion.json */
export function fuse(f, fusion) {
  const feats = fusion.features;
  let z = fusion.bias;
  for (let i = 0; i < feats.length; i++) {
    const x = f[feats[i]] ?? 0;
    z += fusion.weights[i] * ((x - fusion.mean[i]) / (fusion.std[i] || 1));
  }
  return 1 / (1 + Math.exp(-z));
}

/** Placeholder used only if model/fusion.json is missing (equal-weight average). */
export const FALLBACK_FUSION = {
  features: ['wContainment', 'gstMax'],
  mean: [0.5, 0.5], std: [0.2, 0.2], weights: [2.5, 2.5], bias: 0,
  threshold: 0.5,
};
