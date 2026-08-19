# SnowWhite — Orbital Lunar Observation Terminal

**Live: [psr-net.vercel.app/psr/](https://psr-net.vercel.app/psr/)** — the PSR
recovery story, with the trained network running in your browser.
The orbital terminal is at [psr-net.vercel.app](https://psr-net.vercel.app/).

The Moon at the centre of a deep starfield, rendered in WebGL, with a comms
satellite in a tilted orbit. Drag to orbit, scroll to zoom, hover the surface
for live selenographic coordinates, and click the satellite to task it — by
feature name or by latitude/longitude. The craft slews, locks on, and marks the
target.

Standalone: no backend, no API keys, no build step. Everything it draws ships in
this repository.

## The surface is the real Moon

Both maps come from NASA's [CGI Moon Kit][kit] (NASA/GSFC Scientific
Visualization Studio, public domain), processed once offline and baked into the
model in Blender:

| Asset | Source | What was done to it |
| --- | --- | --- |
| `assets/moon_day.jpg` | LROC Wide Angle Camera global colour mosaic, 8192×4096 | white-balanced against its own warm average, then a mineral-colour saturation lift |
| `assets/moon_norm.jpg` | LOLA laser-altimeter DEM, 16-bit half-metres | differentiated into a tangent-space normal map at 4096×2048, ×2 exaggeration |
| `assets/moon.glb` | the same DEM | displaced into a 320×160 UV sphere in Blender and exported, ±10 km of real relief at ×1.8 |

A normal map rather than a height map because 8-bit heights quantise into
terraces the moment you differentiate them, and every slope on this surface is a
difference of two heights. The elevation still reaches the geometry — that is
what `moon.glb` is for, and it is why the limb breaks against the starfield
instead of drawing a mathematically perfect circle.

[kit]: https://svs.gsfc.nasa.gov/4720

## Two things live here

| Path | What it is |
| --- | --- |
| `/` | The orbital lunar terminal — the Moon in WebGL with a taskable comms satellite |
| `/psr/` | **PSR-NET** — a scroll-driven paper on recovering terrain from permanently shadowed craters imaged by Chandrayaan-2 OHRC, with the whole enhancement pipeline running live in the browser |

## The model

`psr/train` holds everything needed to reproduce PSR-Net, the network the page
runs. It needs a CUDA GPU to be quick, but it will train on CPU given patience.

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install numpy scipy pillow scikit-image onnx onnxruntime

python psr/train/synth.py 384        # cache the scene bank (~7 min, 386 MB)
python psr/train/train.py            # 36k steps, ~3 h on an RTX 5050
python psr/train/evaluate.py         # learned vs the deterministic chain
python psr/train/export_onnx.py      # ONNX + numeric check, into psr/model
```

The scenes are cached once; the *sensor* is re-randomised on every sample, with
every parameter drawn from a range wider than OHRC's nominal figures. A model
that only works at the nominal values has learned the simulator, not the
inverse problem.

`export_onnx.py` refuses to write a model whose ONNX graph disagrees with the
PyTorch one by more than 2e-3, because an ONNX file that loads is not an ONNX
file that agrees.

The page loads `psr/model/psrnet.onnx` if it is there and states what it
found — parameters, training step, held-out score, execution provider. With no
weights present it says so and shows the deterministic chain alone.

## Run

Needs [Node.js](https://nodejs.org) 18 or newer and a current browser. Nothing
else — no Python, no build step, no accounts.

```bash
git clone https://github.com/AtharvaLakhe/SnowWhite.git
cd SnowWhite
npm install     # three.js and gsap, the only two dependencies
npm run serve
```

Then open **http://localhost:8123/** for the orbital terminal, or
**http://localhost:8123/psr/** for PSR-NET.

It must be served over HTTP — the ES module import map will not resolve over
`file://`, so double-clicking `index.html` gives a blank page.

`npm install` is the only step that touches the network. After it, the whole
thing runs with the cable out: every texture, model and script is served from
this repository or from `node_modules`.

**Port already in use?** `PORT=3000 npm run serve`.

## Test

```bash
npm test          # coordinate maths + query parsing (node only)
npm run test:e2e  # drives a real headless browser over CDP; needs the server running
```

## What's in here

| File | Role |
| --- | --- |
| `index.html` | Page shell and HUD markup |
| `main.js` | Scene, camera, orbit controls, lunar surface shader, satellite, targeting |
| `shaders.js` | Noise and colour-space GLSL chunks |
| `quality.js` | Device-tier detection and quality presets |
| `geo.js` | Lat/lon ↔ vector maths and query parsing |
| `places.js` | Selenographic gazetteer — maria, craters, landing sites |
| `maremask.js` | Mare/highland classification, read off the LROC mosaic |
| `server.mjs` | Minimal static file server |
| `psr/` | PSR-NET: the scrollytelling page, its enhancement engine, and the renderer that generates its data |
| `node_modules/gsap` | GSAP + ScrollTrigger + SplitText, imported by `psr/index.html`'s import map — no CDN, no bundler |
| `assets/` | The Moon (model, colour, normals) and the satellite model |

## Lighting

No atmosphere, so none of the Earth machinery survived: no halo at the limb, no
aerial perspective, no blue in the shadows. What replaces it is the scattering
law regolith actually obeys — Lommel-Seeliger, which keeps the limb as bright as
the disc centre, plus the opposition surge that makes a full Moon far brighter
than twice a half Moon. The terminator is hard, softened only by the width of
the Sun's own disc, and the night side carries earthshine rather than black.

The sun sits about 50° off the camera axis rather than over your shoulder: a
full Moon is the phase that shows the least, because nothing casts a shadow.
Task a target on the night side and the sun rotates about the spin axis to bring
it into local morning — the wait a real orbiter would have, compressed.

## Embedding

The terminal answers *where*. If a host application wants to answer *what is
there*, define `window.SPARC.open({ lat, lon, name })` before `main.js` loads —
it is called once the satellite has finished its slew. The scene also listens for
two optional events from a host:

- `sparc:district` — `{ rings, approximate, colour, intensity }` draws a boundary
  on the surface
- `sparc:indicator` — `{ indicatorId }` recolours the marker and beam

With no host present, none of this fires and the globe simply stays on target.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera |
| Scroll | Zoom |
| Hover surface | Live lat/lon readout |
| Click satellite | Open the targeting console |
| `Esc` | Close the console |

## PSR-NET

`psr/` answers the *Enhancement of Permanently Shadowed Regions of Lunar Craters
Captured by OHRC* problem statement. It is a single scroll-driven page that walks
from the physics of a 1.54° obliquity down to a boulder-detection map, and the
whole enhancement chain executes in the browser on real 12-bit data:

```
radiometric → destripe → guided denoise → multi-scale retinex
           → Richardson–Lucy → CLAHE → LoG detection + ensemble stability
```

Every metric on the page — PSNR, SSIM, CNR, sharpness, and the ablation table —
is computed live against a paired target, not quoted. `psr/render_scene.py`
regenerates the data: a real LOLA south-pole PSR map by horizon marching, and a
synthetic OHRC frame at 0.25 m/px pushed through a modelled sensor (shot noise,
dark, read noise, PRNU, column pattern, TDI smear, 12-bit quantisation).

```bash
python psr/render_scene.py               # both scenes, needs numpy/scipy/pillow
python psr/render_scene.py --frame-only  # just the OHRC frame
```

The trained network is specified on the page but its weights are not shipped, and
the page says so where it matters. What runs is the deterministic operator chain
the network is trained to approximate.
