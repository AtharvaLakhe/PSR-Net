/* ── the trained model, running here ─────────────────────────────────────────
   PSR-Net inference in the browser, on the same 12-bit array the deterministic
   chain gets. The model is 714 k parameters trained on synthetic PSR frames with
   a randomised OHRC sensor; the file is 2.9 MB, which is why it can be a static
   asset at all.

   Everything degrades gracefully. If the weights are missing, or WebAssembly is
   blocked, or the runtime fails to start, `available` stays false and the page
   shows the deterministic chain alone rather than an error. A demo that breaks
   when a 3 MB download fails is worse than one that quietly does less.
   ────────────────────────────────────────────────────────────────────────── */

let ort = null;
let session = null;
let meta = null;
let status = 'idle';        // idle | loading | ready | unavailable
let backend = '';

export const modelStatus = () => status;
export const modelMeta = () => meta;
export const modelBackend = () => backend;

export async function loadModel() {
  if (status === 'ready' || status === 'unavailable') return status === 'ready';
  status = 'loading';
  try {
    meta = await fetch('model/psrnet.json').then((r) => {
      if (!r.ok) throw new Error('no metadata');
      return r.json();
    });

    ort = await import('onnxruntime-web');
    /* Absolute, not relative: the runtime resolves this against its own module
       URL, so a relative path became /vendor/ort/vendor/ort/... and 404'd.
       Everything still comes from this deployment — no CDN. */
    ort.env.wasm.wasmPaths = '/vendor/ort/';
    // threads need cross-origin isolation, which server.mjs grants; without it
    // the runtime falls back to one thread and simply takes longer
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    ort.env.logLevel = 'error';

    /* WebAssembly, threaded. WebGPU was measured at 2175 ms against wasm's
       2479 ms for this network — 300 ms that would cost 78 MB of extra wasm
       binaries in the deployment, because the WebGPU bundle chooses its variant
       from browser capability and every variant has to be shipped. */
    session = await ort.InferenceSession.create('model/psrnet.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    backend = `wasm x${ort.env.wasm.numThreads}`;
    status = 'ready';
    return true;
  } catch (err) {
    console.warn('[psr-net] model unavailable, staying on the deterministic chain:', err.message);
    status = 'unavailable';
    return false;
  }
}

/* The network was trained on inputs normalised by percentiles of the input
   itself — never of the target, because at inference there is no target. Getting
   this wrong is the classic way a model that scored well offline produces mush
   in production, so the exact training-time transform lives here. */
function normaliseInput(dn) {
  const sorted = Float32Array.from(dn).sort();
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
  const lo = at(1.0);
  const span = Math.max(at(99.8) - lo, 1e-3);
  const out = new Float32Array(dn.length);
  for (let i = 0; i < dn.length; i++) out[i] = (dn[i] - lo) / span;
  return out;
}

/* The exported graph has its padding folded away by the tracer, so it needs both
   dimensions divisible by four — two stride-2 downsamples. Rather than forbid
   other sizes, pad by edge replication here and crop the result back, which also
   makes the "run it on your own image" path safe for any upload. */
const MULTIPLE = 4;

function padTo(src, w, h, mw, mh) {
  const out = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const sy = Math.min(y, h - 1);
    for (let x = 0; x < mw; x++) out[y * mw + x] = src[sy * w + Math.min(x, w - 1)];
  }
  return out;
}

function crop(src, mw, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * mw, y * mw + w), y * w);
  return out;
}

/**
 * Run the network over one frame of raw DN.
 * @param {Float32Array} dn raw digital numbers, w*h
 * @param {number} w width
 * @param {number} [h] height, defaults to square
 * @returns {Promise<{data: Float32Array, ms: number}|null>} null if unavailable
 */
export async function enhance(dn, w, h = w) {
  if (status !== 'ready' && !(await loadModel())) return null;
  const mw = Math.ceil(w / MULTIPLE) * MULTIPLE;
  const mh = Math.ceil(h / MULTIPLE) * MULTIPLE;
  const x = normaliseInput(dn);
  const fed = (mw === w && mh === h) ? x : padTo(x, w, h, mw, mh);

  const tensor = new ort.Tensor('float32', fed, [1, 1, mh, mw]);
  const t0 = performance.now();
  const res = await session.run({ input: tensor });
  const ms = performance.now() - t0;

  const raw = Float32Array.from(res.output.data);
  return { data: (mw === w && mh === h) ? raw : crop(raw, mw, w, h), ms };
}
