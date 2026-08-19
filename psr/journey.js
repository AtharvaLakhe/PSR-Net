/* ── the flight ───────────────────────────────────────────────────────────────
   One continuous scroll from a full Moon down to a single frame of a crater
   floor: approach, the shadowed regions igniting, the orbiter arriving, a target
   chosen, the descent, the rover, and the picture it takes. Every position on
   that path is a function of scroll — nothing is on a timer, so the reader owns
   the pace and can run it backwards.

   Two sets live in one scene, 400 units apart: the orbital set at the origin and
   the surface set below it. Trying to fly a camera continuously from a 1-unit
   sphere down to a 2-metre rover costs you all your depth precision; separating
   the sets and cutting between them under the flash of the beam does not.
   ────────────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const SURFACE_Y = -400;                 // where the second set lives
const SUN = new THREE.Vector3(-0.78, 0.22, 0.59).normalize();
const MARK = 0xffb454;
const CRYO = 0x7c86ff;

export function createJourney(canvas, { onFrameCaptured } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.01, 4000);

  /* ── starfield ─────────────────────────────────────────────────────────── */
  const starGeo = new THREE.BufferGeometry();
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const siz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(300 + Math.random() * 900);
    pos.set([v.x, v.y, v.z], i * 3);
    siz[i] = 0.6 + Math.pow(Math.random(), 3) * 3.2;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `
      attribute float aSize; uniform float uPR; varying float vS;
      void main() {
        vS = aSize;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * 90.0 / max(-mv.z, 1.0), 0.7, 3.4) * uPR;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vS;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        gl_FragColor = vec4(vec3(0.85, 0.87, 0.95), smoothstep(0.25, 0.0, r2) * 0.9);
      }`,
  }));
  scene.add(stars);

  /* ── the Moon ──────────────────────────────────────────────────────────── */
  const loader = new THREE.TextureLoader();
  const tex = (f) => {
    const t = loader.load(`../assets/${f}`);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };

  const moonMat = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: tex('moon_day.jpg') },
      uNormal: { value: tex('moon_norm.jpg') },
      uSun: { value: SUN.clone() },
      uBump: { value: 1.85 },
      uAlbedo: { value: 0.44 },
      uSaturation: { value: 1.8 },
      uBalance: { value: new THREE.Vector3(0.976, 1.0, 1.162) },
      /* how far the permanently shadowed regions have lit up, 0..1 */
      uPsr: { value: 0 },
      uFill: { value: 0 },
      uPsrColor: { value: new THREE.Color(CRYO) },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vT; varying vec3 vB;
      void main() {
        vUv = uv;
        vec3 n = normalize(position);
        vec3 up = abs(n.y) > 0.9995 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 east = normalize(cross(up, n));
        vN = normalize(mat3(modelMatrix) * n);
        vT = normalize(mat3(modelMatrix) * east);
        vB = normalize(mat3(modelMatrix) * cross(n, east));
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      #define PI 3.141592653589793
      uniform sampler2D uDay, uNormal;
      uniform vec3 uSun, uBalance, uPsrColor;
      uniform float uBump, uAlbedo, uSaturation, uPsr, uFill;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vT; varying vec3 vB;
      vec3 decode(vec3 c) { return pow(c, vec3(2.2)); }

      void main() {
        vec3 N = normalize(vN), L = normalize(uSun), V = normalize(cameraPosition - vW);
        mat3 TBN = mat3(normalize(vT), normalize(vB), N);

        vec3 albedo = decode(texture2D(uDay, vUv).rgb) * uBalance;
        albedo = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, uSaturation);
        albedo = max(albedo, vec3(0.0)) * uAlbedo;

        vec3 nTex = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        vec3 Np = normalize(TBN * normalize(vec3(nTex.xy * uBump, max(nTex.z, 0.02))));

        float mu0 = dot(Np, L), mu = max(dot(Np, V), 0.0), geo = dot(N, L);
        float m0 = max(mu0, 0.0);
        float ls = m0 / max(m0 + mu, 1e-3);                 // Lommel-Seeliger
        float surge = 1.0 + 0.85 * pow(max(dot(L, V), 0.0), 24.0);
        float shadow = smoothstep(-0.05, 0.10, mu0) * smoothstep(-0.05, 0.09, geo);
        vec3 sunlit = albedo * vec3(1.0, 0.978, 0.945) * (1.15 * 2.0) * ls * surge * shadow;
        vec3 earthshine = albedo * vec3(0.030, 0.041, 0.066) * smoothstep(0.12, -0.35, geo);
        /* uFill is the recovery arriving: on the way down, the shadowed ground
           stops being black and starts being terrain. It is a scroll-driven
           exposure, not invented detail — the relief under it is the real
           altimetry all along. */
        float unlit = 1.0 - smoothstep(-0.05, 0.10, mu0);
        vec3 recovered = albedo * (0.55 + 0.45 * max(dot(Np, normalize(vec3(0.3, 0.8, 0.5))), 0.0)) * uFill * 1.5;
        vec3 color = sunlit + earthshine + recovered * unlit;

        /* Where the sun never reaches: high latitude, and facing away from the
           beam. The reveal rides a uniform so the scroll can ignite them. */
        float polar = smoothstep(0.72, 0.94, abs(vUv.y * 2.0 - 1.0));
        float dark = smoothstep(0.16, -0.05, geo);
        float psr = polar * max(dark, 0.35) * uPsr;
        color += uPsrColor * psr * 0.20;
        color = mix(color, uPsrColor * 0.16, psr * 0.35);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const moonSpin = new THREE.Group();
  const moonTilt = new THREE.Group();
  moonTilt.rotation.z = THREE.MathUtils.degToRad(6.7);
  moonTilt.add(moonSpin);
  scene.add(moonTilt);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), moonMat);
  moonSpin.add(moon);
  new GLTFLoader().load('../assets/moon.glb', (g) => {
    let geo = null;
    g.scene.traverse((o) => { if (!geo && o.isMesh) geo = o.geometry; });
    if (geo) { moon.geometry.dispose(); moon.geometry = geo; }
  }, undefined, () => {});

  /* ── the orbiter ───────────────────────────────────────────────────────── */
  const satAnchor = new THREE.Group();
  scene.add(satAnchor);
  const satLight = new THREE.DirectionalLight(0xfff4e6, 3.4);
  satLight.position.copy(SUN).multiplyScalar(40);
  scene.add(satLight);
  scene.add(new THREE.AmbientLight(0x2a3348, 1.1));

  let satellite = null;
  new GLTFLoader().load('../assets/satellite.glb', (g) => {
    satellite = g.scene;
    const box = new THREE.Box3().setFromObject(satellite);
    const span = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    satellite.scale.setScalar(0.16 / span);
    satAnchor.add(satellite);
  }, undefined, () => {});

  /* the target: Shackleton, near the south pole */
  const targetDir = new THREE.Vector3(0.06, -0.985, 0.16).normalize();
  const marker = new THREE.Group();
  marker.position.copy(targetDir).multiplyScalar(1.004);
  marker.lookAt(marker.position.clone().multiplyScalar(2));
  moonSpin.add(marker);
  const ringMat = new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  marker.add(new THREE.Mesh(new THREE.RingGeometry(0.020, 0.023, 64), ringMat));

  const beamMat = new THREE.MeshBasicMaterial({ color: MARK, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.028, 1, 28, 1, true), beamMat);
  scene.add(beam);

  /* ── the surface set ───────────────────────────────────────────────────── */
  const surface = new THREE.Group();
  surface.position.y = SURFACE_Y;
  scene.add(surface);

  const groundTex = loader.load('data/scene_truth.png');
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(3, 3);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80, 1, 1),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0, color: 0x4a4a48 }),
  );
  ground.rotation.x = -Math.PI / 2;
  surface.add(ground);

  // the wall of the crater, catching the only sunlight that gets in here
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 26),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: 0x2e3038 }),
  );
  wall.position.set(0, 12, -38);
  wall.rotation.x = 0.22;
  surface.add(wall);

  /* A DirectionalLight aims at its target's world position, and the default
     target is the world origin — which is 400 units above this set. Left alone
     it lit the crater floor from underneath, which is to say not at all. */
  const surfaceKey = new THREE.DirectionalLight(0xfff0dc, 0.30);
  surfaceKey.position.set(-16, 14, -26);
  surface.add(surfaceKey);
  const keyTarget = new THREE.Object3D();
  keyTarget.position.set(0, 0, 4);
  surface.add(keyTarget);
  surfaceKey.target = keyTarget;

  // the wall above is the actual light source down here, so it gets its own glow
  const wallBounce = new THREE.PointLight(0xbfd0ff, 9, 90, 2);
  wallBounce.position.set(-4, 16, -30);
  surface.add(wallBounce);
  // this floor receives about a thousandth of what the rim gets; if the scene
  // looks comfortable to read, the number on the caption is a lie
  const surfaceFill = new THREE.HemisphereLight(0x2b3558, 0x07090d, 0.17);
  surface.add(surfaceFill);

  /* ── the rover ─────────────────────────────────────────────────────────────
     A machine for a place with no sun. That single fact drives the design: no
     solar array, because there is nothing to catch — power comes from the
     radioisotope unit at the back, with its fins in the shade. The suspension is
     rocker-bogie, the geometry every planetary rover has used since Sojourner,
     because it keeps six wheels loaded on rubble without a spring in the loop.
     ──────────────────────────────────────────────────────────────────────── */
  const rover = new THREE.Group();
  rover.position.set(1.2, 0, 2);
  rover.rotation.y = -0.5;
  surface.add(rover);

  const M = {
    hull:  new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.62, metalness: 0.18 }),
    mli:   new THREE.MeshStandardMaterial({ color: 0xc8922f, roughness: 0.34, metalness: 0.82 }),
    dark:  new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.74, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d8f96, roughness: 0.38, metalness: 0.88 }),
    rubber:new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.95, metalness: 0.05 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.12, metalness: 0.95 }),
    hot:   new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.85, emissive: 0x6e2f0e, emissiveIntensity: 0.4 }),
  };

  const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = rover) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };

  /* body: a stack of slabs rather than one box, so the silhouette has steps in
     it and the light has edges to catch */
  put(new THREE.BoxGeometry(1.94, 0.34, 1.16), M.hull, 0, 0.80, 0);
  put(new THREE.BoxGeometry(1.72, 0.16, 1.02), M.hull, 0, 1.00, 0);
  put(new THREE.BoxGeometry(1.46, 0.05, 0.92), M.mli, 0, 1.10, 0);       // blanket
  put(new THREE.BoxGeometry(1.98, 0.06, 0.10), M.dark, 0, 0.63, 0.56);   // belly rail
  put(new THREE.BoxGeometry(1.98, 0.06, 0.10), M.dark, 0, 0.63, -0.56);

  // ribs down the flanks
  for (let i = -2; i <= 2; i++) {
    put(new THREE.BoxGeometry(0.045, 0.30, 0.03), M.steel, i * 0.34, 0.80, 0.59);
    put(new THREE.BoxGeometry(0.045, 0.30, 0.03), M.steel, i * 0.34, 0.80, -0.59);
  }

  /* wheels: cleated, because a smooth cylinder at this size reads as a toy.
     One wheel is built once and the grousers are instanced around it. */
  const wheels = [];
  const CLEATS = 18;
  function buildWheel() {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 28), M.rubber);
    tyre.rotation.z = Math.PI / 2;
    w.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.30, 16), M.steel);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    const cleat = new THREE.BoxGeometry(0.27, 0.035, 0.05);
    const grousers = new THREE.InstancedMesh(cleat, M.dark, CLEATS);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < CLEATS; i++) {
      const a = (i / CLEATS) * Math.PI * 2;
      e.set(a, 0, 0);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(0, Math.cos(a) * 0.325, Math.sin(a) * 0.325),
        q, new THREE.Vector3(1, 1, 1),
      );
      grousers.setMatrixAt(i, m4);
    }
    w.add(grousers);
    // spokes, visible when the lamp rakes across
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.30, 0.02), M.steel);
      s.rotation.x = (i / 6) * Math.PI;
      w.add(s);
    }
    return w;
  }

  /* rocker-bogie: a rocker per side carrying a bogie at the front pair */
  for (const side of [-1, 1]) {
    const z = side * 0.72;
    const rocker = new THREE.Group();
    rocker.position.set(0, 0.62, z);
    rover.add(rocker);

    // the two struts that give the suspension its shape
    put(new THREE.BoxGeometry(1.06, 0.07, 0.07), M.steel, 0.22, 0.11, 0, 0, 0, -0.30, rocker);
    put(new THREE.BoxGeometry(0.86, 0.07, 0.07), M.steel, -0.46, 0.05, 0, 0, 0, 0.24, rocker);
    put(new THREE.BoxGeometry(0.5, 0.06, 0.06), M.steel, -0.70, -0.16, 0, 0, 0, -0.55, rocker);
    put(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), M.dark, 0, 0.12, 0, Math.PI / 2, 0, 0, rocker);

    for (const [wx, wy] of [[0.80, -0.28], [0.02, -0.28], [-0.86, -0.28]]) {
      const w = buildWheel();
      w.position.set(wx, wy, 0);
      rocker.add(w);
      wheels.push(w);
      // steering knuckle
      put(new THREE.BoxGeometry(0.08, 0.22, 0.08), M.hull, wx, wy + 0.20, 0, 0, 0, 0, rocker);
    }
  }

  /* mast: stereo pair plus the lamp, which is the only real light down here */
  const mast = new THREE.Group();
  mast.position.set(-0.52, 1.12, 0);
  rover.add(mast);
  put(new THREE.CylinderGeometry(0.05, 0.075, 1.12, 14), M.hull, 0, 0.56, 0, 0, 0, 0, mast);
  put(new THREE.CylinderGeometry(0.09, 0.09, 0.10, 14), M.dark, 0, 1.10, 0, 0, 0, 0, mast);

  const head = new THREE.Group();
  head.position.set(0, 1.20, 0);
  mast.add(head);
  put(new THREE.BoxGeometry(0.62, 0.20, 0.20), M.hull, 0, 0, 0, 0, 0, 0, head);
  put(new THREE.BoxGeometry(0.66, 0.05, 0.24), M.dark, 0, 0.12, 0, 0, 0, 0, head);   // sun visor
  for (const dx of [-0.19, 0.19]) {                                                  // stereo pair
    put(new THREE.CylinderGeometry(0.062, 0.07, 0.12, 18), M.dark, dx, 0, 0.14, Math.PI / 2, 0, 0, head);
    put(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 18), M.glass, dx, 0, 0.21, Math.PI / 2, 0, 0, head);
  }
  const lampHousing = put(new THREE.CylinderGeometry(0.05, 0.058, 0.10, 14), M.steel, 0, 0, 0.15, Math.PI / 2, 0, 0, head);
  const lampLens = put(new THREE.CircleGeometry(0.046, 18), new THREE.MeshBasicMaterial({ color: 0xfff2d8 }), 0, 0, 0.205, 0, 0, 0, head);

  /* the RTG: no sun here, so the power comes from decay heat. Fins face the
     shade because there is nowhere else to dump it. */
  const rtg = new THREE.Group();
  rtg.position.set(0.86, 1.02, 0);
  rover.add(rtg);
  put(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 18), M.dark, 0, 0, 0, 0, 0, Math.PI / 2, rtg);
  for (let i = 0; i < 8; i++) {
    const fin = put(new THREE.BoxGeometry(0.60, 0.005, 0.30), M.steel, 0, 0, 0, 0, 0, 0, rtg);
    fin.rotation.x = (i / 8) * Math.PI;
  }
  put(new THREE.CylinderGeometry(0.09, 0.09, 0.66, 12), M.hot, 0, 0, 0, 0, 0, Math.PI / 2, rtg);

  /* high-gain dish on a short boom */
  const boom = new THREE.Group();
  boom.position.set(0.44, 1.12, -0.34);
  rover.add(boom);
  put(new THREE.CylinderGeometry(0.028, 0.028, 0.46, 10), M.hull, 0, 0.23, 0, 0, 0, 0, boom);
  /* a shallow paraboloid, open side up-sun. The first attempt used a hemisphere
     squashed on one axis and rotated, which from most angles read as a bent
     crescent rather than a dish. */
  const dish = put(
    new THREE.SphereGeometry(0.26, 26, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38),
    M.mli, 0, 0.52, 0, -0.95, 0, 0, boom,
  );
  dish.scale.set(1, 1.5, 1);
  dish.material = new THREE.MeshStandardMaterial({
    color: 0xd7d2c6, roughness: 0.42, metalness: 0.6, side: THREE.DoubleSide,
  });
  // the feed at the focus, on its little tripod
  put(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), M.steel, 0, 0.62, 0.075, -0.95, 0, 0, boom);
  put(new THREE.SphereGeometry(0.028, 10, 8), M.dark, 0, 0.68, 0.14, 0, 0, 0, boom);

  /* the arm, stowed against the front the way it flies */
  const arm = new THREE.Group();
  arm.position.set(-0.94, 0.78, 0.34);
  rover.add(arm);
  put(new THREE.BoxGeometry(0.50, 0.07, 0.07), M.hull, -0.20, 0.02, 0, 0, 0, 0.22, arm);
  put(new THREE.BoxGeometry(0.34, 0.06, 0.06), M.hull, -0.52, -0.12, 0, 0, 0, -0.5, arm);
  put(new THREE.BoxGeometry(0.12, 0.10, 0.12), M.dark, -0.66, -0.24, 0, 0, 0, 0, arm);

  /* whip antenna and a couple of handrails, the details that give scale */
  put(new THREE.CylinderGeometry(0.008, 0.008, 0.86, 6), M.steel, 0.74, 1.55, 0.42);
  put(new THREE.TorusGeometry(0.09, 0.012, 8, 14, Math.PI), M.steel, -0.10, 1.14, 0.40, Math.PI / 2, 0, 0);
  put(new THREE.TorusGeometry(0.09, 0.012, 8, 14, Math.PI), M.steel, 0.32, 1.14, -0.40, Math.PI / 2, 0, 0);

  // the lamp itself
  const lamp = new THREE.SpotLight(0xfff6e8, 0, 34, 0.5, 0.62, 1.4);
  lamp.position.set(0, 0, 0.22);
  const lampTarget = new THREE.Object3D();
  lampTarget.position.set(0, -2.2, 9);
  head.add(lamp);
  head.add(lampTarget);
  lamp.target = lampTarget;

  /* wheel tracks running back into the dark */
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 1, transparent: true, opacity: 0.6 });
  for (const side of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 44), trackMat);
    t.rotation.x = -Math.PI / 2;
    t.rotation.z = -0.5;
    t.position.set(1.2 + side * 0.62 * Math.cos(0.5), 0.012, 2 - 22 + side * 0.2);
    surface.add(t);
  }

  /* ── state the timeline writes into ────────────────────────────────────── */
  const s = {
    camR: 6.2, camLat: 0.12, camLon: 0.4, camFov: 38,
    spin: 0, psr: 0, satOrbit: 0.2, satR: 1.9, markerA: 0, beamA: 0,
    fill: 0,                      // the shadowed ground coming up out of black
    set: 0,                       // 0 = orbital, 1 = surface
    surfCamX: 6, surfCamY: 3.4, surfCamZ: 9, surfLookY: 1.4, lamp: 0,
    frame: 0,                     // the captured picture fading up
    flash: 0,
  };

  const _v = new THREE.Vector3();
  function apply() {
    moonSpin.rotation.y = s.spin;
    moonMat.uniforms.uPsr.value = s.psr;
    moonMat.uniforms.uFill.value = s.fill;

    if (s.set < 0.5) {
      const r = s.camR;
      const lat = s.camLat, lon = s.camLon;
      camera.position.set(
        r * Math.cos(lat) * Math.sin(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.cos(lon),
      );
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(SURFACE_Y * 0 + s.surfCamX, SURFACE_Y + s.surfCamY, s.surfCamZ);
      camera.lookAt(rover.position.x, SURFACE_Y + s.surfLookY, rover.position.z);
    }
    camera.fov = s.camFov;
    camera.updateProjectionMatrix();

    // the orbiter rides a tilted circle and always faces the surface below it
    const a = s.satOrbit * Math.PI * 2;
    const tilt = 0.5;
    satAnchor.position.set(
      Math.cos(a) * s.satR,
      Math.sin(a) * s.satR * Math.sin(tilt) - 0.35,
      Math.sin(a) * s.satR * Math.cos(tilt),
    );
    if (satellite) satellite.lookAt(0, 0, 0);

    ringMat.opacity = s.markerA * 0.85;
    marker.scale.setScalar(1 + (1 - s.markerA) * 0.6);

    // the beam is a cone stretched from the craft to the marked ground
    const from = satAnchor.position;
    marker.updateWorldMatrix(true, false);
    const to = _v.setFromMatrixPosition(marker.matrixWorld);
    const len = from.distanceTo(to);
    beam.visible = s.beamA > 0.01;
    beamMat.opacity = s.beamA * 0.75;
    beam.position.copy(from).lerp(to, 0.5);
    beam.scale.set(1, len, 1);
    beam.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, -1, 0), _v.copy(to).sub(from).normalize(),
    );

    lamp.intensity = s.lamp * 190;
    for (const w of wheels) w.rotation.x = s.spin * 3;
  }

  /* ── loop ──────────────────────────────────────────────────────────────── */
  let running = true;
  let paused = false;         // the flight is over; stop burning a GPU on it
  const clock = new THREE.Clock();
  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    if (paused) return;
    const t = clock.getElapsedTime();
    stars.rotation.y = t * 0.004;
    if (s.set >= 0.5) rover.position.z = 2 + Math.sin(t * 0.25) * 0.02;
    apply();
    renderer.render(scene, camera);
  }
  tick();

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  /* ── the scroll timeline ───────────────────────────────────────────────── */
  function bind(trigger, flashEl, frameEl) {
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.6 },
    });

    // 1 · approach: the disc grows and turns its pole toward us
    tl.to(s, { camR: 3.1, camLat: -0.28, camLon: 0.9, spin: 0.5, duration: 1 })
    // 2 · the shadowed regions ignite
      .to(s, { psr: 1, camLat: -0.72, camR: 2.6, spin: 0.85, duration: 0.8 })
    // 3 · the orbiter arrives and we fall in behind it
      .to(s, { camR: 2.05, camFov: 44, satOrbit: 0.62, satR: 1.5, spin: 1.05, duration: 1 })
    // 4 · target selection: the reticle lands and the beam fires
      .to(s, { markerA: 1, camLat: -0.95, camLon: 1.35, duration: 0.5 })
      .to(s, { beamA: 1, duration: 0.35 })
    // 5 · descent, straight down the beam, the floor coming up out of black
      .to(s, { camR: 1.28, camFov: 58, fill: 1, duration: 0.9 })
      .to(s, { flash: 1, duration: 0.25 })
    // 6 · cut to the surface under cover of the flash, lamp on
      .set(s, { set: 1 })
      .to(s, { flash: 0, lamp: 1, duration: 0.35 })
      .to(s, { surfCamX: 3.4, surfCamZ: 6.2, surfCamY: 2.2, duration: 1 })
    // 7 · the rover's camera takes the frame
      .to(s, { surfCamX: 2.1, surfCamZ: 6.4, surfCamY: 2.05, surfLookY: 1.5, duration: 0.8 })
      .to(s, { frame: 1, duration: 0.6 });

    // the DOM overlays that carry the flash and the captured picture
    gsap.ticker.add(() => {
      if (flashEl) flashEl.style.opacity = String(s.flash);
      if (frameEl) {
        frameEl.style.opacity = String(Math.min(1, s.frame * 1.6));
        frameEl.style.setProperty('--shutter', String(s.frame));
      }
    });
    if (onFrameCaptured) {
      ScrollTrigger.create({
        trigger, start: 'bottom-=12% bottom', once: true, onEnter: onFrameCaptured,
      });
    }
    return tl;
  }

  return {
    bind,
    state: s,
    dispose() { running = false; renderer.dispose(); },
    /* Once the canvas has faded out there is no reason to keep rendering a moon
       nobody can see, and this page has 20 000 px of scrolling left to do. */
    pause(v) { paused = v; },
    setQuality(low) { renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2)); },
  };
}
