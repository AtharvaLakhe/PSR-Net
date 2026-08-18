# SnowWhite — Orbital Earth Observation Terminal

Earth at the centre of a deep starfield, rendered in WebGL, with a comms satellite
in a tilted orbit. Drag to orbit, scroll to zoom, hover the globe for live
coordinates, and click the satellite to task it — by place name or by
latitude/longitude. The craft slews, locks on, and marks the target.

Standalone: no backend, no API keys, no build step. Everything it draws ships in
this repository.

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
| `main.js` | Scene, camera, orbit controls, satellite, targeting |
| `shaders.js` | Atmosphere, terminator, ocean and beam shaders |
| `quality.js` | Device-tier detection and quality presets |
| `geo.js` | Lat/lon ↔ vector maths and query parsing |
| `places.js` | Built-in city catalogue and nearest-place lookup |
| `landmask.js` | Land/water classification from the day texture |
| `server.mjs` | Minimal static file server |
| `assets/` | Earth textures (day, night, clouds, ocean, topo) and the satellite model |

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
| Hover globe | Live lat/lon readout |
| Click satellite | Open the targeting console |
| `Esc` | Close the console |
