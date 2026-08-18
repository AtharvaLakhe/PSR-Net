/* ── quality tiers ───────────────────────────────────────────────────────────
   Ultra is the intended experience and the default wherever the GPU can carry
   it: the budget is deliberately generous — a million-vertex displaced globe,
   a 32-step raymarched atmosphere, 8x MSAA, six-figure starfields.

   Two cases step down, and neither is a memory ceiling:

     · a software rasteriser (SwiftShader, llvmpipe, Mesa), where a 32-step
       raymarch is measured in seconds per frame, not milliseconds — this is
       also what the headless smoke test runs on;
     · phones, which run the same raymarch on a tile-based GPU with a fraction
       of the fill rate, and which the project has to keep usable at 360 px.

   `?quality=ultra|high|low` overrides the probe in both directions, so a
   machine that gets misread is one query parameter away from the tier it wants.
   ────────────────────────────────────────────────────────────────────────── */

export const TIERS = {
  ultra: {
    name: 'ultra',
    earthSegments: [1536, 768],
    cloudSegments: [512, 256],
    atmoSegments: [256, 128],
    atmoSteps: 32,
    lightSteps: 10,
    // Aerial perspective over the ground is a much smoother function than the
    // limb halo, so it converges in a third of the samples. Same integrator,
    // fewer steps — the chunk just compiles with different #defines.
    apSteps: 12,
    apLightSteps: 6,
    stars: [64000, 21000, 4600],
    msaa: 8,
    maxPixelRatio: 2,
    displacement: 0.0052,
    surfaceDetail: true,
    oceanWaves: true,
    milkyWay: true,
    cloudDepth: true,
    grain: 0.018,
  },
  high: {
    name: 'high',
    earthSegments: [640, 320],
    cloudSegments: [256, 128],
    atmoSegments: [128, 64],
    atmoSteps: 18,
    lightSteps: 6,
    apSteps: 8,
    apLightSteps: 4,
    stars: [24000, 8000, 1800],
    msaa: 4,
    maxPixelRatio: 2,
    displacement: 0.0042,
    surfaceDetail: true,
    oceanWaves: true,
    milkyWay: true,
    cloudDepth: true,
    grain: 0.014,
  },
  low: {
    name: 'low',
    earthSegments: [128, 64],
    cloudSegments: [96, 48],
    atmoSegments: [64, 32],
    // Not lower than this. Below roughly a dozen steps the midpoint rule
    // under-integrates the dense air near the surface badly enough that the
    // limb halo thins out to nothing, and a hard-edged planet looks broken
    // rather than economical. This is the floor at which it still reads right.
    atmoSteps: 12,
    lightSteps: 4,
    apSteps: 6,
    apLightSteps: 3,
    // points are close to free even on a tile-based GPU — the starfield is one
    // of the cheapest things on screen, so it does not need to be thinned much
    stars: [14000, 4600, 1000],
    msaa: 0,
    maxPixelRatio: 1.25,
    displacement: 0,
    surfaceDetail: false,
    oceanWaves: false,
    milkyWay: false,
    cloudDepth: false,
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
