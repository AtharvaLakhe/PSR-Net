/* ── PSR-NET page ─────────────────────────────────────────────────────────────
   Loads the 12-bit frame, runs the pipeline once, caches every stage, and drives
   the scroll story off those buffers. Nothing here is a pre-rendered result: the
   numbers under the viewport come out of the same arrays the picture does.
   ────────────────────────────────────────────────────────────────────────── */

import * as E from './engine.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { createJourney } from './journey.js';
import { loadModel, enhance, modelStatus, modelMeta, modelBackend } from './net.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

/* The stylesheet hides [data-anim] so GSAP can reveal it. If anything below
   throws before that happens, the page would be a set of empty screens — so the
   hiding is withdrawn on any error, and unconditionally after six seconds. A
   missed animation is a blemish; missing content is a broken page. */
const showEverything = () => document.documentElement.classList.remove('js');
addEventListener('error', showEverything);
addEventListener('unhandledrejection', showEverything);
setTimeout(showEverything, 6000);

const W = E.W;
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

const state = {
  dn: null,          // raw 12-bit digital numbers, W x W
  truth: null,       // paired target, 0..1
  stages: [],        // { name, buf, metrics }
  detections: [],
  rejected: 0,
  meta: null,
  current: 0,
  split: 0.5,        // where the comparison wipe sits, 0..1
};

/* ── image loading ───────────────────────────────────────────────────────── */
async function pixels(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height };
}

/* The frame ships with its high byte in red and its low byte in green, because
   an 8-bit PNG would throw away the very thing this page is about. */
async function load12bit(src) {
  const { data, w, h } = await pixels(src);
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data.data[p] << 8) | data.data[p + 1];
  }
  return E.resample(out, w, h);
}

async function loadGray(src) {
  const { data, w, h } = await pixels(src);
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = data.data[p] / 255;
  return E.resample(out, w, h);
}

/* ── drawing ─────────────────────────────────────────────────────────────── */
function paint(canvas, buf, { lo, hi, gamma = 1, src: srcW = W } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const img = ctx.createImageData(w, h);
  const a = lo === undefined ? E.percentile(buf, 0.4) : lo;
  const b = hi === undefined ? E.percentile(buf, 99.6) : hi;
  const span = Math.max(b - a, 1e-9);
  const src = (w === srcW && h === srcW) ? buf : E.resample(buf, srcW, srcW, w, h);
  for (let i = 0; i < w * h; i++) {
    let v = (src[i] - a) / span;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (gamma !== 1) v = Math.pow(v, gamma);
    const g = (v * 255) | 0;
    const p = i * 4;
    // a hair of warmth in the highlights, so the plate reads as regolith and not
    // as a monitor test card; hue never encodes data
    img.data[p] = Math.min(255, g + (g > 150 ? 6 : 0));
    img.data[p + 1] = g;
    img.data[p + 2] = Math.max(0, g - (g > 150 ? 4 : 0));
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ── the histogram rail ──────────────────────────────────────────────────── */
function drawRail(buf, label, quantised = false) {
  const c = $('hist');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);

  const lo = E.percentile(buf, 0.1), hi = E.percentile(buf, 99.9);
  // A raw PSR frame holds about a dozen distinct integer DN values, so binning it
  // at 220 draws a picket fence of empty bins. One bin per level tells the truth:
  // the whole scene is quantised into a handful of steps.
  const span = hi - lo;
  const bins = quantised ? Math.max(6, Math.round(span) + 1) : 200;
  const hist = E.histogram(buf, bins, lo, hi + (quantised ? 1 : 0));
  let max = 0;
  for (const v of hist) if (v > max) max = v;
  // Few bins means every one of them is populated, and a log axis would draw them
  // all at full height — a solid block, which says nothing. Linear there, log for
  // the wide distributions further down the chain where the tail is the story.
  const wide = !quantised;
  const norm = (v) => (wide ? Math.log1p(v) / Math.log1p(max) : v / max);

  ctx.fillStyle = '#ffb454';
  for (let i = 0; i < bins; i++) {
    const bh = norm(hist[i]) * h * 0.92;
    const x = (i / bins) * w;
    ctx.globalAlpha = 0.28 + 0.72 * (bh / h);
    ctx.fillRect(x, h - bh, Math.max(1, w / bins - (quantised ? 3 : 1)), bh);
  }
  ctx.globalAlpha = 1;
  $('rail-mid').textContent = label;
  $('rail-hi').textContent = `DN ${Math.round(hi)}`;
}

/* ── the pipeline ────────────────────────────────────────────────────────── */
function metricsFor(buf) {
  const n = E.affineFit(E.normalise(buf), state.truth);
  return {
    psnr: E.psnr(n, state.truth),
    ssim: E.ssim(n, state.truth),
    cnr: E.cnr(buf),
    sharp: E.sharpness(buf),
  };
}

function runChain(dn, opts = {}) {
  const { iters = 24, clip = 2.6, skip = {}, size = W } = opts;
  const s = size;
  // scales that were tuned at 512 have to follow the working size, or the lab
  // at half resolution would be running a different filter to the story
  const k = s / W;
  const out = [];
  let cur = Float32Array.from(dn);
  out.push({ id: 0, name: 'RAW', buf: cur });

  if (!skip.radiometric) cur = E.radiometric(cur).out;
  out.push({ id: 1, name: 'RADIOMETRIC', buf: cur });

  if (!skip.destripe) cur = E.destripe(cur, s, s);
  out.push({ id: 2, name: 'DESTRIPED', buf: cur });

  if (!skip.denoise) cur = E.guided(cur, Math.max(2, 6 * k), 9.0, s, s);
  out.push({ id: 3, name: 'DENOISED', buf: cur });

  if (!skip.retinex) cur = E.retinex(cur, [22 * k, 60 * k, 140 * k], s, s);
  out.push({ id: 4, name: 'ILLUMINATION', buf: cur });

  if (!skip.deconv && iters > 0) cur = E.richardsonLucy(cur, 1.35 * k, iters, s, s);
  out.push({ id: 5, name: 'DECONVOLVED', buf: cur });

  if (!skip.clahe) cur = E.clahe(cur, 8, clip, s, s);
  out.push({ id: 6, name: 'LOCAL CONTRAST', buf: cur });

  out.push({ id: 7, name: 'DETECTION', buf: cur });
  out.push({ id: 8, name: 'VS TARGET', buf: cur });
  return out;
}

async function buildPipeline() {
  const stages = [];
  const chain = runChain(state.dn);
  for (const s of chain) {
    stages.push({ ...s, metrics: metricsFor(s.buf) });
    boot.set(22 + (stages.length / chain.length) * 48, `stage ${String(s.id).padStart(2, '0')} · ${s.name.toLowerCase()}`);
    await frame();
  }
  state.stages = stages;

  // detection, then the ensemble stability test that decides what survives
  const final = stages[6].buf;
  const base = E.detectBlobs(final);
  await frame();
  const runFn = (seed) => {
    const noisy = E.degrade(state.dn, { noiseDN: 0.9, seed: seed + 3 });
    const c = runChain(noisy);
    return E.detectBlobs(c[6].buf);
  };
  boot.set(78, 'testing detections against noise');
  const scored = E.stabilityFilter(base, runFn, 3, 3.5);
  state.detections = scored.filter((d) => d.confidence >= 0.66);
  state.rejected = scored.length - state.detections.length;

  /* the trained network, on the same array the chain was handed */
  boot.set(88, 'loading the trained network');
  const ok = await loadModel();
  if (ok) {
    const r = await enhance(state.dn, W);
    if (r) {
      state.stages[9] = { id: 9, name: 'PSR-NET', buf: r.data, metrics: metricsFor(r.data) };
      state.netMs = r.ms;
    }
  }
  if (!state.stages[9]) {
    // no weights, no runtime, or no network: the chain's own result stands in and
    // the copy says so rather than showing an empty screen
    state.stages[9] = { ...state.stages[6], id: 9, name: 'PSR-NET' };
    state.netMissing = true;
  }
}

/* ── the comparison wipe ─────────────────────────────────────────────────────
   Recovered on the left, the target it never saw on the right, and the reader
   decides where the seam falls. Cached target pixels because this repaints on
   every pointer move.
   ────────────────────────────────────────────────────────────────────────── */
let truthPixels = null;

function drawCompare() {
  const canvas = $('vp-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const s = state.stages[8];
  if (!s) return;

  paint(canvas, s.buf);
  const merged = ctx.getImageData(0, 0, w, h);

  if (!truthPixels) {
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    paint(tmp, state.truth, { lo: 0, hi: 1 });
    truthPixels = tmp.getContext('2d').getImageData(0, 0, w, h);
  }

  const cut = Math.round(state.split * w);
  for (let y = 0; y < h; y++) {
    for (let x = cut; x < w; x++) {
      const p = (y * w + x) * 4;
      merged.data[p] = truthPixels.data[p];
      merged.data[p + 1] = truthPixels.data[p + 1];
      merged.data[p + 2] = truthPixels.data[p + 2];
    }
  }
  ctx.putImageData(merged, 0, 0);

  // the seam, with a grip so it reads as something you can take hold of
  ctx.fillStyle = '#ffb454';
  ctx.fillRect(cut - 1, 0, 2, h);
  ctx.beginPath();
  ctx.arc(cut, h / 2, 13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,10,14,.85)';
  ctx.fill();
  ctx.strokeStyle = '#ffb454';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffb454';
  ctx.beginPath();
  ctx.moveTo(cut - 7, h / 2); ctx.lineTo(cut - 2, h / 2 - 4); ctx.lineTo(cut - 2, h / 2 + 4);
  ctx.moveTo(cut + 7, h / 2); ctx.lineTo(cut + 2, h / 2 - 4); ctx.lineTo(cut + 2, h / 2 + 4);
  ctx.fill();

  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,180,84,.92)';
  if (cut > 92) ctx.fillText('RECOVERED', 10, h - 12);
  if (w - cut > 66) ctx.fillText('TARGET', cut + 10, h - 12);
}

function wireCompare() {
  const wrap = document.querySelector('.vp-canvas-wrap');
  const canvas = $('vp-canvas');
  let dragging = false;

  const setFromEvent = (e) => {
    const r = canvas.getBoundingClientRect();
    state.split = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
    if (state.current === 8) {
      drawCompare();
      wrap.setAttribute('aria-valuenow', Math.round(state.split * 100));
    }
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (state.current !== 8) return;
    dragging = true;
    // capture keeps the drag alive if the pointer leaves the canvas; it is not
    // available for every pointer type, and its absence must not break the drag
    try { wrap.setPointerCapture(e.pointerId); } catch { /* carry on uncaptured */ }
    setFromEvent(e);
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  };
  wrap.addEventListener('pointerup', stop);
  wrap.addEventListener('pointercancel', stop);

  // reachable without a pointer at all
  wrap.addEventListener('keydown', (e) => {
    if (state.current !== 8) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') state.split = Math.max(0.02, state.split - step);
    else if (e.key === 'ArrowRight') state.split = Math.min(0.98, state.split + step);
    else if (e.key === 'Home') state.split = 0.02;
    else if (e.key === 'End') state.split = 0.98;
    else return;
    e.preventDefault();
    drawCompare();
  });
}

/* ── viewport ────────────────────────────────────────────────────────────── */
const STAGE_LABEL = [
  'RAW FRAME', 'RADIOMETRIC', 'DESTRIPED', 'DENOISED',
  'ILLUMINATION', 'DECONVOLVED', 'LOCAL CONTRAST', 'DETECTION', 'VS TARGET',
  'PSR-NET',
];
/* The network was added to the chain after the fact, so its buffer lives at
   index 9 while it is read seventh. Array position is not stage number, and the
   viewport must show the number the reader sees in the step beside it. */
const STAGE_NUM = ['00', '01', '02', '03', '04', '05', '06', '08', '09', '07'];

function showStage(i) {
  if (!state.stages.length) return;
  state.current = i;
  const s = state.stages[Math.min(i, state.stages.length - 1)];
  const canvas = $('vp-canvas');

  document.body.classList.toggle('comparing', i === 8);
  if (i === 8) {
    drawCompare();
  } else {
    paint(canvas, s.buf, i === 0 ? { lo: 0, hi: 4095 } : undefined);
  }

  drawAnnotations(i);
  drawRail(i === 0 ? state.dn : s.buf,
    i === 0 ? 'thirteen distinct values, and that is the whole scene'
            : STAGE_LABEL[i].toLowerCase(), i <= 2);

  $('vp-stage').textContent = `${STAGE_NUM[i]} · ${STAGE_LABEL[i]}`;
  $('chrome-stage').textContent = STAGE_LABEL[i];
  $('chrome-idx').textContent = STAGE_NUM[i];

  if (i === 9) {
    const el = $('k-netms');
    if (el) {
      el.textContent = state.netMissing
        ? 'weights not present in this build — the chain result is shown instead'
        : `${modelMeta()?.params.toLocaleString()} parameters · ${Math.round(state.netMs)} ms for 512x512 on ${modelBackend()}`;
    }
  }

  const m = s.metrics;
  $('m-psnr').textContent = m.psnr.toFixed(1);
  $('m-ssim').textContent = m.ssim.toFixed(3);
  $('m-cnr').textContent = m.cnr.toFixed(1);
  $('m-sharp').textContent = m.sharp.toFixed(2);
}

function drawAnnotations(stage) {
  const c = $('vp-annot');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (stage !== 7) return;
  const k = c.width / W;
  for (const d of state.detections) {
    const r = Math.max(4, d.s * 2.4) * k;
    ctx.beginPath();
    ctx.arc(d.x * k, d.y * k, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,180,84,${0.25 + 0.75 * d.confidence})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  $('k-det').textContent = state.detections.length;
  $('k-rej').textContent = state.rejected;
}

/* ── hero ────────────────────────────────────────────────────────────────── */
function heroPaint(t) {
  // t = 0 shows the frame at true 12-bit scaling, which is very nearly black.
  // t = 1 shows it at percentile scaling. The scroll does the opening.
  const hi = 4095 * (1 - t) + E.percentile(state.dn, 99.7) * t;
  const lo = 0;
  paint($('hero-canvas'), state.dn, { lo, hi: Math.max(hi, 6), gamma: 1 - 0.35 * t });
}

/* ── pole overlay ────────────────────────────────────────────────────────── */
async function drawPole() {
  const { data, w, h } = await pixels('data/psr_map.png');
  const c = $('pole-overlay');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const on = data.data[p] > 127 ? 1 : 0;
    img.data[p] = 90 * on;
    img.data[p + 1] = 96 * on;
    img.data[p + 2] = 255 * on;
    img.data[p + 3] = on ? 150 : 0;
  }
  ctx.putImageData(img, 0, 0);
}

/* ── ablation, computed on demand ────────────────────────────────────────── */
let ablationDone = false;
function runAblation() {
  if (ablationDone) return;
  ablationDone = true;
  const rows = [
    ['Full chain', {}],
    ['− radiometric correction', { radiometric: true }],
    ['− destriping', { destripe: true }],
    ['− denoising', { denoise: true }],
    ['− illumination correction', { retinex: true }],
    ['− deconvolution', { deconv: true }],
    ['− local contrast', { clahe: true }],
  ];
  const body = $('ablation').querySelector('tbody');
  body.innerHTML = '';
  let basePsnr = 0;
  rows.forEach(([label, skip], i) => {
    const chain = runChain(state.dn, { skip });
    const m = metricsFor(chain[6].buf);
    if (i === 0) basePsnr = m.psnr;
    const d = m.psnr - basePsnr;
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'base';
    tr.innerHTML = `<td>${label}</td><td>${m.psnr.toFixed(2)}</td><td>${m.ssim.toFixed(3)}</td>` +
      `<td>${m.cnr.toFixed(1)}</td><td class="${d < -0.01 ? 'delta-neg' : ''}">` +
      `${i === 0 ? '—' : (d >= 0 ? '+' : '') + d.toFixed(2)}</td>`;
    body.appendChild(tr);
  });
}

/* ── model provenance, read from the files the training run wrote ────────── */
async function showModelFacts() {
  const live = $('net-live');
  const m = modelMeta();
  if (m) {
    $('net-params').textContent = m.params.toLocaleString();
    $('net-size').textContent = `${(m.size_bytes / 1e6).toFixed(1)} MB`;
    live.innerHTML = `Weights loaded: step <b>${m.step.toLocaleString()}</b>, ` +
      `held-out validation <b>${m.best_val_psnr.toFixed(2)} dB</b>, running on ` +
      `<b>${modelBackend()}</b>.`;
    live.classList.add('ok');
  } else {
    live.textContent = 'No weights in this build — the deterministic chain is shown on its own. '
      + 'Run psr/train/train.py, then export_onnx.py, and this section fills itself in.';
  }

  // the learned-vs-classical table, straight out of the benchmark run
  try {
    const b = await fetch('model/benchmark.json').then((r) => {
      if (!r.ok) throw new Error('none');
      return r.json();
    });
    const body = $('bench').querySelector('tbody');
    body.innerHTML = '';
    const rows = [['Raw frame', b.raw], ['Deterministic chain', b.classical], ['PSR-Net', b.learned]];
    rows.forEach(([label, s], i) => {
      const tr = document.createElement('tr');
      if (i === 2) tr.className = 'base';
      const d = s.psnr - b.raw.psnr;
      tr.innerHTML = `<td>${label}</td><td>${s.psnr.toFixed(2)} ±${s.psnr_std.toFixed(2)}</td>` +
        `<td>${s.ssim.toFixed(3)}</td><td>${i === 0 ? '—' : '+' + d.toFixed(2)}</td>`;
      body.appendChild(tr);
    });
    const cap = document.createElement('tr');
    cap.innerHTML = `<td colspan="4" class="bench-note">${b.scenes} held-out scenes at ` +
      `${b.size}x${b.size}, fixed degradation seeds. PSR-Net beats the chain by ` +
      `<b>${b.gain_over_classical_db >= 0 ? '+' : ''}${b.gain_over_classical_db.toFixed(2)} dB</b>.</td>`;
    body.appendChild(cap);
  } catch { /* no benchmark yet; the placeholder row stands */ }
}

/* ── the lab ─────────────────────────────────────────────────────────────── */
/* The lab runs at half the story's resolution and defers the detector.

   A slider drag used to re-run the whole chain at 512x512 including blob
   detection — about two and a half seconds per frame of movement, which reads as
   a broken control rather than a slow one. At 256 the chain is four times
   cheaper, and detection (the single most expensive stage) only runs once you
   stop moving, because a count that flickers during a drag tells you nothing
   anyway. */
const LAB_W = 256;
const lab = {
  source: null, small: null, truth: null, queued: false, idle: 0, last: null,
  /* Whether a paired target exists for whatever is currently loaded. True for
     the shipped OHRC frame, false the moment you bring your own image — because
     for your image nothing was withheld, so there is nothing to compare against
     and every full-reference metric is undefined. */
  hasTruth: true,
};

/* Say so on the canvas itself. The alternative — leaving the built-in target on
   screen next to somebody else's photograph — silently invites the reader to
   compare two unrelated pictures, and quotes a PSNR for the privilege. */
function paintNoTarget() {
  const c = $('lab-truth');
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(200,195,184,.14)';
  ctx.setLineDash([4, 5]);
  ctx.strokeRect(10.5, 10.5, c.width - 21, c.height - 21);
  ctx.setLineDash([]);
  ctx.fillStyle = '#7d8494';
  ctx.textAlign = 'center';
  ctx.font = '600 12px ui-monospace, monospace';
  ctx.fillText('NO TARGET EXISTS', c.width / 2, c.height / 2 - 26);
  ctx.font = '12px system-ui, sans-serif';
  for (const [i, line] of [
    'This is your image. Nothing was',
    'withheld from the pipeline, so there',
    'is nothing to score it against.',
    '',
    'PSNR and SSIM are undefined here.',
  ].entries()) {
    ctx.fillStyle = i === 4 ? '#ffb454' : '#7d8494';
    ctx.fillText(line, c.width / 2, c.height / 2 + 2 + i * 17);
  }
  ctx.textAlign = 'start';
}

function labSource() {
  if (!lab.small) lab.small = E.resample(lab.source, W, W, LAB_W, LAB_W);
  return lab.small;
}

function runLab({ withDetections = false } = {}) {
  const blurSigma = +$('c-blur').value;
  const noiseDN = +$('c-noise').value;
  const iters = +$('c-iters').value;
  const clip = +$('c-clip').value;
  $('v-blur').textContent = blurSigma.toFixed(2);
  $('v-noise').textContent = noiseDN.toFixed(2);
  $('v-iters').textContent = iters;
  $('v-clip').textContent = clip.toFixed(1);

  const k = LAB_W / W;
  const degraded = E.degrade(labSource(), {
    blurSigma: blurSigma * k, noiseDN, seed: 7, w: LAB_W, h: LAB_W,
  });
  const chain = runChain(degraded, { iters, clip, size: LAB_W });
  const out = chain[6].buf;
  lab.last = out;

  paint($('lab-in'), degraded, { src: LAB_W });
  paint($('lab-out'), out, { src: LAB_W });

  if (lab.hasTruth) {
    if (!lab.truth) lab.truth = E.resample(state.truth, W, W, LAB_W, LAB_W);
    paint($('lab-truth'), lab.truth, { lo: 0, hi: 1, src: LAB_W });
    const n = E.affineFit(E.normalise(out), lab.truth);
    $('l-psnr').textContent = E.psnr(n, lab.truth).toFixed(1);
    $('l-ssim').textContent = E.ssim(n, lab.truth, LAB_W, LAB_W).toFixed(3);
  } else {
    paintNoTarget();
    // a dash, not a number: there is no reference, so there is no score
    $('l-psnr').textContent = '—';
    $('l-ssim').textContent = '—';
  }

  // CNR and the detector need no reference, so they stay meaningful either way
  $('l-cnr').textContent = E.cnr(out, LAB_W, LAB_W).toFixed(1);

  if (withDetections) {
    $('l-det').textContent = E.detectBlobs(out, { w: LAB_W, h: LAB_W }).length;
  } else {
    $('l-det').textContent = '…';
  }
}

/* Coalesce to one run per frame: a drag fires input events far faster than the
   chain can answer, and queueing them all is what makes a control feel stuck. */
function scheduleLab() {
  if (!lab.queued) {
    lab.queued = true;
    requestAnimationFrame(() => { lab.queued = false; runLab(); });
  }
  clearTimeout(lab.idle);
  lab.idle = setTimeout(() => runLab({ withDetections: true }), 200);
}

async function useOwnImage(file) {
  const url = URL.createObjectURL(file);
  const { data, w, h } = await pixels(url);
  URL.revokeObjectURL(url);
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    // luminance, then scaled into the same DN range the pipeline expects
    g[i] = (0.2126 * data.data[p] + 0.7152 * data.data[p + 1] + 0.0722 * data.data[p + 2]) * 0.06;
  }
  lab.source = E.resample(g, w, h);
  lab.small = null;
  lab.hasTruth = false;
  $('lab-truth-cap').textContent = 'No target — nothing to compare against';
  $('lab-note').innerHTML =
    'Running on <b>your</b> image. There is no paired target for it, so PSNR and SSIM ' +
    'are undefined and shown as dashes rather than as numbers against an unrelated ' +
    'picture. CNR and the detection count need no reference and still mean what they say.';
  runLab({ withDetections: true });
}


/* ── scene engine, on GSAP ────────────────────────────────────────────────────
   ScrollTrigger owns the timing and GSAP owns the easing, which is the part a
   hand-rolled rAF loop never gets right: expo.out on a 900 ms reveal is what
   separates "it moved" from "it arrived".

   What is deliberately NOT used is ScrollSmoother. It re-parents the document
   into a transformed wrapper, and this page depends on position:sticky for the
   pipeline viewport and on fixed chrome for the ruler and the histogram rail.
   Native scroll keeps the scrollbar, keyboard paging and find-in-page working,
   and those are worth more than inertia.
   ────────────────────────────────────────────────────────────────────────── */
function wireScenes() {
  const scenes = [...document.querySelectorAll('[data-chapter]')]
    .sort((a, b) => a.offsetTop - b.offsetTop);

  /* A pinned scene taller than the screen hides its own bottom and no amount of
     scrolling reaches it — the failure mode of every cinematic page checked only
     on the designer's monitor. Measure, and let the ones that do not fit scroll
     like a document. */
  function fit() {
    for (const s of scenes) {
      const wrap = s.querySelector('.scene-inner > .wrap');
      if (!wrap) continue;
      s.classList.toggle('tall', wrap.scrollHeight > innerHeight - 174);
    }
  }
  fit();

  // the ruler: one tick per chapter, click to travel
  const track = $('ruler-track');
  const ticks = scenes.map((s) => {
    const b = document.createElement('button');
    b.className = 'tick';
    b.type = 'button';
    b.innerHTML = `<i></i><span>${s.dataset.chapter}</span>`;
    b.setAttribute('aria-label', `Go to ${s.dataset.chapter}`);
    b.addEventListener('click', () => s.scrollIntoView({
      behavior: REDUCED ? 'auto' : 'smooth', block: 'start',
    }));
    track.appendChild(b);
    return b;
  });

  ScrollTrigger.create({
    trigger: document.body, start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => $('ruler').style.setProperty('--progress', self.progress.toFixed(4)),
  });

  scenes.forEach((s, i) => {
    ScrollTrigger.create({
      trigger: s, start: 'top 45%', end: 'bottom 45%',
      onToggle: (self) => { if (self.isActive) ticks.forEach((t, k) => t.classList.toggle('on', k === i)); },
    });
  });

  const mm = gsap.matchMedia();

  /* full choreography */
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    for (const s of scenes) {
      // headings are handled by SplitText below, so they sit this one out
      const bits = [...s.querySelectorAll('[data-anim]')].filter((el) => !/^H[12]$/.test(el.tagName));
      if (bits.length) {
        gsap.fromTo(bits,
          { y: 34, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.95, ease: 'expo.out', stagger: 0.075,
            scrollTrigger: { trigger: s, start: 'top 68%', once: true } });
      }

      // headings arrive line by line out of a mask, the way a plate develops
      const head = s.querySelector('h1, h2');
      if (head) {
        gsap.set(head, { opacity: 1 });          // the mask does the hiding now
        SplitText.create(head, {
          type: 'lines', mask: 'lines', autoSplit: true,
          onSplit(self) {
            return gsap.fromTo(self.lines,
              { yPercent: 115, opacity: 0 },
              { yPercent: 0, opacity: 1, duration: 1.05, ease: 'expo.out', stagger: 0.09,
                scrollTrigger: { trigger: head, start: 'top 82%', once: true } });
          },
        });
      }

      // and the whole scene recedes as the next one takes it over
      const inner = s.querySelector('.scene-inner');
      if (inner && !s.classList.contains('tall') && s.id !== 'scrolly') {
        gsap.to(inner, {
          opacity: 0.06, scale: 0.955, y: -26, ease: 'none',
          scrollTrigger: { trigger: s, start: 'bottom bottom', end: 'bottom 22%', scrub: 0.4 },
        });
      }
    }

    // the hero frame opens as you leave it: scrubbed, not timed
    ScrollTrigger.create({
      trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.25,
      onUpdate: (self) => { if (state.dn) heroPaint(self.progress); },
    });

    // the photon-budget bars grow when the scene lands
    ScrollTrigger.create({
      trigger: '#budget', start: 'top 75%', once: true,
      onEnter: () => {
        $('budget').querySelectorAll('[data-bar]').forEach((el, i) => {
          const v = +el.dataset.bar;
          gsap.to(el, {
            '--w': `${Math.max(2, ((Math.log10(v + 0.01) + 2) / 4) * 100)}%`,
            duration: 1.1, ease: 'expo.out', delay: i * 0.12,
          });
        });
      },
    });

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  });

  /* reduced motion: everything is simply present */
  mm.add('(prefers-reduced-motion: reduce)', () => {
    gsap.set('[data-anim], h1, h2', { opacity: 1, y: 0, clearProps: 'transform,clipPath' });
    if (state.dn) heroPaint(1);
    $('budget').querySelectorAll('[data-bar]').forEach((el) => {
      const v = +el.dataset.bar;
      el.style.setProperty('--w', `${Math.max(2, ((Math.log10(v + 0.01) + 2) / 4) * 100)}%`);
    });
  });

  addEventListener('resize', () => { fit(); ScrollTrigger.refresh(); });
}

/* ── the flight ──────────────────────────────────────────────────────────── */
function wireFlight() {
  const canvas = $('flight');
  if (!canvas) return;
  // A phone should not be asked to raymarch a moon behind eight screens of type.
  const light = matchMedia('(max-width: 720px)').matches;
  const flight = createJourney(canvas, {});
  flight.setQuality(light);
  flight.bind('#journey', $('flash'), $('viewfinder'));
  window.__flight = flight.state;   // so the scene can be inspected while tuning

  // captions arrive and leave with the act they belong to
  document.querySelectorAll('.act-copy').forEach((el) => {
    gsap.fromTo(el, { opacity: 0, y: 26 }, {
      opacity: 1, y: 0, duration: 0.7, ease: 'expo.out',
      scrollTrigger: { trigger: el.parentElement, start: 'top 62%', end: 'bottom 38%', toggleActions: 'play reverse play reverse' },
    });
  });

  // once the picture has been taken the canvas is dead weight; let it go
  /* The scene stays up through the capture — the viewfinder has to close on the
     rover, not on an empty screen — and only lets go as the real frame arrives. */
  ScrollTrigger.create({
    trigger: '#hero', start: 'top 92%',
    /* Opacity is set here rather than left to a class, because the class also
       has to survive being toggled twice by a fast scroll and the two orders
       resolve differently. One writer, one source of truth. */
    onEnter: () => {
      document.body.classList.add('flown');
      canvas.style.opacity = '0';
      setTimeout(() => { if (document.body.classList.contains('flown')) flight.pause(true); }, 900);
    },
    onLeaveBack: () => {
      flight.pause(false);
      document.body.classList.remove('flown');
      canvas.style.opacity = '1';
    },
  });
}

/* ── boot counter ────────────────────────────────────────────────────────── */
const boot = {
  set(pct, task) {
    $('boot-pct').textContent = String(Math.round(pct)).padStart(3, '0');
    $('boot-fill').style.width = `${pct}%`;
    if (task) $('boot-task').textContent = task;
  },
};

/* ── scroll wiring ───────────────────────────────────────────────────────── */
function wireScroll() {
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((step) => {
    ScrollTrigger.create({
      trigger: step, start: 'top 58%', end: 'bottom 42%',
      onToggle: (self) => {
        if (!self.isActive) return;
        steps.forEach((s) => s.classList.toggle('on', s === step));
        showStage(+step.dataset.stage);
      },
    });
  });

  // the ablation runs the first time its scene is reached, not on a timer
  ScrollTrigger.create({
    trigger: '#ablation-scene', start: 'top 70%', once: true,
    onEnter: () => setTimeout(runAblation, 120),
  });
}

/* ── boot ────────────────────────────────────────────────────────────────── */
(async function start() {
  boot.set(4, 'reading the frame');
  drawPole().catch(() => {});

  const [dn, truth, meta] = await Promise.all([
    load12bit('data/scene_obs.png'),
    loadGray('data/scene_truth.png'),
    fetch('data/scene_meta.json').then((r) => r.json()).catch(() => null),
  ]);
  state.dn = dn;
  state.truth = E.normalise(truth);
  state.meta = meta;
  lab.source = dn;

  // the headline numbers come from the frame itself, never from a hard-coded string
  const st = E.stats(dn);
  $('k-range').textContent = `${Math.round(st.min)}–${Math.round(st.max)}`;
  $('k-snr').textContent = (st.mean / Math.max(st.std, 1e-6)).toFixed(1);
  let below = 0;
  for (let i = 0; i < dn.length; i++) if (dn[i] < 8) below++;
  $('k-dark').textContent = ((below / dn.length) * 100).toFixed(1);
  if (meta) {
    $('k-psrfrac').textContent = (meta.context.context_psr_frac * 100).toFixed(1);
    $('k-relief').textContent = meta.context.relief_km.toFixed(2);
  }

  boot.set(22, 'unpacking 12-bit values');
  heroPaint(0);
  drawRail(dn, 'thirteen distinct values, and that is the whole scene', true);
  paint($('vp-canvas'), dn, { lo: 0, hi: 4095 });

  wireFlight();
  wireCompare();
  wireScenes();
  wireScroll();
  await frame();
  await buildPipeline();
  $('vp-loading').classList.add('done');
  showStage(0);

  ['c-blur', 'c-noise', 'c-iters', 'c-clip'].forEach((id) =>
    $(id).addEventListener('input', scheduleLab));
  $('c-file').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) useOwnImage(e.target.files[0]);
  });
  $('c-reset').addEventListener('click', () => {
    lab.source = state.dn;
    lab.small = null;
    lab.hasTruth = true;
    $('lab-truth-cap').textContent = 'Target · never seen by the pipeline';
    $('lab-note').innerHTML =
      'Push blur past 2.5 px σ with a few DN of extra noise and watch SSIM collapse ' +
      'while the detection count <em>climbs</em>. Those are not recovered boulders — ' +
      'they are Richardson–Lucy amplifying noise into blocks, and the ensemble ' +
      'stability test is the only thing standing between that texture and a hazard map.';
    runLab();
  });
  showModelFacts();
  boot.set(96, 'ready');
  runLab();
  boot.set(100, 'ready');
  await new Promise((r) => setTimeout(r, REDUCED ? 0 : 380));
  document.body.classList.add('booted');
  dispatchEvent(new Event('scroll'));
})();
