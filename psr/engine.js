/* ── PSR enhancement engine ──────────────────────────────────────────────────
   Every stage here is the real operator, running on the real 12-bit numbers, in
   your browser. Nothing is a pre-rendered "after" image.

   The order is not cosmetic. Sensor artefacts have to come off before anything
   estimates signal statistics, denoising has to precede deconvolution because
   Richardson–Lucy amplifies whatever noise it is handed, and tone mapping comes
   last because it is the only step that is allowed to be non-physical.
   ──────────────────────────────────────────────────────────────────────────── */

export const W = 512;                    // working resolution, both axes
const N = W * W;

/* ── helpers ─────────────────────────────────────────────────────────────── */
export function stats(a, mask) {
  let n = 0, s = 0, s2 = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    const v = a[i];
    n++; s += v; s2 += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = s / Math.max(n, 1);
  return { n, mean, std: Math.sqrt(Math.max(s2 / Math.max(n, 1) - mean * mean, 0)), min, max };
}

export function percentile(a, p) {
  const c = Float32Array.from(a).sort();
  return c[Math.min(c.length - 1, Math.max(0, Math.round((p / 100) * (c.length - 1))))];
}

export function histogram(a, bins, lo, hi) {
  const h = new Float32Array(bins);
  const k = bins / Math.max(hi - lo, 1e-9);
  for (let i = 0; i < a.length; i++) {
    const b = Math.floor((a[i] - lo) * k);
    if (b >= 0 && b < bins) h[b]++;
  }
  return h;
}

/* Separable box blur via a running sum: O(N) per pass, and three passes make a
   Gaussian to within a couple of percent. Everything below that needs a blur
   uses this, so the whole pipeline stays linear in pixel count. */
function boxPass(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}

function transpose(src, dst, w, h) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[x * h + y] = src[y * w + x];
}

export function blur(a, sigma, w = W, h = W) {
  if (sigma <= 0.05) return Float32Array.from(a);
  const r = Math.max(1, Math.round(sigma * 1.18));
  let src = Float32Array.from(a);
  const t1 = new Float32Array(a.length), t2 = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(src, t1, w, h, r);
    transpose(t1, t2, w, h);
    boxPass(t2, t1, h, w, r);
    transpose(t1, src, h, w);
  }
  return src;
}

/* ── 01 · radiometric correction ─────────────────────────────────────────────
   Bias and dark are additive offsets the sensor adds to every pixel whether or
   not a photon arrived. Estimating them from the frame's own darkest population
   rather than a fixed table is what keeps this honest on data whose calibration
   files you do not have: the mode of the low tail is the offset. */
export function radiometric(dn) {
  const h = histogram(dn, 256, 0, Math.max(percentile(dn, 99.5), 8));
  let mode = 0, best = -1;
  for (let i = 0; i < 64; i++) if (h[i] > best) { best = h[i]; mode = i; }
  const scale = Math.max(percentile(dn, 99.5), 8) / 256;
  const offset = mode * scale;
  const out = new Float32Array(dn.length);
  for (let i = 0; i < dn.length; i++) out[i] = dn[i] - offset;
  return { out, offset };
}

/* ── 02 · column fixed-pattern removal ───────────────────────────────────────
   A push-broom sensor reads every image column through its own amplifier chain,
   so a per-column offset prints the same stripe down the whole scene. Subtract
   the column median of the residual against a horizontally smoothed copy: real
   vertical terrain survives because it is not constant down the column, while
   the electronic offset does not. */
export function destripe(a, w = W, h = W) {
  const smooth = blur(a, 6, w, h);
  const out = Float32Array.from(a);
  const col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = a[y * w + x] - smooth[y * w + x];
    const med = median(col);
    for (let y = 0; y < h; y++) out[y * w + x] -= med;
  }
  return out;
}

function median(arr) {
  const c = Float32Array.from(arr).sort();
  const m = c.length >> 1;
  return c.length % 2 ? c[m] : (c[m - 1] + c[m]) * 0.5;
}

/* ── 03 · edge-preserving denoise ────────────────────────────────────────────
   A guided filter, which is a local linear model of the image against itself:
   inside a flat patch the variance is all noise so a shrinks toward 0 and the
   output is the local mean; across a rim the variance is signal so a approaches
   1 and the edge passes through untouched. O(N) regardless of window size, and
   unlike a bilateral filter it does not produce gradient reversals at the
   boulder edges this whole exercise exists to preserve. */
export function guided(a, radius = 4, eps = 4.0, w = W, h = W) {
  const sq = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) sq[i] = a[i] * a[i];
  const mean = blur(a, radius, w, h);
  const meanSq = blur(sq, radius, w, h);
  const A = new Float32Array(a.length), B = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const varI = Math.max(meanSq[i] - mean[i] * mean[i], 0);
    A[i] = varI / (varI + eps);
    B[i] = mean[i] - A[i] * mean[i];
  }
  const Am = blur(A, radius, w, h), Bm = blur(B, radius, w, h);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Am[i] * a[i] + Bm[i];
  return out;
}

/* ── 04 · illumination correction ────────────────────────────────────────────
   Multi-scale retinex: divide out a heavily blurred copy of the frame and what
   is left is reflectance with the illumination gradient gone. Three scales
   because one scale trades halo against flatness and three does not have to.
   All three are wide — 22, 60 and 140 px — because the illumination field varies
   on scales far larger than any boulder. A short scale here would subtract the
   terrain along with the light.
   Inside a PSR the illumination field is the wall-scattered light, which falls
   off by more than a decade across a single frame — without this step a global
   stretch buries one half of the scene to expose the other. */
export function retinex(a, scales = [22, 60, 140], w = W, h = W) {
  const eps = 1e-3;
  const out = new Float32Array(a.length);
  const lo = Math.max(percentile(a, 1), 0);
  const norm = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) norm[i] = Math.max(a[i] - lo, 0) + eps;
  for (const s of scales) {
    const L = blur(norm, s, w, h);
    for (let i = 0; i < a.length; i++) out[i] += Math.log(norm[i]) - Math.log(L[i] + eps);
  }
  for (let i = 0; i < a.length; i++) out[i] /= scales.length;
  return out;
}

/* ── 05 · deconvolution ──────────────────────────────────────────────────────
   Richardson–Lucy. The blur here is not a mistake anyone made: it is the optical
   PSF convolved with 2.4 pixels of along-track smear from a TDI line rate that
   never exactly matches ground speed. RL is the maximum-likelihood inverse for
   Poisson data, which is exactly what a photon-starved frame is, and it cannot
   produce negative radiance — the constraint that keeps a deconvolution from
   ringing a crater rim into a pair of ghosts.

   Iterations are capped and the input is denoised first, because RL's noise
   amplification grows without bound: this is the step where a careless pipeline
   starts inventing boulders. */
export function richardsonLucy(a, sigma = 1.35, iters = 24, w = W, h = W) {
  let lo = Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] < lo) lo = a[i];
  lo -= 1e-3;
  const obs = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) obs[i] = a[i] - lo;
  let est = Float32Array.from(obs);
  const ratio = new Float32Array(a.length);
  for (let k = 0; k < iters; k++) {
    const conv = blur(est, sigma, w, h);
    for (let i = 0; i < a.length; i++) ratio[i] = obs[i] / Math.max(conv[i], 1e-6);
    const corr = blur(ratio, sigma, w, h);           // PSF is symmetric, so it is its own adjoint
    for (let i = 0; i < a.length; i++) est[i] = Math.max(est[i] * corr[i], 0);
  }
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = est[i] + lo;
  return out;
}

/* ── 06 · local contrast ─────────────────────────────────────────────────────
   CLAHE, tile-wise histogram equalisation with the transfer slope clipped so a
   flat tile of pure noise cannot be stretched into texture. The clip limit is
   the honesty parameter of the whole pipeline. */
export function clahe(a, tiles = 8, clip = 2.6, w = W, h = W) {
  const lo = percentile(a, 0.2), hi = percentile(a, 99.8);
  const span = Math.max(hi - lo, 1e-6);
  const bins = 128;
  const tw = Math.ceil(w / tiles), th = Math.ceil(h / tiles);
  const maps = [];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const hist = new Float32Array(bins);
      let count = 0;
      for (let y = ty * th; y < Math.min(h, (ty + 1) * th); y++) {
        for (let x = tx * tw; x < Math.min(w, (tx + 1) * tw); x++) {
          const v = (a[y * w + x] - lo) / span;
          hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
          count++;
        }
      }
      const limit = (clip * count) / bins;
      let excess = 0;
      for (let b = 0; b < bins; b++) if (hist[b] > limit) { excess += hist[b] - limit; hist[b] = limit; }
      const share = excess / bins;
      const cdf = new Float32Array(bins);
      let acc = 0;
      for (let b = 0; b < bins; b++) { acc += hist[b] + share; cdf[b] = acc / Math.max(count, 1); }
      maps.push(cdf);
    }
  }
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(tiles - 1.001, Math.max(0, y / th - 0.5));
    const y0 = Math.floor(fy), wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tiles - 1.001, Math.max(0, x / tw - 0.5));
      const x0 = Math.floor(fx), wx = fx - x0;
      const v = (a[y * w + x] - lo) / span;
      const b = Math.min(bins - 1, Math.max(0, Math.floor(v * bins)));
      const m = (yy, xx) => maps[yy * tiles + xx][b];
      out[y * w + x] =
        m(y0, x0) * (1 - wy) * (1 - wx) + m(y0, x0 + 1) * (1 - wy) * wx +
        m(y0 + 1, x0) * wy * (1 - wx) + m(y0 + 1, x0 + 1) * wy * wx;
    }
  }
  return out;
}

/* ── detection ───────────────────────────────────────────────────────────────
   Laplacian-of-Gaussian blobs across a scale octave. A boulder at 0.25 m/px is
   a bright cap with a dark shadow attached, so candidates are scored on the
   pair, not on brightness alone — a noise spike has no shadow.

   Then the part that matters: every candidate is re-tested against independent
   noise realisations of the same frame. A real block survives resampling
   because it is in the signal; a hallucination does not, because it was in the
   noise. Only detections stable across the ensemble are reported, and the
   stability fraction is the confidence. */
export function detectBlobs(a, opts = {}) {
  const { scales = [1.4, 2.2, 3.4, 5.0], thresh = 0.55, w = W, h = W, sunX = -0.72, sunY = 0.69 } = opts;
  const norm = normalise(a);
  const cands = [];
  for (const s of scales) {
    const g1 = blur(norm, s, w, h);
    const g2 = blur(norm, s * 1.6, w, h);
    const dog = new Float32Array(norm.length);
    for (let i = 0; i < norm.length; i++) dog[i] = (g1[i] - g2[i]) * Math.sqrt(s);
    const sd = stats(dog).std;
    const t = thresh * sd * 3.2;
    const r = Math.max(1, Math.round(s));
    for (let y = r + 1; y < h - r - 1; y++) {
      for (let x = r + 1; x < w - r - 1; x++) {
        const v = dog[y * w + x];
        if (v < t) continue;
        let peak = true;
        for (let dy = -r; dy <= r && peak; dy++)
          for (let dx = -r; dx <= r; dx++)
            if ((dx || dy) && dog[(y + dy) * w + (x + dx)] > v) { peak = false; break; }
        if (!peak) continue;
        // a block casts a shadow away from the light: check the antisolar side
        const sx = Math.round(x + sunX * s * 2.4), sy = Math.round(y + sunY * s * 2.4);
        const shadow = (sx > 0 && sy > 0 && sx < w && sy < h)
          ? norm[y * w + x] - norm[sy * w + sx] : 0;
        // No shadow, no block. A rim segment is bright on both sides along its
        // length, so this is also what stops the detector garlanding every crater
        // rim with false positives.
        if (shadow < 0.012) continue;
        cands.push({ x, y, s, v, shadow, score: v * (0.4 + 0.6 * Math.min(shadow * 12, 1)) });
      }
    }
  }
  cands.sort((p, q) => q.score - p.score);
  const kept = [];
  for (const c of cands) {
    const sep = Math.max(c.s * 5.5, 7);
    if (kept.every((k) => (k.x - c.x) ** 2 + (k.y - c.y) ** 2 > sep * sep)) kept.push(c);
    if (kept.length >= 220) break;
  }
  return kept;
}

/* Re-run detection on independent noise realisations and keep what survives. */
export function stabilityFilter(base, runFn, ensemble = 4, tol = 3.0) {
  const others = [];
  for (let e = 0; e < ensemble; e++) others.push(runFn(e));
  return base.map((b) => {
    let hits = 0;
    for (const o of others) {
      if (o.some((c) => (c.x - b.x) ** 2 + (c.y - b.y) ** 2 <= tol * tol)) hits++;
    }
    return { ...b, confidence: hits / ensemble };
  });
}

/* ── metrics ─────────────────────────────────────────────────────────────────
   Computed here, live, against the paired target — not quoted from a table. */
export function normalise(a) {
  const lo = percentile(a, 0.5), hi = percentile(a, 99.5);
  const span = Math.max(hi - lo, 1e-9);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i] - lo) / span));
  return out;
}

/* Enhancement is not asked to reproduce the reference's exact tone curve — only
   its structure. Retinex and CLAHE deliberately change global tone, and scoring
   them against an absolute grey level would measure the tone choice rather than
   the recovery. So both images are brought onto a common scale by the
   least-squares affine fit before the error is taken, which is the standard
   practice for reference-based evaluation of enhancement, and it is stated
   wherever these numbers appear. */
export function affineFit(x, y) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
  const den = n * sxx - sx * sx;
  const a = Math.abs(den) < 1e-12 ? 1 : (n * sxy - sx * sy) / den;
  const b = (sy - a * sx) / n;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, a * x[i] + b));
  return out;
}

export function psnr(x, y) {
  let se = 0;
  for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; se += d * d; }
  return 10 * Math.log10(1 / Math.max(se / x.length, 1e-12));
}

/* SSIM with an 8-px Gaussian window, the standard formulation. */
export function ssim(x, y, w = W, h = W) {
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2, s = 5;
  const xy = new Float32Array(x.length), xx = new Float32Array(x.length), yy = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { xy[i] = x[i] * y[i]; xx[i] = x[i] * x[i]; yy[i] = y[i] * y[i]; }
  const mx = blur(x, s, w, h), my = blur(y, s, w, h);
  const mxx = blur(xx, s, w, h), myy = blur(yy, s, w, h), mxy = blur(xy, s, w, h);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    const vx = mxx[i] - mx[i] * mx[i], vy = myy[i] - my[i] * my[i], cxy = mxy[i] - mx[i] * my[i];
    acc += ((2 * mx[i] * my[i] + C1) * (2 * cxy + C2)) /
           ((mx[i] * mx[i] + my[i] * my[i] + C1) * (vx + vy + C2));
  }
  return acc / x.length;
}

/* Contrast-to-noise ratio, the metric that works with no ground truth at all:
   how far apart the structure is relative to the noise floor measured in the
   flattest patch of the frame. */
export function cnr(a, w = W, h = W) {
  const sm = blur(a, 3, w, h);
  const resid = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) resid[i] = a[i] - sm[i];
  const noise = stats(resid).std;
  const lo = percentile(a, 5), hi = percentile(a, 95);
  return (hi - lo) / Math.max(noise, 1e-9);
}

/* Sharpness as normalised gradient energy: the number that has to go up when a
   deconvolution works and has to stay flat when it is only amplifying noise. */
export function sharpness(a, w = W, h = W) {
  const n = normalise(a);
  let e = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = n[i + 1] - n[i - 1], gy = n[i + w] - n[i - w];
      e += gx * gx + gy * gy;
    }
  }
  return Math.sqrt(e / ((w - 2) * (h - 2))) * 100;
}

/* ── noise synthesis, for the ensemble test and the live degradation demo ──── */
export function degrade(clean, { blurSigma = 0, noiseDN = 0, seed = 1, w = W, h = W } = {}) {
  let a = blurSigma > 0 ? blur(clean, blurSigma, w, h) : Float32Array.from(clean);
  if (noiseDN <= 0) return a;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const u1 = Math.max(rnd(), 1e-9), u2 = rnd();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = a[i] + g * noiseDN;
  }
  return out;
}

export function resample(src, sw, sh, dw = W, dh = W) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, (y * sh) / dh);
    const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, (x * sw) / dw);
      const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(sw - 1, x0 + 1);
      out[y * dw + x] =
        src[y0 * sw + x0] * (1 - fx) * (1 - fy) + src[y0 * sw + x1] * fx * (1 - fy) +
        src[y1 * sw + x0] * (1 - fx) * fy + src[y1 * sw + x1] * fx * fy;
    }
  }
  return out;
}
