/* ── GLSL chunks ─────────────────────────────────────────────────────────────
   Pure text, no three.js import — main.js pastes these into its materials.

   There is no atmosphere chunk here any more. The Moon has no air, and that is
   not a feature removed but the physics of the place: no halo at the limb, no
   aerial perspective softening distant ground, no colour on the terminator.
   Everything the surface looks like has to come out of the albedo, the relief
   and the scattering law in main.js.
   ────────────────────────────────────────────────────────────────────────── */

/* Value noise + fbm. Used to break up texel mush when the camera comes close,
   and to stand in for regolith roughness the basemap cannot resolve. Hash is the usual
   sin-fract one: cheap, adequate here, and it costs no texture bandwidth. */
export const NOISE_GLSL = /* glsl */`
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
          mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
          mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p, int octaves) {
    float a = 0.5, s = 0.0, n = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      s += a * vnoise(p);
      n += a;
      a *= 0.5;
      p *= 2.02;
    }
    return s / max(n, 1e-4);
  }
`;

export const SRGB_GLSL = /* glsl */`
  vec3 decode(vec3 c) { return pow(c, vec3(2.2)); }
`;
