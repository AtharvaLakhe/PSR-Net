/* ── GLSL chunks ─────────────────────────────────────────────────────────────
   Pure text, no three.js import — main.js pastes these into its materials.

   The atmosphere is single-scattering Rayleigh + Mie with an ozone absorption
   layer, raymarched. The same function serves two callers:

     · the atmosphere shell, integrating along a ray that misses the planet,
       which draws the limb halo and the sunset band;
     · the earth surface, integrating from the camera down to the fragment,
       which is aerial perspective — the blue wash over distant ground that is
       the single strongest cue in the Google Earth look.

   Sharing one integrator is what keeps the halo and the ground haze consistent;
   two separately tuned approximations always disagree somewhere on the limb.
   ────────────────────────────────────────────────────────────────────────── */

/* Geometry is in planet radii: 1.0 is sea level, so 1 unit = 6371 km.

   The atmosphere is deliberately not to scale. A true 100 km shell is 1.0157
   radii and reads as a hairline at these camera distances, so the shell and both
   scale heights are stretched ~3.3x. Optical depth is held to the real value by
   dividing the scattering coefficients by the same factor: beta * H is what the
   integral actually sees, and BETA_R.b * H_R = 0.265 still matches Earth's
   vertical Rayleigh depth at 440 nm. The halo gets thicker; it does not get
   wrongly brighter. */
export const ATMOSPHERE_GLSL = /* glsl */`
  #define PI 3.141592653589793

  const float R_GROUND = 1.0;
  const float R_TOP    = 1.035;
  const float H_RAY    = 0.0042;
  const float H_MIE    = 0.0011;

  // beta values divided by the stretch factor so beta*H stays physical
  const vec3  BETA_RAY = vec3(11.05, 25.83, 63.05);
  const float BETA_MIE = 22.9;
  const float MIE_G    = 0.76;

  // Ozone. Without it the terminator goes muddy brown; ozone absorbs the
  // yellow-red that survives the long path and leaves the deep blue twilight
  // wedge you actually see from orbit.
  const vec3  BETA_OZO = vec3(2.10, 1.88, 0.16);
  const float OZO_MID  = 0.0041;   // ~25 km, stretched to match H_RAY
  const float OZO_WID  = 0.0025;

  /* entry/exit of a ray against a sphere at the origin; x > y means a miss */
  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1.0, -1.0);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  float phaseRay(float mu) { return (3.0 / (16.0 * PI)) * (1.0 + mu * mu); }

  float phaseMie(float mu) {
    float gg = MIE_G * MIE_G;
    return (3.0 / (8.0 * PI)) * ((1.0 - gg) * (1.0 + mu * mu))
         / ((2.0 + gg) * pow(max(1.0 + gg - 2.0 * MIE_G * mu, 1e-4), 1.5));
  }

  /* Ozone is a band, not an exponential — a tent around 25 km is close enough
     and far cheaper than a real profile lookup. */
  float ozoneDensity(float h) {
    return max(0.0, 1.0 - abs(h - OZO_MID) / OZO_WID);
  }

  /* Optical depth from p toward the sun. Returns false when the planet itself
     blocks the sun, which is what carves the hard shadow out of the halo on the
     night side instead of letting it wrap all the way round. */
  bool sunOpticalDepth(vec3 p, vec3 L, out float odRay, out float odMie, out float odOzo) {
    odRay = 0.0; odMie = 0.0; odOzo = 0.0;

    vec2 ground = raySphere(p, L, R_GROUND);
    if (ground.x <= ground.y && ground.y > 0.0) return false;

    vec2 top = raySphere(p, L, R_TOP);
    if (top.x > top.y) return false;
    float seg = max(top.y, 0.0) / float(LIGHT_STEPS);

    for (int i = 0; i < LIGHT_STEPS; i++) {
      vec3 s = p + L * (seg * (float(i) + 0.5));
      float h = length(s) - R_GROUND;
      if (h < 0.0) return false;
      odRay += exp(-h / H_RAY) * seg;
      odMie += exp(-h / H_MIE) * seg;
      odOzo += ozoneDensity(h) * seg;
    }
    return true;
  }

  /* In-scattered light gathered between tNear and tFar, plus the transmittance
     that reaches tFar. Callers composite as  surface * transmittance + inscatter. */
  void scatter(
    vec3 ro, vec3 rd, float tNear, float tFar, vec3 L, float sunI,
    out vec3 inscatter, out vec3 transmittance
  ) {
    float seg = max(tFar - tNear, 0.0) / float(ATMO_STEPS);
    float odRay = 0.0, odMie = 0.0, odOzo = 0.0;
    vec3 sumRay = vec3(0.0), sumMie = vec3(0.0);

    for (int i = 0; i < ATMO_STEPS; i++) {
      vec3 p = ro + rd * (tNear + seg * (float(i) + 0.5));
      float h = max(length(p) - R_GROUND, 0.0);

      float dRay = exp(-h / H_RAY) * seg;
      float dMie = exp(-h / H_MIE) * seg;
      odRay += dRay;
      odMie += dMie;
      odOzo += ozoneDensity(h) * seg;

      float lRay, lMie, lOzo;
      if (sunOpticalDepth(p, L, lRay, lMie, lOzo)) {
        // 1.1x on Mie extinction is the usual stand-in for aerosol absorption
        vec3 tau = BETA_RAY * (odRay + lRay)
                 + BETA_MIE * 1.1 * (odMie + lMie)
                 + BETA_OZO * (odOzo + lOzo);
        vec3 att = exp(-tau);
        sumRay += dRay * att;
        sumMie += dMie * att;
      }
    }

    float mu = dot(rd, L);
    inscatter = (sumRay * BETA_RAY * phaseRay(mu)
               + sumMie * BETA_MIE * phaseMie(mu)) * sunI;
    transmittance = exp(-(BETA_RAY * odRay + BETA_MIE * 1.1 * odMie + BETA_OZO * odOzo));
  }
`;

/* Value noise + fbm. Used to break up texel mush when the camera comes close,
   and to give the ocean a glint that isn't a perfect mirror. Hash is the usual
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
