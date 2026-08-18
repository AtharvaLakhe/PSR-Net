/* ── quality tiers ───────────────────────────────────────────────────────────
   Ultra is the intended experience and the default wherever the GPU can carry
   it: 8x MSAA, six-figure starfields, and procedural regolith detail layered
   under the baked relief as the camera closes.

   Two cases step down, and neither is a memory ceiling:

     · a software rasteriser (SwiftShader, llvmpipe, Mesa), where per-pixel fbm
       is measured in seconds per frame, not milliseconds — this is also what
       the headless smoke test runs on;
     · phones, which run the same shader on a tile-based GPU with a fraction of
       the fill rate, and which the project has to keep usable at 360 px.

   The globe's own tessellation is not a dial any more: it arrives as a Blender
   mesh with the craters displaced into the geometry. `moonSegments` only sizes
   the placeholder sphere that stands in until the model loads.

   `?quality=ultra|high|low` overrides the probe in both directions, so a
   machine that gets misread is one query parameter away from the tier it wants.
   ────────────────────────────────────────────────────────────────────────── */

export const TIERS = {
  ultra: {
    name: 'ultra',
    moonSegments: [256, 128],
    stars: [64000, 21000, 4600],
    msaa: 8,
    maxPixelRatio: 2,
    surfaceDetail: true,
    milkyWay: true,
    grain: 0.018,
  },
  high: {
    name: 'high',
    moonSegments: [192, 96],
    stars: [24000, 8000, 1800],
    msaa: 4,
    maxPixelRatio: 2,
    surfaceDetail: true,
    milkyWay: true,
    grain: 0.014,
  },
  low: {
    name: 'low',
    moonSegments: [128, 64],
    // points are close to free even on a tile-based GPU — the starfield is one
    // of the cheapest things on screen, so it does not need to be thinned much
    stars: [14000, 4600, 1000],
    msaa: 0,
    maxPixelRatio: 1.25,
    surfaceDetail: false,
    milkyWay: false,
    grain: 0,
  },
};

/* Software rasterisers all announce themselves in the unmasked renderer string.
   The extension is absent or masked on some browsers, in which case this is
   simply inconclusive and the other heuristics decide. */
function rendererString(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return String(gl.getParameter(gl.RENDERER) || '');
  } catch {
    return '';
  }
}

export function pickTier(gl) {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && TIERS[forced]) return { ...TIERS[forced], forced: true, reason: 'url' };

  const gpu = rendererString(gl);
  if (/swiftshader|llvmpipe|software|basic render|mesa offscreen/i.test(gpu)) {
    return { ...TIERS.low, forced: false, reason: `software renderer (${gpu})` };
  }

  // Phones and tablets: no hover-capable pointer. Combined with a small core
  // count this is the reliable signal — screen size alone catches laptops.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;

  if (coarse && (cores <= 6 || mem <= 4)) {
    return { ...TIERS.low, forced: false, reason: 'mobile-class device' };
  }
  if (coarse || cores <= 4 || mem <= 4) {
    return { ...TIERS.high, forced: false, reason: 'modest device' };
  }
  return { ...TIERS.ultra, forced: false, reason: 'desktop gpu' };
}
