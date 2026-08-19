/* Copy the handful of runtime files the pages import out of node_modules and
   into vendor/, which is what actually gets served.

   The pages used to import straight from /node_modules/…, which works on a dev
   box and 404s on every host on earth, because node_modules is not deployed.
   Copying at build time means one path in the import map that is correct
   everywhere: locally, and on Vercel where `npm install` has run but node_modules
   is not part of the output.

   Only what is imported gets copied. onnxruntime-web alone is 133 MB in
   node_modules, of which this page needs one bundle and one .wasm.
*/
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'vendor');

/* [from, to] — directories are copied whole, files individually */
/* Whole directories, not a hand-picked file list. The first attempt copied
   three.module.js alone and the page 404'd on three.core.js, which it imports —
   and every library here reaches into its own siblings that way. Guessing at the
   closure of an import graph is a bug waiting for the deploy; copying the
   directory is a few megabytes and cannot be wrong. */
const ITEMS = [
  ['three/build', 'three/build'],
  ['three/examples/jsm', 'three/examples/jsm'],
  ['gsap', 'gsap'],

  /* The WebAssembly build, not the WebGPU one. The WebGPU bundle picks its wasm
     variant from what the browser supports — asyncify, jsep, jspi or plain — so
     shipping it means shipping all four binaries, 78 MB, to save 300 ms on a
     model this small (2175 ms against 2479 ms, measured). One variant, 13 MB. */
  ['onnxruntime-web/dist/ort.wasm.bundle.min.mjs', 'ort/ort.wasm.bundle.min.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
];

async function main() {
  if (!existsSync(NM)) {
    console.error('vendor: node_modules is missing — run npm install first');
    process.exit(1);
  }
  await rm(OUT, { recursive: true, force: true });

  let bytes = 0;
  for (const [from, to] of ITEMS) {
    const src = path.join(NM, from);
    const dst = path.join(OUT, to);
    if (!existsSync(src)) {
      console.error(`vendor: missing ${from} — the page will 404 on it`);
      process.exit(1);
    }
    await mkdir(path.dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: true });
    const s = await stat(src);
    bytes += s.isDirectory() ? 0 : s.size;
  }

  console.log(`vendor: ${ITEMS.length} entries -> vendor/  (~${Math.round(bytes / 1e6)} MB of files, plus the three addons tree)`);
}

main();
