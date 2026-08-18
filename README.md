# SnowWhite — Orbital Lunar Observation Terminal

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

## Run

```bash
npm install     # pulls three.js only
npm run serve   # http://localhost:8123/
```

It must be served over HTTP — the ES module import map will not resolve over
`file://`.

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
