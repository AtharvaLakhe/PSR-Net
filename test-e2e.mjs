/* End-to-end test driven over the Chrome DevTools Protocol.
   Exercises the real interaction path: hover the globe, hover and click the
   satellite, type a query, submit, confirm the target locks on.

   Usage:  node test-e2e.mjs [url]        (needs the static server running) */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:8123/';
const PORT = 9333;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) { console.error('No Chrome/Edge found'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome;
let profileDir;

let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 60000);
  });
}

/* evaluate an expression in the page and return its JSON value */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
}

async function mouse(type, x, y, button = 'none', clickCount = 0) {
  await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: 0 });
}

/* wait until `expr` evaluates truthy, or throw */
async function waitFor(label, expr, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error('devtools endpoint never came up');
}

const consoleErrors = [];

try {
  // Chrome 136+ ignores remote-debugging switches for the user's default
  // profile. An isolated profile both enables CDP and avoids test access to
  // personal browser data.
  profileDir = await mkdtemp(join(tmpdir(), 'sparc-orbital-e2e-'));
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--disable-background-networking', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    '--window-size=1200,800', 'about:blank',
  ], { stdio: 'ignore' });

  const wsUrl = await connect();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.exception?.description || 'exception');
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(m.params.entry.text);
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  console.log('\nload');
  await send('Page.navigate', { url: URL_BASE });
  await waitFor('scene boot', 'typeof window.__orbital === "object"');
  await waitFor('assets loaded', 'document.body.classList.contains("ready")');
  ok('page boots and finishes loading', true);
  ok('satellite model loaded', await evaluate('!!window.__orbital.state && !!document.querySelector("canvas")'));

  console.log('\ninitial state');
  ok('console starts hidden', await evaluate('document.getElementById("console").hidden'));
  ok('readout starts hidden', await evaluate('document.getElementById("cursor-readout").hidden'));
  ok('target label starts hidden', await evaluate('document.getElementById("target-label").hidden'));
  ok('mode is orbit', (await evaluate('window.__orbital.state.mode')) === 'orbit');

  console.log('\nhover the globe');
  await mouse('mouseMoved', 600, 400);
  await sleep(600);
  ok('coordinate readout appears', !(await evaluate('document.getElementById("cursor-readout").hidden')));
  const coords = await evaluate('document.getElementById("cursor-coords").textContent');
  ok('readout shows N/S + E/W', /[NS]/.test(coords) && /[EW]/.test(coords), `got "${coords}"`);
  ok('telemetry lat populated', /[NS]/.test(await evaluate('document.getElementById("tel-lat").textContent')));

  console.log('\nhover off the globe');
  await mouse('mouseMoved', 40, 760);
  await sleep(500);
  ok('readout hides off-globe', await evaluate('document.getElementById("cursor-readout").hidden'));

  console.log('\nhover + click the satellite');
  // Reload onto a deep link so the craft is holding station between the camera and
  // the globe. In free orbit it moves every frame and the pick would be a race.
  await send('Page.navigate', { url: `${URL_BASE}?target=Tokyo` });
  await waitFor('scene reboot', 'typeof window.__orbital === "object" && document.body.classList.contains("ready")');
  await waitFor('holding station', 'window.__orbital.state.mode === "holding"');
  ok('deep link puts the craft on station', true);

  const screen = await evaluate(`(() => {
    const { THREE, camera, satAnchor } = window.__orbital;
    if (!window.__orbital.satellite) return null;
    const v = new THREE.Vector3().setFromMatrixPosition(satAnchor.matrixWorld).project(camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
  })()`);
  ok('satellite projects to screen', !!screen && screen.z < 1, JSON.stringify(screen));

  if (screen && screen.z < 1) {
    await mouse('mouseMoved', Math.round(screen.x), Math.round(screen.y));
    await sleep(700);
    ok('satellite tooltip shows', !(await evaluate('document.getElementById("sat-tip").hidden')));
    ok('cursor turns targetable', await evaluate('document.getElementById("stage").classList.contains("targetable")'));

    await mouse('mousePressed', Math.round(screen.x), Math.round(screen.y), 'left', 1);
    await mouse('mouseReleased', Math.round(screen.x), Math.round(screen.y), 'left', 1);
    await sleep(500);
    ok('clicking the satellite opens the console', !(await evaluate('document.getElementById("console").hidden')));
  }

  console.log('\ntype a query');
  await evaluate(`(() => {
    const q = document.getElementById('query');
    q.value = 'Toky';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const sugg = await evaluate('document.querySelectorAll("#suggestions li").length');
  ok('suggestions render', sugg > 0, `count=${sugg}`);
  ok('first suggestion is Tokyo',
    (await evaluate('document.querySelector("#suggestions li")?.textContent || ""')).includes('Tokyo'));

  console.log('\nsubmit the target');
  await evaluate(`(() => {
    const q = document.getElementById('query');
    q.value = 'Tokyo';
    document.getElementById('console-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await sleep(400);
  ok('console closes on submit', await evaluate('document.getElementById("console").hidden'));
  ok('target recorded', (await evaluate('window.__orbital.state.target?.name')) === 'Tokyo');
  ok('label shows the name', (await evaluate('document.getElementById("target-name").textContent')) === 'TOKYO');
  ok('label shows coordinates',
    /35\.\d+°N/.test(await evaluate('document.getElementById("target-coords").textContent')));
  ok('enters slew or hold',
    ['slewing', 'holding'].includes(await evaluate('window.__orbital.state.mode')));
  ok('marker sits on the target',
    await evaluate(`(() => {
      const { THREE, state, vec3ToLatLon } = window.__orbital;
      const d = state.target.localDir;
      const ll = vec3ToLatLon({ x: d.x, y: d.y, z: d.z });
      return Math.abs(ll.lat - 35.6762) < 0.01 && Math.abs(ll.lon - 139.6503) < 0.01;
    })()`));

  console.log('\nreject a bad query');
  await evaluate(`(() => {
    document.getElementById('query').value = 'Zzzqqqxx';
    document.getElementById('console-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await sleep(300);
  ok('bad query surfaces an error', !(await evaluate('document.getElementById("console-error").hidden')));

  console.log('\nescape releases the target');
  await evaluate(`(() => {
    document.getElementById('console').hidden = true;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  })()`);
  await sleep(400);
  ok('target cleared', (await evaluate('window.__orbital.state.target')) === null);
  ok('back to orbit mode', (await evaluate('window.__orbital.state.mode')) === 'orbit');

  console.log('\nresize to a narrow viewport');
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  ok('canvas follows the viewport',
    await evaluate('Math.abs(document.getElementById("stage").clientWidth - 640) <= 2'),
    await evaluate('document.getElementById("stage").clientWidth'));
  ok('renderer survives resize', (await evaluate('window.__orbital.state.mode')) === 'orbit');
} catch (err) {
  fail++;
  console.log(`\n  FATAL  ${err.message}`);
} finally {
  try { ws?.close(); } catch {}
  chrome?.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

if (consoleErrors.length) {
  fail += consoleErrors.length;
  console.log('\npage errors:');
  consoleErrors.forEach((e) => console.log(`  ${String(e).split('\n')[0]}`));
} else {
  pass++;
  console.log('\n  ok    no console errors or uncaught exceptions');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
