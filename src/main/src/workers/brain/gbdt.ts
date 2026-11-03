/**
 * Minimal histogram gradient-boosted trees (the LightGBM idea): features are
 * bucketed into quantile bins once, every split is found from per-bin
 * gradient sums, and NaN gets its own bin with a learned default direction.
 * Depth-wise trees, L2 leaf regularization, early stopping on a validation set.
 * Rare classes are weighted up while growing trees (so splits learn them), then
 * `base` is refit unweighted so predicted class frequencies match the data again
 * (sampled actions stay as frequent as the player's).
 */

import type {
  BrainGbdt as GbdtModel,
  BrainTree as Tree,
} from '../../../../common/brainSpec';

export type { GbdtModel, Tree };
export type Objective = GbdtModel['objective'];

export interface GbdtParams {
  rounds: number;
  learningRate: number;
  maxDepth: number;
  minLeaf: number;
  lambda: number;
  bins: number;
  featureFraction: number;
  earlyStop: number;
  /** class weighting: 0 = none, 1 = fully balanced (weight ∝ 1/frequency) */
  balance: number;
}

export const DEFAULT_PARAMS: GbdtParams = {
  rounds: 300,
  learningRate: 0.1,
  maxDepth: 6,
  minLeaf: 20,
  lambda: 1,
  bins: 63,
  featureFraction: 0.9,
  earlyStop: 30,
  balance: 0.5,
};

/** caps a class weight so a handful of rows can't dominate */
const MAX_WEIGHT = 50;

/** per-class weights (n / (classes·count))^balance, null for regression or no balancing */
function classWeights(
  objective: Objective,
  y: number[],
  classes: number,
  balance: number,
): Float64Array | null {
  if (objective === 'regression' || balance <= 0) return null;
  const count = new Float64Array(classes);
  for (const label of y) count[label]++;
  return count.map((c) =>
    c ? Math.min(MAX_WEIGHT, (y.length / (classes * c)) ** balance) : 1,
  );
}

export interface Dataset {
  x: ArrayLike<number>[];
  y: number[];
}

export interface TrainResult {
  model: GbdtModel;
  rounds: number;
  trainLoss: number;
  validLoss: number;
  accuracy?: number;
  /** total split gain per feature */
  gain: Float64Array;
}

function evalTree(tree: Tree, x: ArrayLike<number>): number {
  let n = tree.root;
  while (n >= 0) {
    const v = x[tree.f[n]];
    n = (Number.isNaN(v) ? tree.nanLeft[n] : v <= tree.t[n])
      ? tree.l[n]
      : tree.r[n];
  }
  return tree.v[~n];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function softmax(
  raw: ArrayLike<number>,
  out: Float64Array | number[],
  offset = 0,
): void {
  let max = -Infinity;
  for (let k = 0; k < out.length; k++) max = Math.max(max, raw[offset + k]);
  let sum = 0;
  for (let k = 0; k < out.length; k++)
    sum += out[k] = Math.exp(raw[offset + k] - max);
  for (let k = 0; k < out.length; k++) out[k] /= sum;
}

/** Probabilities (binary: [p], multiclass: per class) or the value (regression: [v]). */
export function predict(model: GbdtModel, x: ArrayLike<number>): number[] {
  const raw = model.base.slice();
  for (const round of model.trees)
    for (let k = 0; k < raw.length; k++) raw[k] += evalTree(round[k], x);
  if (model.objective === 'binary') return [sigmoid(raw[0])];
  if (model.objective === 'multiclass') softmax(raw.slice(), raw);
  return raw;
}

/**
 * Bins the features that can split (constant ones can't) row-major,
 * `binned[i * cols.length + c]`, so a histogram pass reads each row once.
 * `cols[c]` is the feature index of column c.
 */
function binFeatures(x: ArrayLike<number>[], features: number, bins: number) {
  const n = x.length;
  const cols: number[] = [];
  const thresholds: number[][] = [];
  const stride = Math.max(1, Math.floor(n / 50_000));
  for (let f = 0; f < features; f++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i += stride)
      if (!Number.isNaN(x[i][f])) sample.push(x[i][f]);
    sample.sort((a, b) => a - b);
    const thr: number[] = [];
    for (let q = 1; q < bins; q++) {
      const v = sample[Math.floor((q * sample.length) / bins)];
      if (v !== undefined && v !== thr.at(-1) && v < sample.at(-1)!)
        thr.push(v);
    }
    if (!thr.length) continue;
    cols.push(f);
    thresholds.push(thr);
  }
  const width = cols.length;
  const binned = new Uint8Array(width * n);
  cols.forEach((f, c) => {
    const thr = thresholds[c];
    const missing = thr.length + 1;
    for (let i = 0; i < n; i++) {
      const v = x[i][f];
      let lo = 0;
      let hi = thr.length;
      if (Number.isNaN(v)) lo = missing;
      else
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (thr[mid] < v) lo = mid + 1;
          else hi = mid;
        }
      binned[i * width + c] = lo;
    }
  });
  return { cols, thresholds, binned };
}

/** mean loss (class-weighted when `weights`), and balanced accuracy: the mean per-class recall, so always predicting the common class doesn't score high */
function loss(
  objective: Objective,
  raw: Float64Array,
  y: number[],
  K: number,
  weights: Float64Array | null,
) {
  const p = new Float64Array(K);
  const classes = objective === 'binary' ? 2 : K;
  const seen = new Float64Array(classes);
  const correct = new Float64Array(classes);
  let total = 0;
  let weightSum = 0;
  for (let i = 0; i < y.length; i++) {
    const w = weights ? weights[y[i]] : 1;
    weightSum += w;
    if (objective === 'regression') {
      total += (raw[i] - y[i]) ** 2;
      continue;
    }
    let hit: boolean;
    if (objective === 'binary') {
      const q = Math.min(1 - 1e-7, Math.max(1e-7, sigmoid(raw[i])));
      total -= w * (y[i] ? Math.log(q) : Math.log(1 - q));
      hit = q > 0.5 === !!y[i];
    } else {
      softmax(raw, p, i * K);
      total -= w * Math.log(Math.max(1e-7, p[y[i]]));
      hit = p.indexOf(Math.max(...p)) === y[i];
    }
    seen[y[i]]++;
    correct[y[i]] += +hit;
  }
  let recall = 0;
  let present = 0;
  for (let c = 0; c < classes; c++)
    if (seen[c]) {
      recall += correct[c] / seen[c];
      present++;
    }
  return {
    loss: total / Math.max(1e-9, weightSum),
    accuracy:
      objective === 'regression' ? undefined : recall / Math.max(1, present),
  };
}

/** shifts `base` so the mean predicted probability per class equals its frequency in `data` */
function recalibrate(model: GbdtModel, data: Dataset, K: number): void {
  const n = data.y.length;
  // tree outputs without the base, computed once
  const raw = data.x.map((x) => {
    const out = new Array<number>(K).fill(0);
    for (const round of model.trees)
      for (let k = 0; k < K; k++) out[k] += evalTree(round[k], x);
    return out;
  });
  const freq = new Float64Array(model.objective === 'binary' ? 2 : K);
  for (const y of data.y) freq[y] += 1 / n;
  const p = new Float64Array(K);
  for (let iter = 0; iter < 30; iter++) {
    const mean = new Float64Array(K);
    let slope = 0;
    for (const r of raw) {
      if (model.objective === 'binary') {
        const q = sigmoid(r[0] + model.base[0]);
        mean[0] += q / n;
        slope += (q * (1 - q)) / n;
      } else {
        softmax(
          r.map((v, k) => v + model.base[k]),
          p,
        );
        for (let k = 0; k < K; k++) mean[k] += p[k] / n;
      }
    }
    if (model.objective === 'binary')
      model.base[0] -= (mean[0] - freq[1]) / Math.max(slope, 1e-9);
    else
      for (let k = 0; k < K; k++)
        if (freq[k] && mean[k]) model.base[k] += Math.log(freq[k] / mean[k]);
  }
}

export async function trainGbdt(
  train: Dataset,
  valid: Dataset,
  features: number,
  objective: Objective,
  classes: number,
  options: Partial<GbdtParams> = {},
): Promise<TrainResult> {
  const params = { ...DEFAULT_PARAMS, ...options };
  const { learningRate, maxDepth, minLeaf, lambda } = params;
  const n = train.x.length;
  const K = objective === 'multiclass' ? classes : 1;
  const { cols, thresholds, binned } = binFeatures(
    train.x,
    features,
    params.bins,
  );
  const width = cols.length;
  const weights = classWeights(
    objective,
    train.y,
    objective === 'binary' ? 2 : K,
    params.balance,
  );
  const weight = (i: number) => (weights ? weights[train.y[i]] : 1);

  // start from the (weighted) prior
  const clamp = (p: number) => Math.min(1 - 1e-4, Math.max(1e-4, p));
  let base: number[];
  if (objective === 'regression')
    base = [train.y.reduce((a, b) => a + b, 0) / Math.max(1, n)];
  else {
    const mass = new Float64Array(objective === 'binary' ? 2 : K);
    for (let i = 0; i < n; i++) mass[train.y[i]] += weight(i);
    const total = mass.reduce((a, b) => a + b, 0) || 1;
    const prior = Array.from(mass, (m) => clamp(m / total));
    base =
      objective === 'binary'
        ? [Math.log(prior[1] / (1 - prior[1]))]
        : prior.map(Math.log);
  }

  const predTrain = new Float64Array(n * K);
  const predValid = new Float64Array(valid.x.length * K);
  for (let i = 0; i < predTrain.length; i++) predTrain[i] = base[i % K];
  for (let i = 0; i < predValid.length; i++) predValid[i] = base[i % K];

  const grad = new Float64Array(n * K);
  const hess = new Float64Array(n * K);
  const gain = new Float64Array(features);
  const p = new Float64Array(K);
  // the rows of a node are a contiguous range of `rows`, partitioned in place
  const rows = new Uint32Array(n);
  const scratch = new Uint32Array(n);
  // histograms are bin-major per column: entry c * B + bin
  const B = params.bins + 2;
  const size = width * B;
  const newHistogram = () => ({
    g: new Float64Array(size),
    h: new Float64Array(size),
    c: new Uint32Array(size),
  });
  type Histogram = ReturnType<typeof newHistogram>;
  // both children's histograms of each depth: the left subtree only uses deeper levels
  const levels = Array.from({ length: maxDepth + 1 }, () => [
    newHistogram(),
    newHistogram(),
  ]);

  const build = (into: Histogram, from: number, to: number, k: number) => {
    const { g, h, c } = into;
    g.fill(0);
    h.fill(0);
    c.fill(0);
    for (let j = from; j < to; j++) {
      const i = rows[j];
      const gi = grad[i * K + k];
      const hi = hess[i * K + k];
      const row = i * width;
      for (let col = 0, at = 0; col < width; col++, at += B) {
        const b = at + binned[row + col];
        g[b] += gi;
        h[b] += hi;
        c[b]++;
      }
    }
  };

  /** the other child's histogram: parent minus the built one */
  const subtract = (into: Histogram, parent: Histogram, built: Histogram) => {
    for (let b = 0; b < size; b++) {
      into.g[b] = parent.g[b] - built.g[b];
      into.h[b] = parent.h[b] - built.h[b];
      into.c[b] = parent.c[b] - built.c[b];
    }
  };

  const trees: Tree[][] = [];
  let best = {
    loss: Infinity,
    rounds: 0,
    trainLoss: Infinity,
    accuracy: undefined as number | undefined,
  };

  for (let round = 0; round < params.rounds; round++) {
    for (let i = 0; i < n; i++) {
      const w = weight(i);
      if (objective === 'regression') {
        grad[i] = predTrain[i] - train.y[i];
        hess[i] = 1;
      } else if (objective === 'binary') {
        const q = sigmoid(predTrain[i]);
        grad[i] = w * (q - train.y[i]);
        hess[i] = w * Math.max(q * (1 - q), 1e-6);
      } else {
        softmax(predTrain, p, i * K);
        for (let k = 0; k < K; k++) {
          grad[i * K + k] = w * (p[k] - +(train.y[i] === k));
          hess[i * K + k] = w * Math.max(p[k] * (1 - p[k]), 1e-6);
        }
      }
    }

    const roundTrees: Tree[] = [];
    for (let k = 0; k < K; k++) {
      const tree: Tree = {
        root: 0,
        f: [],
        t: [],
        l: [],
        r: [],
        nanLeft: [],
        v: [],
      };

      const use = new Uint8Array(width);
      for (let c = 0; c < width; c++)
        use[c] = +(Math.random() < params.featureFraction);

      const grow = (
        from: number,
        to: number,
        depth: number,
        hist: Histogram,
        G: number,
        H: number,
      ): number => {
        const count = to - from;
        const leaf = () => {
          const value = (-G / (H + lambda)) * learningRate;
          for (let j = from; j < to; j++) predTrain[rows[j] * K + k] += value;
          return ~(tree.v.push(value) - 1);
        };
        if (depth >= maxDepth || count < 2 * minLeaf) return leaf();

        const parent = (G * G) / (H + lambda);
        let bestGain = 1e-6;
        let bestC = -1;
        let bestBin = 0;
        let bestNanLeft = false;
        let bestG = 0;
        let bestH = 0;
        const { g: hg, h: hh, c: hc } = hist;
        for (let c = 0; c < width; c++) {
          if (!use[c]) continue;
          const missing = thresholds[c].length + 1;
          const at = c * B;
          const ng = hg[at + missing];
          const nh = hh[at + missing];
          const nc = hc[at + missing];
          let gl = 0;
          let hl = 0;
          let cl = 0;
          for (let b = 0; b < missing - 1; b++) {
            gl += hg[at + b];
            hl += hh[at + b];
            cl += hc[at + b];
            // NaN right, then (when there are NaNs) NaN left
            for (let side = 0; side < (nc ? 2 : 1); side++) {
              const lg = side ? gl + ng : gl;
              const lh = side ? hl + nh : hl;
              const lc = side ? cl + nc : cl;
              if (lc < minLeaf || count - lc < minLeaf) continue;
              const g =
                (lg * lg) / (lh + lambda) +
                (G - lg) ** 2 / (H - lh + lambda) -
                parent;
              if (g > bestGain) {
                bestGain = g;
                bestC = c;
                bestBin = b;
                bestNanLeft = side === 1;
                bestG = lg;
                bestH = lh;
              }
            }
          }
        }
        if (bestC < 0) return leaf();

        gain[cols[bestC]] += bestGain;
        // stable partition: left rows to the front, right rows after them
        const missing = thresholds[bestC].length + 1;
        let mid = from;
        let right = 0;
        for (let j = from; j < to; j++) {
          const i = rows[j];
          const b = binned[i * width + bestC];
          if (b === missing ? bestNanLeft : b <= bestBin) rows[mid++] = i;
          else scratch[right++] = i;
        }
        rows.set(scratch.subarray(0, right), mid);

        // build the smaller child's histogram, derive the other's
        const [leftHist, rightHist] = levels[depth + 1];
        if (mid - from <= to - mid) {
          build(leftHist, from, mid, k);
          subtract(rightHist, hist, leftHist);
        } else {
          build(rightHist, mid, to, k);
          subtract(leftHist, hist, rightHist);
        }

        const node = tree.f.push(cols[bestC]) - 1;
        tree.t.push(thresholds[bestC][bestBin]);
        tree.nanLeft.push(+bestNanLeft);
        tree.l.push(0);
        tree.r.push(0);
        tree.l[node] = grow(from, mid, depth + 1, leftHist, bestG, bestH);
        tree.r[node] = grow(
          mid,
          to,
          depth + 1,
          rightHist,
          G - bestG,
          H - bestH,
        );
        return node;
      };

      for (let i = 0; i < n; i++) rows[i] = i;
      const root = levels[0][0];
      build(root, 0, n, k);
      let G = 0;
      let H = 0;
      for (let i = 0; i < n; i++) {
        G += grad[i * K + k];
        H += hess[i * K + k];
      }
      tree.root = grow(0, n, 0, root, G, H);
      roundTrees.push(tree);
      for (let i = 0; i < valid.x.length; i++)
        predValid[i * K + k] += evalTree(tree, valid.x[i]);
    }
    trees.push(roundTrees);

    const v = valid.y.length
      ? loss(objective, predValid, valid.y, K, weights)
      : loss(objective, predTrain, train.y, K, weights);
    if (v.loss < best.loss - 1e-6) {
      best = {
        loss: v.loss,
        rounds: round + 1,
        trainLoss: loss(objective, predTrain, train.y, K, weights).loss,
        accuracy: v.accuracy,
      };
    } else if (round + 1 - best.rounds >= params.earlyStop) break;
    // keep the worker responsive (stop requests, keep-alives)
    await new Promise((resolve) => setImmediate(resolve));
  }

  const model: GbdtModel = {
    objective,
    base,
    trees: trees.slice(0, best.rounds),
  };
  if (weights) recalibrate(model, train, K);

  return {
    model,
    rounds: best.rounds,
    trainLoss: best.trainLoss,
    validLoss: best.loss,
    accuracy: best.accuracy,
    gain,
  };
}
