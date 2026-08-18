/* ── Orbital ─────────────────────────────────────────────────────────────
   The Moon at centre of a deep starfield — surface modelled and baked in
   Blender — with the comms satellite in a tilted orbit. Hover the globe for
   live selenographic coordinates; click the satellite to target a feature by
   name or lat/lon.
   ──────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLACES, findPlaces, nearestPlace, describeLocation } from './places.js';
import { loadMareMask, isMare } from './maremask.js';
import { latLonToVec3 as latLonXYZ, vec3ToLatLon, parseQuery, fmtLat, fmtLon } from './geo.js';
import { NOISE_GLSL, SRGB_GLSL } from './shaders.js';
import { pickTier } from './quality.js';

const MOON_R = 1;
// Peak LOLA relief baked into assets/moon.glb, in moon radii. Anything drawn on
// the surface has to clear it or a rim will poke through the marker.
const RELIEF = 0.0102;
const ORBIT_R = MOON_R * 1.46;
const ORBIT_TILT = THREE.MathUtils.degToRad(28);
// The Moon's obliquity is 6.7° to its orbit — nothing like Earth's 23.4°, which
// is why the poles hold permanently shadowed floors.
const AXIAL_TILT = THREE.MathUtils.degToRad(6.7);
const SAT_SPAN = 0.26;            // largest dimension, same ratio as the blender scene
// It is tidally locked: one rotation per orbit, 27.3 days. Held well above real
// time so the terminator still visibly crawls in a demo.
const SPIN = 0.0062;              // radians/second
const ORBIT_RATE = 0.062;         // satellite radians/second — ~101 s per revolution
/* Solar irradiance at 1 AU, in the same E/PI units the surface term uses. */
const SUN_INTENSITY = 1.15 * Math.PI;
/* Well off the camera axis on purpose. A sun over your shoulder gives the full
   Moon we all know — flat, no shadows, the phase where a telescope shows least.
   Swung out to about 60 degrees, the same craters throw shadows a third of their
   width and the terminator crosses the disc, which is when the relief reads. */
const SUN_DIR = new THREE.Vector3(-0.78, 0.22, 0.59).normalize();
/* Where the sun is *now*. It moves: a target on the night side would otherwise
   be a black disc with a reticle on it, which is a fair picture of the Moon and
   a useless one for an observation terminal. See turnSunOnto(). */
const sunDir = SUN_DIR.clone();

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');

// Readers who ask for reduced motion get the target snapped into place instead of
// a long slew. (It also makes the headless smoke test converge in a few frames.)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SLEW_DUR = REDUCED ? 0.12 : 2.2;
const CAM_DUR = REDUCED ? 0.12 : 2.0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ── renderer / scene ───────────────────────────────────────────────────── */
const canvas = $('stage');
// antialias:false is not a downgrade: everything is composited through render
// targets, so the default framebuffer's MSAA never sees a single triangle. The
// real antialiasing is the multisampled composer target built below.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });

const Q = pickTier(renderer.getContext());
if (DEBUG) console.info(`[orbital] quality: ${Q.name} — ${Q.reason}`);

const PIXEL_RATIO = () => Math.min(devicePixelRatio, Q.maxPixelRatio);
renderer.setPixelRatio(PIXEL_RATIO());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 5000);
camera.position.set(0, 0.62, 3.05);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.42;
controls.zoomSpeed = 0.7;
controls.enablePan = false;
controls.minDistance = 1.35;
controls.maxDistance = 9;

scene.add(new THREE.AmbientLight(0x16202e, 1.0));

const sunLight = new THREE.DirectionalLight(0xfff4e6, 3.2);
sunLight.position.copy(SUN_DIR).multiplyScalar(60);
scene.add(sunLight);

/* Post: a high-threshold bloom so only genuinely bright things glow - the
   sunlit limb, the targeting beam - rather than hazing the whole lit disc.
   Rendering through a composer also means the passes work in linear space and
   OutputPass does tone mapping once, at the end. */
const composerTarget = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,        // the bloom threshold is above 1; LDR would clip it away
  samples: Q.msaa,                  // MSAA the geometry edges, chiefly the satellite's struts
  colorSpace: THREE.LinearSRGBColorSpace,
});
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.62,   // strength
  0.44,   // radius
  // Threshold is luminance in the linear HDR buffer, so it is meaningful above 1.
  // The sunlit highlands sit well under 1.0; anything lower blooms the whole lit
  // disc into a white haze. This keeps it to the sunlit limb and the beam.
  1.20,
);
composer.addPass(bloomPass);

/* Final grade. The vignette pulls the eye back to the planet, and the grain is
   there to dither the shadowed limb: a smooth gradient across a wide dark area is
   exactly where 8-bit output banding shows, and a fraction of a code value of
   noise costs nothing and hides it completely. Both are static under
   reduced-motion — a crawling grain field is the thing that rule exists for. */
const GradePass = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: Q.grain },
    uVignette: { value: 0.34 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * dot(d, d) * 1.6;
      float n = fract(sin(dot(vUv * 2048.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};
const gradePass = new ShaderPass(GradePass);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

/* ── loading ────────────────────────────────────────────────────────────── */
const manager = new THREE.LoadingManager();
const bar = document.querySelector('.loader-bar i');
manager.onProgress = (_u, loaded, total) => { bar.style.width = `${(loaded / total) * 92}%`; };
manager.onLoad = () => {
  bar.style.width = '100%';
  setTimeout(() => {
    $('loader').classList.add('done');
    document.body.classList.add('ready');
    setTimeout(() => $('loader').remove(), 800);
  }, 220);
};
manager.onError = (url) => console.error('[orbital] failed to load', url);

const texLoader = new THREE.TextureLoader(manager);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const tex = (file) => {
  const t = texLoader.load(`assets/${file}`);
  t.colorSpace = THREE.NoColorSpace;   // shaders below decode explicitly
  t.anisotropy = MAX_ANISO;            // the limb is all grazing angles
  t.wrapS = THREE.RepeatWrapping;      // seamless across the antimeridian
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
};

/* Both maps are the real Moon. Colour is the LROC Wide Angle Camera global
   mosaic; relief is the LOLA laser-altimeter DEM, turned into a tangent-space
   normal map — a normal map rather than a height map because 8-bit heights
   quantise into terraces once you differentiate them, and every slope on this
   surface is a difference of two heights. Both are NASA/GSFC public domain,
   from the CGI Moon Kit. */
const dayMap = tex('moon_day.jpg');
const normMap = tex('moon_norm.jpg');

/* The albedo map again, decoded to a CPU-readable bitset so the hover readout
   can tell mare from highland instead of inferring it. Deliberately outside
   `manager`: the globe does not need it to draw, and a readout that is briefly
   less specific is better than holding the loader open on it. */
loadMareMask('assets/moon_day.jpg');

/* ── starfield: three shells so parallax reads as real depth ────────────── */

/* Stars are not scattered uniformly across the real sky — most of them lie in a
   band, because we are looking through the disc of our own galaxy edge-on. An
   even sprinkle reads as a screensaver; concentrating most of the population
   toward one great circle, and painting the same circle on the nebula shell
   below, is what makes it read as a sky. */
const GALACTIC_N = new THREE.Vector3(0.34, 0.82, -0.46).normalize();
const GALACTIC_U = new THREE.Vector3(1, 0, 0).cross(GALACTIC_N).normalize();
const GALACTIC_V = new THREE.Vector3().crossVectors(GALACTIC_N, GALACTIC_U).normalize();

/* Box–Muller, used to pull stars toward the galactic plane */
function gaussian() {
  const u = Math.max(Math.random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function makeStarLayer({ count, near, far, size, brightness, clustered = 0.62 }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);
  const c = new THREE.Color();
  const dir = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // height above the galactic plane: a tight normal for the band population,
    // uniform for the halo population that fills the rest of the sky
    const inBand = Math.random() < clustered;
    const u = inBand
      ? clamp(gaussian() * 0.16, -1, 1)
      : Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(1 - u * u, 0));
    const r = near + Math.pow(Math.random(), 0.6) * (far - near);

    dir.copy(GALACTIC_U).multiplyScalar(s * Math.cos(th))
      .addScaledVector(GALACTIC_V, s * Math.sin(th))
      .addScaledVector(GALACTIC_N, u)
      .multiplyScalar(r);
    pos[i * 3] = dir.x; pos[i * 3 + 1] = dir.y; pos[i * 3 + 2] = dir.z;

    // mostly white, a few warm and a few blue giants
    const roll = Math.random();
    const hue = roll > 0.94 ? 0.07 : roll > 0.86 ? 0.58 : 0.6;
    const sat = roll > 0.86 ? 0.45 : 0.06;
    c.setHSL(hue, sat, brightness * (0.62 + Math.random() * 0.38));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;

    siz[i] = size * (0.45 + Math.pow(Math.random(), 2.2) * 1.5);
    pha[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      // gl_PointSize is in device pixels, so the scale has to carry the pixel
      // ratio or every star halves in apparent size on a retina display
      uScale: { value: (innerHeight * PIXEL_RATIO()) / 2 },
      uPR: { value: PIXEL_RATIO() },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime, uScale, uPR;
      varying vec3 vColor; varying float vTwinkle; varying float vBright;
      void main() {
        vColor = aColor;
        // two beat frequencies so the field never pulses in unison
        vTwinkle = 0.72 + 0.18 * sin(uTime * 1.4 + aPhase)
                        + 0.10 * sin(uTime * 3.1 + aPhase * 2.7);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // clamp or near-shell stars balloon into blobs a few dozen px across
        float px = clamp(aSize * uScale / max(-mv.z, 0.001), 0.7 * uPR, 4.2 * uPR);
        // brightest sprites earn the diffraction spikes below
        vBright = smoothstep(2.1 * uPR, 4.0 * uPR, px);
        gl_PointSize = px;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vTwinkle; varying float vBright;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float core = smoothstep(0.25, 0.0, r2);
        float halo = smoothstep(0.25, 0.02, r2) * 0.35;
        // a faint four-point flare on the brightest stars only — this is the
        // instrument's signature, not the star's, so it stays subtle
        float spike = vBright * 0.30
          * (smoothstep(0.035, 0.0, d.y * d.y) + smoothstep(0.035, 0.0, d.x * d.x))
          * smoothstep(0.25, 0.0, r2);
        gl_FragColor = vec4(vColor * vTwinkle, core + halo + spike);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  return new THREE.Points(geo, mat);
}

const starLayers = [
  makeStarLayer({ count: Q.stars[0], near: 420, far: 1400, size: 1.1, brightness: 0.5 }),
  makeStarLayer({ count: Q.stars[1], near: 170, far: 420, size: 1.0, brightness: 0.68 }),
  // the near shell is the one that parallaxes hardest, so keep it sparse and
  // mostly off the band or it reads as foreground dirt rather than depth
  makeStarLayer({ count: Q.stars[2], near: 55, far: 170, size: 0.9, brightness: 0.92, clustered: 0.3 }),
];
starLayers.forEach((l) => scene.add(l));

/* ── milky way ──────────────────────────────────────────────────────────────
   A far inverted shell painting the galactic band procedurally: a broad glow
   about the plane, fbm-modulated into cloud structure, then cut by a darker
   fbm for the dust lanes that split the band lengthwise. No texture, so it
   costs nothing to ship and stays sharp at any zoom. */
let milkyWay = null;
if (Q.milkyWay) {
  const mwMat = new THREE.ShaderMaterial({
    uniforms: { uNormal: { value: GALACTIC_N.clone() } },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uNormal;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 D = normalize(vDir);
        float h = dot(D, normalize(uNormal));          // sine of galactic latitude

        // the band itself: bright core, wide faint skirt
        float core = exp(-h * h * 190.0);
        float skirt = exp(-h * h * 26.0);

        // structure along the band, plus a lengthwise brightness gradient so one
        // side reads as the galactic centre
        float clumps = fbm(D * 5.5, 5);
        float fine = fbm(D * 17.0, 4);
        float centre = 0.55 + 0.45 * pow(max(fbm(D * 1.1, 2), 0.0), 0.7);

        // dust lanes: a second field subtracted, biased to the middle of the band
        float dust = smoothstep(0.42, 0.72, fbm(D * 8.0 + 41.0, 5));
        float lane = 1.0 - dust * exp(-h * h * 320.0) * 0.85;

        float density = (core * 0.85 + skirt * 0.20)
                      * (0.35 + 0.85 * clumps) * (0.6 + 0.6 * fine)
                      * centre * lane;

        // slightly warm in the dense core, cool in the outskirts
        vec3 warm = vec3(1.00, 0.90, 0.74);
        vec3 cool = vec3(0.62, 0.72, 1.00);
        vec3 col = mix(cool, warm, clamp(core * 1.2, 0.0, 1.0));

        gl_FragColor = vec4(col * density * 0.085, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  milkyWay = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), mwMat);
  milkyWay.renderOrder = -1;
  scene.add(milkyWay);
}

/* ── the sun ────────────────────────────────────────────────────────────────
   A small disc far out along SUN_DIR. It is off-screen from the opening camera
   and only swings into frame when you orbit round to the night side — which is
   the point: the glint, the terminator and the halo all resolve to a source you
   can actually find. Bloom does the rest. */
// 30 units across at 2600 out is ~0.66°, close to the real half-degree. Sitting
// beyond the outermost star shell keeps it behind the field rather than in it.
const sunSprite = new THREE.Mesh(
  new THREE.SphereGeometry(30, 32, 16),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vView;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vView;
      void main() {
        float f = max(dot(normalize(vN), normalize(vView)), 0.0);
        // hot flat disc with a fast falloff into a corona
        float disc = smoothstep(0.18, 0.55, f);
        float corona = pow(f, 1.6) * 0.45;
        vec3 col = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.98, 0.92), disc);
        gl_FragColor = vec4(col * (disc * 9.0 + corona), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sunSprite.position.copy(SUN_DIR).multiplyScalar(2600);
scene.add(sunSprite);

/* ── moon ───────────────────────────────────────────────────────────────── */
const moonGroup = new THREE.Group();
moonGroup.rotation.z = AXIAL_TILT;
scene.add(moonGroup);

const moonSpin = new THREE.Group();      // everything that turns with the surface
/* Open on the near side. Longitude 0 sits on +X in the texture layout, so a
   quarter turn puts the face Earth has always seen — Imbrium, Tranquillitatis,
   the Tycho rays — under the default camera instead of the crater-saturated
   far side. */
moonSpin.rotation.y = -Math.PI / 2;
moonGroup.add(moonSpin);

const moonMat = new THREE.ShaderMaterial({
  defines: {
    DETAIL: Q.surfaceDetail ? 1 : 0,
  },
  uniforms: {
    uDay: { value: dayMap },
    uNormal: { value: normMap },
    uSun: { value: SUN_DIR.clone() },
    uSunI: { value: SUN_INTENSITY },
    uBump: { value: 1.85 },
    /* The Moon is grey, but not neutral grey: the maria are titanium-rich and
       run blue, the highlands run tan, and the young ray craters are colder
       than either. The mosaic carries all of that at a few percent chroma —
       enough to be true, too little to see. This is the mineral-moon lift, the
       same move the LRO team make in their own release imagery. */
    uSaturation: { value: 1.8 },
    /* The bake writes a display-referred map — highlands near 0.8 sRGB — so the
       craters stay legible at a glance in the texture itself. Real regolith
       reflects about an eighth of what falls on it, and that gap is what makes
       an unscaled Moon render as a snowball. Scale it here rather than baking it
       in: the map keeps its contrast, the render gets the right exposure. */
    uAlbedo: { value: 0.44 },
    /* The mosaic's average is warm — red 0.343, green 0.329, blue 0.290 in
       linear — a property of the whole surface, not of any one rock.
       Dividing it out first means the saturation lift below opens the maria
       blue and the highlands tan away from a neutral centre, instead of
       dragging everything further into brown. */
    uBalance: { value: new THREE.Vector3(0.976, 1.0, 1.162) },
    // how close the camera is, 0 far / 1 hard in — drives the procedural detail
    // that stands in for texture resolution we do not have
    uCloseness: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
    varying vec3 vT; varying vec3 vB;
    void main() {
      vUv = uv;
      // The mesh carries its craters as real geometry, so the shading normal
      // has to come from the sphere direction rather than the interpolated
      // vertex normal — the two disagree on a displaced surface, and the
      // tangent frame below is only orthogonal against the sphere.
      vec3 nObj = normalize(position);

      // Build the tangent frame in object space, where the pole is always +Y.
      // Deriving it from world +Y instead would skew once the axial tilt is
      // applied. cross() degenerates on the poles themselves, so fall back to a
      // fixed axis for that one ring of vertices.
      vec3 up = abs(nObj.y) > 0.9995 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
      vec3 eastObj = normalize(cross(up, nObj));   // +u direction
      vec3 northObj = cross(nObj, eastObj);        // +v direction

      vN = normalize(mat3(modelMatrix) * nObj);
      vT = normalize(mat3(modelMatrix) * eastObj);
      vB = normalize(mat3(modelMatrix) * northObj);

      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uDay, uNormal;
    uniform vec3 uSun;
    uniform float uBump, uSunI, uCloseness, uTime, uAlbedo, uSaturation;
    uniform vec3 uBalance;
    varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
    varying vec3 vT; varying vec3 vB;
    #define PI 3.141592653589793
    ${SRGB_GLSL}
    ${NOISE_GLSL}

    void main() {
      vec3 N = normalize(vN);
      vec3 L = normalize(uSun);
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 Tn = normalize(vT), Bn = normalize(vB);
      mat3 TBN = mat3(Tn, Bn, N);

      vec3 albedo = decode(texture2D(uDay, vUv).rgb) * uBalance;
      albedo = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, uSaturation);
      albedo = max(albedo, vec3(0.0)) * uAlbedo;

      // ── relief ───────────────────────────────────────────────────────────
      // Tangent-space normals straight off the altimetry: x east, y north, z up,
      // the same frame the vertex stage builds. uBump only ever scales the two
      // lateral components, so flattening or exaggerating the terrain can never
      // produce a normal that is not a unit vector.
      vec3 nTex = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
      vec3 slope = vec3(nTex.xy * uBump, max(nTex.z, 0.02));

      #if DETAIL
        // The DEM is 4K, about 850 m per texel, so below a few hundred km the
        // relief map runs out of terrain before the eye does. This does not
        // invent craters — it adds the high-frequency roughness of regolith
        // under the real slopes. Three octaves from a low base, not four from a
        // high one: the top octave has to stay several pixels wide at the
        // closest the camera can get, or this stops being detail and becomes
        // sparkle.
        if (uCloseness > 0.005) {
          vec3 pw = normalize(vWorld) * 80.0;
          float e = 0.55;
          float n0 = fbm(pw, 3);
          float nx = fbm(pw + Tn * e, 3);
          float ny = fbm(pw + Bn * e, 3);
          float k = 1.6 * uCloseness;
          slope.xy += vec2(n0 - nx, n0 - ny) * k;
          albedo *= 1.0 + (n0 - 0.5) * 0.10 * uCloseness;
        }
      #endif

      vec3 Np = normalize(TBN * normalize(slope));

      float mu0 = dot(Np, L);           // shading uses the bumped normal
      float mu = max(dot(Np, V), 0.0);
      float geo = dot(N, L);            // the day/night split is a sphere fact

      // ── Lommel-Seeliger, which is why a full Moon looks like a disc ──────
      // Lambert would fall off as cos and paint a bright centre inside a dark
      // rim. Regolith does not do that: light scatters back out along the way
      // it came in, so the limb stays as bright as the middle right up to the
      // edge. Dividing by (mu0 + mu) is the whole trick — it cancels the cosine
      // the geometry keeps putting back.
      float m0 = max(mu0, 0.0);
      float ls = m0 / max(m0 + mu, 1e-3);

      // Opposition surge: shadows hide behind the grains that cast them when
      // the sun is at your back, so the full Moon is far brighter than twice
      // the half Moon. Narrow lobe, large amplitude — that is the real shape.
      float phase = max(dot(L, V), 0.0);
      float surge = 1.0 + 0.85 * pow(phase, 24.0);

      // A hard terminator, because there is no air to carry light past it. The
      // softening left is the sun's own half-degree disc — wide enough that the
      // relief does not alias into a staircase along the shadow line.
      float shadow = smoothstep(-0.05, 0.10, mu0) * smoothstep(-0.05, 0.09, geo);

      // uSunI is irradiance E; a surface radiance is E/PI times the scattering
      // law, the same convention the satellite's lighting uses. The 2.0 undoes
      // the 1/(mu0+mu) normalisation at the sub-solar point, so the disc centre
      // lands where Lambert would put it and the law only redistributes light
      // outward toward the limb.
      // sunlight is not pure white, and the balance above took the warmth out of
      // the ground, so put it back where it belongs — in the light
      const vec3 SUNLIGHT = vec3(1.0, 0.978, 0.945);
      vec3 sunlit = albedo * SUNLIGHT * (uSunI / PI) * 2.0 * ls * surge * shadow;

      // ── earthshine ───────────────────────────────────────────────────────
      // The night side is not black: it is lit by a half-lit Earth four times
      // the width of the Sun in that sky. Cool, dim, and it falls on the face
      // pointing away from the sun — the "old Moon in the new Moon's arms".
      float nightMask = smoothstep(0.12, -0.35, geo);
      // Earth is 40x brighter in that sky than a full Moon is in ours, which
      // still leaves the unlit side dimmer than the darkest mare in sunlight —
      // if it reads brighter than the seas, the number is wrong.
      vec3 earthshine = albedo * vec3(0.030, 0.041, 0.066) * nightMask;

      vec3 color = sunlit + earthshine;

      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

/* One place to move the sun, because four things read it: the shader, the key
   light the satellite is shaded by, the sprite you can actually see, and the
   solar-wing tracking. */
function setSun(v) {
  sunDir.copy(v).normalize();
  sunLight.position.copy(sunDir).multiplyScalar(60);
  sunSprite.position.copy(sunDir).multiplyScalar(2600);
  moonMat.uniforms.uSun.value.copy(sunDir);
}

/* The globe itself is the Blender model: a UV sphere carrying its crater field
   as baked displacement, so the limb breaks against the starfield instead of
   drawing a mathematically perfect circle. Until it lands there is a plain
   sphere in its place — same radius, same UVs, so nothing downstream can tell
   the difference and the scene never has a hole in it. */
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(MOON_R, Q.moonSegments[0], Q.moonSegments[1]),
  moonMat,
);
moonSpin.add(moon);

new GLTFLoader(manager).load('assets/moon.glb', (gltf) => {
  let geo = null;
  gltf.scene.traverse((o) => { if (!geo && o.isMesh) geo = o.geometry; });
  if (!geo) return;
  moon.geometry.dispose();
  moon.geometry = geo;
});

/* lat/lon -> world position (geo.js does the maths, three.js gets the vector) */
function latLonToVec3(lat, lon, radius = MOON_R) {
  const p = latLonXYZ(lat, lon, radius);
  return new THREE.Vector3(p.x, p.y, p.z);
}

/* ── satellite ──────────────────────────────────────────────────────────── */
const satAnchor = new THREE.Group();     // holds the craft at the orbit point
scene.add(satAnchor);

let satellite = null;
let wingAxle = null;

new GLTFLoader(manager).load('assets/satellite.glb', (gltf) => {
  const model = gltf.scene;

  // normalise: centre on origin and scale so the wingspan is SAT_SPAN
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  model.position.sub(centre);
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(SAT_SPAN / Math.max(size.x, size.y, size.z));

  // wings onto their own axle so they can rotate on the spar toward the sun
  wingAxle = new THREE.Group();
  model.add(wingAxle);
  model.children.filter((c) => /SolarWing/i.test(c.name)).forEach((w) => wingAxle.add(w));

  satellite = holder;
  satAnchor.add(holder);
});

/* Blender exports the craft y-up: the dish points +Z, the wing spar runs along X.
   Build the orientation from an explicit basis rather than eulers - dish onto the
   nadir, spar onto the orbit normal so the single-axis array never stalls. */
const _z = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();
function aimSatellite(position, orbitNormal) {
  _z.copy(position).negate().normalize();               // dish -> moon centre
  _x.copy(orbitNormal).normalize();
  _x.sub(_z.clone().multiplyScalar(_x.dot(_z))).normalize();   // orthogonalise
  _y.crossVectors(_z, _x).normalize();
  _basis.makeBasis(_x, _y, _z);
  satAnchor.position.copy(position);
  satAnchor.quaternion.setFromRotationMatrix(_basis);
}

/* ── target marker ──────────────────────────────────────────────────────────
   The marker group's local +Z is the outward surface normal (see goTo), so the
   ring lies flat in local XY and the mast rises along +Z.

   This was a stack of additive pieces — halo disc, ring, expanding ping, glowing
   tip sphere. Two things went wrong with that. Additively they summed past the
   1.20 bloom threshold, so the bloom pass turned the whole marker into a
   four-point starburst; and at a grazing angle near the limb every flat piece
   foreshortens into the same spot, concentrating all of it into one sparkle.
   The result read as a particle effect stuck on the planet.

   So: alpha-blended, not additive, which keeps it under the bloom threshold and
   crisp; and the designator itself is a billboard at fixed pixel size, so it is
   the same legible instrument whether the target faces you or sits on the limb. */
const MARK = 0xffb454;
// ~570 km. Tall enough that the HTML panel hanging off the tip clears the
// designator instead of sitting on top of it.
const MAST_H = 0.09;

const ringMat = new THREE.MeshBasicMaterial({
  color: MARK, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  depthWrite: false,
});
const mastMat = new THREE.MeshBasicMaterial({
  color: MARK, transparent: true, opacity: 0.38, side: THREE.DoubleSide,
  depthWrite: false,
});

const marker = new THREE.Group();
marker.visible = false;
moonSpin.add(marker);

// a thin footprint on the ground — this one *should* foreshorten, because it
// says "this is a patch of surface" and perspective is how you read that
const ring = new THREE.Mesh(new THREE.RingGeometry(0.0235, 0.0255, 72), ringMat);
ring.position.z = 0.001;
marker.add(ring);

/* The mast carries the label clear of the designator and gives the target a
   vertical to read against at a graze. Thin and dim on purpose: it is structure,
   not signal. */
const mastGeo = new THREE.CylinderGeometry(0.0008, 0.0008, MAST_H, 6, 1, true);
mastGeo.translate(0, MAST_H * 0.5, 0);
mastGeo.rotateX(Math.PI * 0.5);            // cylinder runs +Y; the normal is +Z
const mast = new THREE.Mesh(mastGeo, mastMat);
marker.add(mast);

/* ── target designator ──────────────────────────────────────────────────────
   Corner brackets and a centre dot on a camera-facing quad, held at a constant
   pixel size so it neither balloons on zoom-in nor shrinks to a speck at
   distance — the behaviour of an instrument overlay rather than a decal.

   Drawn in the shader instead of built from geometry: the arms stay one crisp
   antialiased width at every scale, and it is a single quad rather than eight
   slivers. It lives on the scene, not under the marker, so billboarding does
   not have to undo the Moon's rotation first. */
const DESIGNATOR_PX = 54;

const designatorMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(MARK) },
    uSpread: { value: 1 },      // >1 while acquiring, eases to 1 on lock
    uOpacity: { value: 0.92 },
  },
  transparent: true,
  depthWrite: false,
  depthTest: false,             // always on top; far-side hiding is done on the CPU
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor; uniform float uSpread, uOpacity;
    varying vec2 vUv;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 a = abs(p);
      float aa = fwidth(p.x) * 0.9;

      float s = 0.66 * uSpread;   // bracket half-extent
      float len = 0.30;           // arm length
      float th = 0.035;           // arm half-thickness

      // an arm is: near the bracket line in one axis, within the arm span in the
      // other. Both edges are smoothstepped so the ends do not crawl.
      float onY = 1.0 - smoothstep(th - aa, th + aa, abs(a.y - s));
      float inX = smoothstep(s - len - aa, s - len + aa, a.x)
                * (1.0 - smoothstep(s + th - aa, s + th + aa, a.x));

      float onX = 1.0 - smoothstep(th - aa, th + aa, abs(a.x - s));
      float inY = smoothstep(s - len - aa, s - len + aa, a.y)
                * (1.0 - smoothstep(s + th - aa, s + th + aa, a.y));

      float brackets = max(onY * inX, onX * inY);
      float dot = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, length(p));

      float m = max(brackets, dot);
      if (m < 0.004) discard;
      gl_FragColor = vec4(uColor, m * uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const designator = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), designatorMat);
designator.visible = false;
designator.renderOrder = 10;
scene.add(designator);

// when the current target was acquired, for the one-shot settle below
let acquiredAt = -1e9;

// where the HTML label pins itself
const labelAnchor = new THREE.Object3D();
labelAnchor.position.z = MAST_H;
marker.add(labelAnchor);

/* ── downlink beam ──────────────────────────────────────────────────────────
   Built spanning y 0→1 with the narrow end at the origin, so it can be placed
   at the craft and scaled by the distance to the target — no centre-point
   arithmetic, and the shader gets the position along the beam for free.

   Additive with a rim falloff makes it read as a volume of light: the walls
   brighten where they turn away from the eye, which is what a real shaft of
   lit air does, and the middle stays clear so the planet shows through it. */
const BEAM_R_CRAFT = 0.004;
const BEAM_R_GROUND = 0.030;
const beamGeo = new THREE.CylinderGeometry(BEAM_R_GROUND, BEAM_R_CRAFT, 1, 48, 1, true);
beamGeo.translate(0, 0.5, 0);

const beamMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(MARK) },
    uTime: { value: 0 },
    uGain: { value: 1.0 },
  },
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    varying float vT; varying vec3 vNv; varying vec3 vPv;
    void main() {
      vT = position.y;                       // 0 at the craft, 1 at the ground
      // normalMatrix is the inverse transpose, so the rim survives the heavy
      // non-uniform y scale this mesh gets stretched by every frame
      vNv = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vPv = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor; uniform float uTime, uGain;
    varying float vT; varying vec3 vNv; varying vec3 vPv;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vNv), normalize(-vPv))), 1.7);
      // Rim alone draws the two silhouette walls and nothing between them, which
      // reads as a wireframe cone rather than lit air. A base fill under the rim
      // gives the shaft body while the rim still defines its edges.
      float body = 0.30 + 0.70 * rim;

      // ease on at the dish and off before the footprint, so neither end
      // terminates in a hard cut disc
      float ends = smoothstep(0.0, 0.16, vT) * (1.0 - 0.45 * smoothstep(0.70, 1.0, vT));

      // energy travelling down the beam — direction of travel is the whole
      // reason this reads as a downlink and not a traffic cone
      float pulse = 0.78 + 0.22 * sin(vT * 24.0 - uTime * 3.2);

      float a = body * ends * pulse * uGain;
      gl_FragColor = vec4(uColor * a, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const beam = new THREE.Mesh(beamGeo, beamMat);
beam.visible = false;
scene.add(beam);

/* ── hover reticle on the globe ─────────────────────────────────────────── */
const reticle = new THREE.Group();
reticle.visible = false;
scene.add(reticle);
const retMat = new THREE.MeshBasicMaterial({
  color: 0x58b7ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
});
reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.018, 0.021, 40), retMat));
const retDot = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), retMat);
reticle.add(retDot);

/* ── interaction state ──────────────────────────────────────────────────── */
const state = {
  mode: 'orbit',            // orbit | slewing | holding
  orbitAngle: 0,
  slew: null,
  target: null,             // { lat, lon, name, localDir }
  camTween: null,
  sunTween: null,           // the sun turning to bring a night target into morning
  hoverLatLon: null,
  satHovered: false,
  satScreen: { x: 0, y: 0 },   // where the craft last projected to, in CSS px
  pointer: new THREE.Vector2(-10, -10),
  pointerActive: false,
  parallax: new THREE.Vector2(),
  dragging: false,
};

const raycaster = new THREE.Raycaster();

/* Hover picking goes against this, not against the globe mesh — see updatePointer. */
const MOON_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), MOON_R);
const _hitPoint = new THREE.Vector3();

function orbitPosition(angle) {
  const p = new THREE.Vector3(Math.cos(angle) * ORBIT_R, 0, -Math.sin(angle) * ORBIT_R);
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), ORBIT_TILT);
  return p;
}
const ORBIT_NORMAL = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), ORBIT_TILT);

/* ── picking the craft ──────────────────────────────────────────────────────
   This used to be an exact mesh raycast, which is why it so often refused to
   open. The craft is a dish and two thin panels spanning ~90 px at the default
   camera, and almost all of that box is empty space between the struts — so the
   cursor mostly passed straight through it. Worse, the wings turn edge-on as
   they track the sun, and an edge-on plane is a few pixels of target.

   Pick a disc around the projected anchor instead, sized from the craft's own
   bounds so it tracks zoom, with a floor so it stays reachable when small. The
   exact silhouette is not information the user has any way to see; the object's
   position is. */
const SAT_PICK_FLOOR_PX = 24;   // minimum radius, so a distant craft stays hittable
const _satProj = new THREE.Vector3();
const _occl = new THREE.Vector3();
const _toSat = new THREE.Vector3();

function satellitePick(clientX, clientY) {
  if (!satellite || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

  _toSat.copy(satAnchor.position).sub(camera.position);
  const dist = _toSat.length();
  _toSat.divideScalar(dist);

  // The craft orbits at 1.46 R, so it spends a good part of every revolution
  // genuinely behind the planet. The old raycast happily picked it through the
  // globe — intersectObject only ever tested the craft, never what was in front
  // of it — so the tooltip appeared over empty space beside the limb.
  const blocker = new THREE.Ray(camera.position, _toSat).intersectSphere(MOON_SPHERE, _occl);
  if (blocker && camera.position.distanceTo(_occl) < dist) return false;

  _satProj.copy(satAnchor.position).project(camera);
  if (_satProj.z > 1) return false;                       // behind the near plane

  const sx = (_satProj.x * 0.5 + 0.5) * innerWidth;
  const sy = (-_satProj.y * 0.5 + 0.5) * innerHeight;

  // half the craft's bounding span, projected to pixels at its own depth
  const halfPx = (SAT_SPAN * 0.5) / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))
    * (innerHeight * 0.5);
  const r = Math.max(halfPx * 1.2, SAT_PICK_FLOOR_PX);

  state.satScreen = { x: sx, y: sy };
  return (clientX - sx) ** 2 + (clientY - sy) ** 2 <= r * r;
}

/* ── pointer handling ───────────────────────────────────────────────────── */
canvas.addEventListener('pointermove', (e) => {
  state.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  state.pointerActive = true;
  state.clientX = e.clientX;
  state.clientY = e.clientY;
});
canvas.addEventListener('pointerleave', () => {
  state.pointerActive = false;
  state.satHovered = false;
  $('cursor-readout').hidden = true;
  $('sat-tip').hidden = true;
  reticle.visible = false;
});

let downX = null, downY = null;
canvas.addEventListener('pointerdown', (e) => {
  state.dragging = true;
  canvas.classList.add('grabbing');
  downX = e.clientX;
  downY = e.clientY;
});
addEventListener('pointerup', () => { state.dragging = false; canvas.classList.remove('grabbing'); });

canvas.addEventListener('click', (e) => {
  // A drag that happens to end over the craft is not a click on it. Without
  // this the wider hit disc would pop the console open every time an orbit
  // gesture finished near it.
  if (downX !== null && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

  // Re-pick at the click point rather than trusting the last frame's hover
  // flag. Touch never fires pointermove before the tap, so that flag is still
  // false on a phone — the craft was not tappable there at all.
  if (satellitePick(e.clientX, e.clientY)) openConsole();
});

/* ── console ────────────────────────────────────────────────────────────── */
const consoleEl = $('console');
const queryEl = $('query');

function openConsole() {
  consoleEl.hidden = false;
  consoleEl.setAttribute('aria-hidden', 'false');
  $('console-error').hidden = true;
  queryEl.value = '';
  renderSuggestions('');
  setTimeout(() => queryEl.focus(), 40);
}
function closeConsole() {
  consoleEl.hidden = true;
  consoleEl.setAttribute('aria-hidden', 'true');
}
$('console-close').addEventListener('click', closeConsole);
consoleEl.addEventListener('click', (e) => { if (e.target === consoleEl) closeConsole(); });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!consoleEl.hidden) closeConsole();
    else if (state.target) releaseTarget();
  }
});

/* A launcher, not the catalogue: the marquee sites, the two poles anyone is
   actually planning to land at, and enough far side to make the point that the
   craft can be tasked round the back. The tag is what kind of place it is, so
   the row reads without hovering. */
const QUICK = [
  ['Tranquility Base', 'A11'], ['Tycho', 'CRATER'], ['Copernicus', 'CRATER'],
  ['Mare Imbrium', 'MARE'], ['Oceanus Procellarum', 'MARE'], ['Plato', 'CRATER'],
  ['Aristarchus', 'CRATER'], ['Hadley-Apennine', 'A15'], ['Taurus-Littrow', 'A17'],
  ['Shackleton', 'POLE'], ['Shiv Shakti Point', 'CH-3'], ['Korolev', 'FAR'],
  ['Tsiolkovskiy', 'FAR'], ['Rupes Recta', 'SCARP'],
];
$('chips').innerHTML = QUICK.map(([name, code]) => `<button type="button" data-place="${name}">${name}<small>${code}</small></button>`).join('');
$('chips').addEventListener('click', (e) => {
  const button = e.target instanceof Element ? e.target.closest('button[data-place]') : null;
  if (button) { queryEl.value = button.dataset.place || ''; submit(); }
});

function renderSuggestions(q) {
  const list = $('suggestions');
  const hits = q.trim() ? findPlaces(q, 6) : [];
  list.innerHTML = hits.map((p) => {
    const i = p.name.toLowerCase().indexOf(q.trim().toLowerCase());
    const marked = i < 0 ? p.name
      : `${p.name.slice(0, i)}<em>${p.name.slice(i, i + q.trim().length)}</em>${p.name.slice(i + q.trim().length)}`;
    return `<li data-lat="${p.lat}" data-lon="${p.lon}" data-name="${p.name}">${marked}, ${p.region}<span>${fmtLat(p.lat)} ${fmtLon(p.lon)}</span></li>`;
  }).join('');
}
queryEl.addEventListener('input', () => renderSuggestions(queryEl.value));
$('suggestions').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  goTo(+li.dataset.lat, +li.dataset.lon, li.dataset.name);
  closeConsole();
  handOff(+li.dataset.lat, +li.dataset.lon, li.dataset.name);
});

$('console-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

function submit() {
  const raw = queryEl.value.trim();
  if (!raw) return;
  const parsed = parseQuery(raw);
  if (!parsed) {
    const err = $('console-error');
    err.textContent = `No match for "${raw}". Try a feature name, or coordinates like -43.3, -11.4`;
    err.hidden = false;
    return;
  }
  goTo(parsed.lat, parsed.lon, parsed.name);
  closeConsole();
  handOff(parsed.lat, parsed.lon, parsed.name);
}

/* ── handoff hook ──────────────────────────────────────────────
   The terminal answers *where*. A host application that wants to answer *what
   is there* can define `window.SPARC.open({ lat, lon, name })` before this
   module loads; it is called once the craft has finished its slew, so the two
   read as one movement rather than a page swap. With no host present the globe
   simply stays on target — the standalone behaviour. */
function handOff(lat, lon, name) {
  if (!window.SPARC?.open) return;
  const open = () => window.SPARC.open({ lat, lon, name });
  // Let the craft finish its slew first: watching it lock on is what explains
  // where the target came from.
  if (REDUCED) open();
  else setTimeout(open, (SLEW_DUR + 0.4) * 1000);
}

/* The panel announces which indicator is being read; the marker and beam take
   that indicator's colour so the globe and the numbers agree at a glance.
   Purely cosmetic and entirely optional — the panel never waits on this. */
const INDICATOR_COLOUR = {
  'surface-water': 0x4da3ff,   // water
  vegetation: 0x63d68a,        // green cover
  'built-up': 0xffb454,        // built surface
  lst: 0xff7a5c,               // surface heat
};
/* ── district choropleth ────────────────────────────────────────────────────
   The district's own boundary, laid on the surface and tinted by the indicator
   in focus.

   The tint is uniform on purpose. Each result is one zonal statistic for the
   whole polygon, so a varying raster inside it would render structure the data
   does not contain — and a viewer would read that texture as information. Flat
   fill is the faithful choice: shape says where, colour says which indicator,
   opacity says how much it moved.

   An approximate outline (a bounding box, for a district with no gated
   geometry) is drawn dashed and dimmer, so it cannot pass for a surveyed
   boundary. */
const districtGroup = new THREE.Group();
moonSpin.add(districtGroup);

function clearDistrict() {
  for (const child of districtGroup.children) {
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
  districtGroup.clear();
}

function drawDistrict({ rings, approximate, colour, intensity }) {
  clearDistrict();
  if (!rings?.length || !rings[0]?.length) return;

  const hex = colour ?? MARK;
  const lift = MOON_R + RELIEF + 0.0016;            // clear the crater rims

  // Triangulate in lon/lat, then lift every vertex onto the sphere. ShapeGeometry
  // does the earcut for us, holes included.
  const outer = rings[0];
  const shape = new THREE.Shape(outer.map(([lon, lat]) => new THREE.Vector2(lon, lat)));
  for (let i = 1; i < rings.length; i++) {
    shape.holes.push(new THREE.Path(rings[i].map(([lon, lat]) => new THREE.Vector2(lon, lat))));
  }

  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = latLonToVec3(pos.getY(i), pos.getX(i), lift);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();

  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: (intensity ?? 0.35) * (approximate ? 0.6 : 1),
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  districtGroup.add(fill);

  // Outline, lifted a little further so it is never z-fought by its own fill.
  const outlinePts = outer.map(([lon, lat]) => latLonToVec3(lat, lon, lift + 0.0012));
  const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
  const outlineMat = approximate
    ? new THREE.LineDashedMaterial({ color: hex, transparent: true, opacity: 0.75, dashSize: 0.012, gapSize: 0.01 })
    : new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.95 });
  const outline = new THREE.LineLoop(outlineGeo, outlineMat);
  if (approximate) outline.computeLineDistances();
  districtGroup.add(outline);
}

addEventListener('sparc:district', (e) => {
  const d = e.detail;
  if (!d || !d.rings) { clearDistrict(); return; }
  drawDistrict(d);
});

addEventListener('sparc:indicator', (e) => {
  const hex = INDICATOR_COLOUR[e.detail?.indicatorId] ?? MARK;
  [ringMat, mastMat].forEach((mat) => mat.color.setHex(hex));
  designatorMat.uniforms.uColor.value.setHex(hex);
  beamMat.uniforms.uColor.value.setHex(hex);
});

/* ── targeting ──────────────────────────────────────────────────────────── */
function goTo(lat, lon, name, { instant = false } = {}) {
  const localDir = latLonToVec3(lat, lon, 1).normalize();
  state.target = { lat, lon, name, localDir };

  // Clear the *displaced* surface, not the sphere. At 1.002 the ring sat below
  // the peaks — rims stand up to RELIEF above the datum — so high ground
  // near the target sliced the ring into a crescent.
  marker.position.copy(localDir).multiplyScalar(MOON_R + RELIEF + 0.0015);
  marker.lookAt(marker.position.clone().multiplyScalar(2));
  marker.visible = true;
  acquiredAt = performance.now();

  // satellite slews from wherever it is onto the point above the target
  const from = satAnchor.position.clone().normalize();
  const to = localDir.clone().applyQuaternion(worldSpinQuat());
  const camDir = to.clone();
  const dist = clamp(camera.position.length(), 1.9, 3.1);

  turnSunOnto(to, instant);

  if (instant) {
    // shared links arrive already on target rather than flying in from the default view
    aimSatellite(to.clone().multiplyScalar(ORBIT_R), ORBIT_NORMAL);
    camera.position.copy(camDir.multiplyScalar(dist));
    controls.update();
    state.slew = null;
    state.camTween = null;
    state.mode = 'holding';
  } else {
    state.slew = { from, to, t: 0, dur: SLEW_DUR };
    state.mode = 'slewing';
    state.camTween = { from: camera.position.clone(), to: camDir.multiplyScalar(dist), t: 0, dur: CAM_DUR };
  }

  $('target-name').textContent = name.toUpperCase();
  $('target-coords').textContent = `${fmtLat(lat)}  ${fmtLon(lon)}`;
  $('hint').innerHTML = 'Tracking target · <b>ESC</b> to resume free orbit';
}

function releaseTarget() {
  state.target = null;
  state.mode = 'orbit';
  state.slew = null;
  state.sunTween = null;
  marker.visible = false;
  beam.visible = false;
  designator.visible = false;
  $('target-label').hidden = true;
  $('hint').innerHTML = 'Drag to orbit · scroll to zoom · <b>click the satellite</b> to target a location';
}

/* quaternion taking surface-local directions into world space */
function worldSpinQuat() {
  moonSpin.updateWorldMatrix(true, false);
  return new THREE.Quaternion().setFromRotationMatrix(moonSpin.matrixWorld);
}

/* ── resize ─────────────────────────────────────────────────────────────── */
function onResize() {
  const pr = PIXEL_RATIO();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pr);
  starLayers.forEach((l) => {
    l.material.uniforms.uScale.value = (innerHeight * pr) / 2;
    l.material.uniforms.uPR.value = pr;
  });
}
addEventListener('resize', onResize);

/* ── frame loop ─────────────────────────────────────────────────────────── */
const timer = new THREE.Timer();
let fpsAcc = performance.now(), fpsFrames = 0;
const tmpV = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const AXIS = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), AXIAL_TILT);

/* Bring the sun round to light a target that is currently in shadow.

   A real orbiter does not carry a lamp: it waits for local morning, and over a
   lunar day the terminator sweeps the whole surface. That wait is what this
   compresses — the sun only ever rotates about the same axis the surface turns
   on, so every position it moves to is one the target genuinely passes through.

   Rotating a vector about AXIS traces a cone, so the reachable dot(sun, target)
   runs from A-B to A+B where A is the product of the two axial components and B
   the product of the perpendicular ones. Solve for the angle that lands on a
   low morning sun: high enough to light the ground, low enough that the relief
   still throws shadows worth looking at. */
const LIT_ENOUGH = 0.12;          // below this the target is in night or deep dusk
const MORNING = 0.62;             // cos of the sun angle we aim for, about 52 degrees

function sunAngleOnto(target) {
  const sa = sunDir.dot(AXIS), ta = target.dot(AXIS);
  const sPerp = sunDir.clone().addScaledVector(AXIS, -sa);
  const tPerp = target.clone().addScaledVector(AXIS, -ta);
  const A = sa * ta;
  const B = sPerp.length() * tPerp.length();
  if (B < 1e-4) return 0;                       // target on the axis: nothing to gain

  const want = clamp(MORNING, A - B + 1e-4, A + B - 1e-4);
  // current azimuth between the two perpendicular parts, signed about AXIS
  const cross = new THREE.Vector3().crossVectors(sPerp, tPerp);
  const phi = Math.atan2(cross.dot(AXIS) * -1, sPerp.dot(tPerp));
  const goal = Math.acos(clamp((want - A) / B, -1, 1));
  // two solutions, +goal and -goal; take whichever is the shorter turn
  const options = [goal - phi, -goal - phi].map((t) => ((t + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return Math.abs(options[0]) <= Math.abs(options[1]) ? options[0] : options[1];
}

function turnSunOnto(target, instant) {
  if (sunDir.dot(target) >= LIT_ENOUGH) return;   // already daylight there
  const angle = sunAngleOnto(target);
  if (Math.abs(angle) < 0.02) return;
  const to = sunDir.clone().applyAxisAngle(AXIS, angle);
  if (instant) { setSun(to); state.sunTween = null; return; }
  state.sunTween = { from: sunDir.clone(), axis: AXIS.clone(), angle, t: 0, dur: CAM_DUR * 1.15 };
}

function tick(timestamp) {
  requestAnimationFrame(tick);
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();

  /* surface */
  const spinDelta = SPIN * dt;
  moonSpin.rotation.y += spinDelta;
  moonMat.uniforms.uTime.value = t;

  /* Procedural regolith detail fades in as the camera closes, standing in for
     basemap resolution we do not have. Computed here rather than in the shader
     so the branch is uniform across the whole frame. */
  const closeness = 1 - clamp((camera.position.length() - 1.5) / 1.4, 0, 1);
  moonMat.uniforms.uCloseness.value = closeness;
  // grain is dithering, not an effect — it must not crawl for reduced-motion readers
  gradePass.uniforms.uTime.value = REDUCED ? 0 : t;

  /* while tracking, carry the camera round with the planet so the target stays framed */
  if (state.mode === 'holding' && !state.dragging) {
    camera.position.applyAxisAngle(AXIS, spinDelta);
  }

  /* satellite placement */
  if (state.mode === 'orbit') {
    state.orbitAngle += dt * ORBIT_RATE;
    aimSatellite(orbitPosition(state.orbitAngle), ORBIT_NORMAL);
  } else if (state.mode === 'slewing' && state.slew) {
    const s = state.slew;
    s.t = Math.min(1, s.t + dt / s.dur);
    const k = easeInOut(s.t);
    // slerp along the great circle, easing the altitude up and back down
    const dir = s.from.clone().lerp(s.to, k).normalize();
    const lift = 1 + Math.sin(Math.PI * s.t) * 0.16;
    aimSatellite(dir.multiplyScalar(ORBIT_R * lift), ORBIT_NORMAL);
    if (s.t >= 1) { state.mode = 'holding'; state.slew = null; }
  } else if (state.mode === 'holding' && state.target) {
    const dir = state.target.localDir.clone().applyQuaternion(worldSpinQuat());
    aimSatellite(dir.multiplyScalar(ORBIT_R), ORBIT_NORMAL);
  }

  /* wings track the sun about the spar */
  if (satellite && wingAxle) {
    satellite.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(satellite.matrixWorld).invert();
    const sunLocal = sunDir.clone().transformDirection(inv);
    wingAxle.rotation.x = Math.atan2(sunLocal.z, sunLocal.y);
  }

  /* sun tween after targeting, so the target is in daylight when we arrive */
  if (state.sunTween) {
    const s = state.sunTween;
    s.t = Math.min(1, s.t + dt / s.dur);
    setSun(s.from.clone().applyAxisAngle(s.axis, s.angle * easeInOut(s.t)));
    if (s.t >= 1) state.sunTween = null;
  }

  /* camera tween after targeting */
  if (state.camTween) {
    const c = state.camTween;
    c.t = Math.min(1, c.t + dt / c.dur);
    const k = easeInOut(c.t);
    camera.position.copy(c.from).lerp(c.to, k);
    // keep the radius steady instead of cutting through the chord
    camera.position.normalize().multiplyScalar(THREE.MathUtils.lerp(c.from.length(), c.to.length(), k));
    if (c.t >= 1) state.camTween = null;
  }

  /* beam from satellite down to the marker */
  if (state.target && (state.mode === 'holding' || state.mode === 'slewing')) {
    const a = satAnchor.position;
    marker.updateWorldMatrix(true, false);
    const b = new THREE.Vector3().setFromMatrixPosition(marker.matrixWorld);
    const len = a.distanceTo(b);
    // the geometry starts at its own origin, so it anchors at the craft and
    // stretches to the footprint — nothing to centre
    beam.position.copy(a);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(_UP, b.clone().sub(a).normalize());
    beam.visible = true;
    beamMat.uniforms.uTime.value = REDUCED ? 0 : t;

    /* Designator: parked on the ground point, facing the camera, held at a
       constant pixel size. Scaling by the world size that subtends
       DESIGNATOR_PX at this depth is what keeps it an instrument rather than
       something glued to the terrain. */
    const dist = camera.position.distanceTo(b);
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))) / innerHeight;
    designator.position.copy(b);
    designator.quaternion.copy(camera.quaternion);
    designator.scale.setScalar(DESIGNATOR_PX * worldPerPx);

    // One-shot settle on acquisition — the brackets close in and stop. A loop
    // here is what made the old marker read as a gimmick: continuous motion
    // with nothing to say keeps asking for attention it does not need.
    const since = (performance.now() - acquiredAt) / 1000;
    designatorMat.uniforms.uSpread.value = REDUCED
      ? 1
      : 1 + 0.85 * (1 - easeInOut(clamp(since / 0.55, 0, 1)));
  }

  /* pointer picking */
  updatePointer();

  /* subtle parallax: the whole starfield leans away from the cursor */
  const px = state.pointerActive && !state.dragging ? state.pointer.x : 0;
  const py = state.pointerActive && !state.dragging ? state.pointer.y : 0;
  state.parallax.x += (px * 0.028 - state.parallax.x) * 0.045;
  state.parallax.y += (py * 0.020 - state.parallax.y) * 0.045;
  starLayers.forEach((l, i) => {
    const depth = 1 - i * 0.28;
    l.rotation.y = state.parallax.x * depth;
    l.rotation.x = -state.parallax.y * depth;
    l.material.uniforms.uTime.value = t;
  });

  controls.update();
  composer.render();

  if (DEBUG) {
    let el = $('debug');
    if (!el) { el = document.createElement('pre'); el.id = 'debug'; document.body.appendChild(el); }
    el.textContent = JSON.stringify({
      mode: state.mode,
      t: +t.toFixed(2),
      cam: camera.position.toArray().map((v) => +v.toFixed(3)),
      camLen: +camera.position.length().toFixed(3),
      tween: state.camTween ? +state.camTween.t.toFixed(3) : null,
      tweenTo: state.camTween ? state.camTween.to.toArray().map((v) => +v.toFixed(3)) : null,
      sat: satAnchor.position.toArray().map((v) => +v.toFixed(3)),
      target: state.target ? { name: state.target.name, lat: +state.target.lat.toFixed(2) } : null,
    });
  }

  /* telemetry */
  // measured off wall time, not the clamped simulation dt
  const now = performance.now();
  fpsFrames++;
  if (now - fpsAcc >= 500) {
    $('tel-fps').textContent = Math.min(999, Math.round((fpsFrames * 1000) / (now - fpsAcc)));
    fpsAcc = now; fpsFrames = 0;
    const altKm = Math.round((camera.position.length() - MOON_R) * 1737);
    $('tel-alt').textContent = `${altKm.toLocaleString()} km`;
  }

  /* pinned target label */
  if (state.target && marker.visible) {
    marker.updateWorldMatrix(true, true);
    // hang off the top of the mast, not the ground point, so the panel sits at
    // the end of the pin rather than floating next to a ring
    tmpV.setFromMatrixPosition(labelAnchor.matrixWorld);
    const facing = tmpV.clone().normalize().dot(camera.position.clone().normalize());
    tmpV.project(camera);
    const label = $('target-label');
    // The designator draws with depthTest off so terrain never clips it, which
    // means the globe cannot hide it either — cull it here when the target has
    // rotated round the back, or it shows through the planet.
    const onNearSide = facing > 0.02 && tmpV.z < 1;
    designator.visible = onNearSide;
    if (onNearSide) {
      label.hidden = false;
      label.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`;
      label.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`;
    } else {
      label.hidden = true;
    }
  }
}

function updatePointer() {
  if (!state.pointerActive) return;
  raycaster.setFromCamera(state.pointer, camera);

  // satellite first: it sits in front of the globe. Same test the click uses,
  // so what lights up under the cursor is exactly what will open the console.
  const satHit = satellitePick(state.clientX, state.clientY);
  state.satHovered = satHit;
  const tip = $('sat-tip');
  if (satHit) {
    tip.hidden = false;
    // pin the label to the craft rather than the cursor — it names the object,
    // and anchored to the pointer it just slides around inside its own hit disc
    tip.style.left = `${state.satScreen.x}px`;
    tip.style.top = `${state.satScreen.y}px`;
    canvas.classList.add('targetable');
  } else {
    tip.hidden = true;
    canvas.classList.remove('targetable');
  }

  // Intersect the ideal sphere, not the mesh. At ultra the globe is 2.4M
  // triangles and three's mesh raycast is a linear scan over every one of them
  // — that is a hundred milliseconds of main thread per pointermove, on a path
  // that fires at input rate. The analytic solution is O(1) and strictly more
  // accurate anyway: it reports the true surface rather than the nearest facet,
  // so the readout no longer quantises as the tessellation coarsens.
  const hit = satHit ? null : raycaster.ray.intersectSphere(MOON_SPHERE, _hitPoint);
  const readout = $('cursor-readout');
  if (hit) {
    const local = moonSpin.worldToLocal(_hitPoint.clone());
    const { lat, lon } = vec3ToLatLon(local);
    state.hoverLatLon = { lat, lon };

    readout.hidden = false;
    readout.style.left = `${state.clientX}px`;
    readout.style.top = `${state.clientY}px`;
    $('cursor-coords').textContent = `${fmtLat(lat)}  ${fmtLon(lon)}`;
    $('cursor-place').textContent = describeLocation(lat, lon, isMare(lat, lon));
    $('tel-lat').textContent = fmtLat(lat);
    $('tel-lon').textContent = fmtLon(lon);

    reticle.visible = true;
    reticle.position.copy(_hitPoint);
    // the sphere is centred on the origin, so the surface normal is just the
    // hit direction — no face lookup and no matrix transform needed
    reticle.lookAt(_hitPoint.clone().multiplyScalar(2));
    canvas.classList.add('pointing');
  } else {
    readout.hidden = true;
    reticle.visible = false;
    canvas.classList.remove('pointing');
    if (!state.target) { $('tel-lat').textContent = '—'; $('tel-lon').textContent = '—'; }
  }
}

/* ── deep link: ?target=Tokyo  or  ?lat=35.68&lon=139.69 ────────────────── */
function applyDeepLink() {
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get('lat'));
  const lon = parseFloat(q.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const hit = parseQuery(`${lat}, ${lon}`);
    if (hit) goTo(hit.lat, hit.lon, hit.name, { instant: true });
    return;
  }
  const term = q.get('target');
  if (term) {
    const hit = parseQuery(term);
    if (hit) goTo(hit.lat, hit.lon, hit.name, { instant: true });
  }
}

/* ── boot ───────────────────────────────────────────────────────────────── */
onResize();
aimSatellite(orbitPosition(0), ORBIT_NORMAL);
tick();

const bootedAt = manager.onLoad;
manager.onLoad = () => { bootedAt(); applyDeepLink(); };

// expose a little surface for the smoke test
window.__orbital = {
  state, latLonToVec3, vec3ToLatLon, parseQuery, PLACES, THREE,
  describeLocation, isMare,
  scene, camera, controls, satAnchor, marker, beam, designator, goTo, releaseTarget,
  get satellite() { return satellite; },
};
