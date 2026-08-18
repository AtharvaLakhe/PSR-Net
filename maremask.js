/* Is this coordinate mare or highland?

   The readout must not answer that by inference — "no named feature within
   range, therefore highland" is wrong in both directions, and the readout is
   the one thing on the page claiming to know where the cursor is.

   So measure it instead, against the same albedo map the globe is wearing:
   the LROC mosaic, where a mare is dark because it is basalt, not because a
   gazetteer says so. The surface being drawn and the surface being described
   can never disagree.

   8192x4096 is ~1.3 km per pixel at the equator, finer than the gazetteer and
   finer than a hand can hold a cursor. Kept as one bit per pixel (1 MB) and
   decoded in horizontal strips, so the transient ImageData is 4 MB rather than
   the 32 MB a whole-image read would allocate. */

let mask = null;          // { w, h, bits } once decoded
let pending = null;

const STRIP = 256;        // rows per getImageData call
/* In the LROC mosaic the maria sit around 0.28 in sRGB and the highlands around
   0.60, so a threshold between the two populations separates them with room to
   spare — crater rims inside a sea stay mare, ejecta on a highland stays
   highland. Read off the red channel, which is where the basalts are darkest. */
const MARE = 112;

export function loadMareMask(url = 'assets/moon_day.jpg') {
  pending ??= decode(url).catch((err) => {
    // A tainted canvas (file://) or a missing asset is not fatal — isWater()
    // keeps returning null and the readout simply stops claiming water.
    console.warn('[orbital] mare mask unavailable, readout will omit terrain type', err);
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
        if (data[src + x * 4] < MARE) {
          const i = row + x;
          bits[i >> 3] |= 1 << (i & 7);
        }
      }
    }
  }

  mask = { w, h, bits };
  return mask;
}

/* true over mare, false over highland, null while the mask is still decoding —
   callers must treat null as "do not claim either", never as highland. */
export function isMare(lat, lon) {
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

export const mareMaskReady = () => mask !== null;
