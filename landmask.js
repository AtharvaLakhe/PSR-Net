/* Is this coordinate land or water?

   The hover readout used to answer that by inference — "no city within range,
   therefore open water" — which is wrong in both directions. It called the
   middle of Siberia open water, and it called 400 km of the Bay of Bengal
   Kolkata. Neither is a labelling nicety: the readout is the one thing on the
   page claiming to know where the cursor is.

   So measure it instead. assets/earth_ocean.jpg is already loaded for the
   globe — the vertex shader displaces against it, `1.0 - ocean.r` being land —
   so the mask the surface is built from is the mask the readout reads. Nothing
   new ships and the two can never disagree.

   4096x2048 is ~10 km per pixel at the equator, which is finer than the
   gazetteer and finer than a hand can hold a cursor. Kept as one bit per
   pixel (1 MB) and decoded in horizontal strips, so the transient ImageData
   is 4 MB rather than the 32 MB a whole-image read would allocate. */

let mask = null;          // { w, h, bits } once decoded
let pending = null;

const STRIP = 256;        // rows per getImageData call
const WATER = 128;        // mask is near-binary; anything above mid is sea

export function loadLandMask(url = 'assets/earth_ocean.jpg') {
  pending ??= decode(url).catch((err) => {
    // A tainted canvas (file://) or a missing asset is not fatal — isWater()
    // keeps returning null and the readout simply stops claiming water.
    console.warn('[orbital] land mask unavailable, readout will omit sea/land', err);
    return null;
  });
  return pending;
}

async function decode(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('mask has no dimensions');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = Math.min(STRIP, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const bits = new Uint8Array(Math.ceil((w * h) / 8));

  for (let y0 = 0; y0 < h; y0 += STRIP) {
    const rows = Math.min(STRIP, h - y0);
    ctx.clearRect(0, 0, w, rows);
    ctx.drawImage(img, 0, y0, w, rows, 0, 0, w, rows);
    const { data } = ctx.getImageData(0, 0, w, rows);
    for (let y = 0; y < rows; y++) {
      const row = (y0 + y) * w;
      const src = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[src + x * 4] >= WATER) {
          const i = row + x;
          bits[i >> 3] |= 1 << (i & 7);
        }
      }
    }
  }

  mask = { w, h, bits };
  return mask;
}

/* true over sea, false over land, null while the mask is still decoding —
   callers must treat null as "do not claim either", never as land. */
export function isWater(lat, lon) {
  if (!mask) return null;
  const { w, h, bits } = mask;

  // Same equirectangular layout as geo.js latLonToVec3: u wraps east from the
  // antimeridian, and the image has north at row 0 because three.js flips Y.
  let u = ((lon + 180) / 360) % 1;
  if (u < 0) u += 1;
  const x = Math.min(w - 1, Math.floor(u * w));
  const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));

  const i = y * w + x;
  return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
}

export const landMaskReady = () => mask !== null;
