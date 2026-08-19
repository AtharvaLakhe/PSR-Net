"""Render the two scenes the page needs, and be explicit about what each one is.

There is no ground truth inside a permanently shadowed region — that is the whole
problem. Nobody has photographed the floor of Shackleton in reflected sunlight,
because there has never been any. The way the published work handles this
(Bickel et al., Nat. Commun. 2021) is to model the scene and the instrument end
to end and degrade a known target, then check that the recovery puts back what
was taken away. That is what this script builds.

SCENE A — context.png, psr_map.png              MEASURED TOPOGRAPHY
  The lunar south pole from the LOLA gridded DEM (NASA/GSFC CGI Moon Kit,
  16 px/deg). Rendered as shaded relief, plus the shadow mask from a horizon
  march at a 1.54 deg sun. This is real terrain, and it is what says where the
  PSRs are. It is resampled to ~190 m/px and smoothed at 3 px, still four times
  finer than the source grid, so the smoothing removes resampling streaks near
  the pole singularity without inventing or destroying measured relief.

SCENE B — scene_truth.png, scene_obs.png        SYNTHETIC TERRAIN, MODELLED SENSOR
  A 256 m patch of crater floor at OHRC's own 0.25 m sampling. No DEM on Earth
  resolves this: LOLA's grid step here is 1.9 km, seven thousand times coarser.
  So the terrain is drawn from published statistics — craters on a d^-2.6
  size-frequency slope, boulders on d^-3 — and the illumination and the sensor
  are modelled from first principles. It is a physically honest simulation, not
  a photograph, and the page says so wherever it appears.

Instrument model: photon shot noise, dark current, read noise, PRNU, column
fixed pattern, TDI along-track smear and 12-bit quantisation, applied in the
order the sensor applies them.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, zoom as ndzoom

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data')
# The LOLA DEM is 33 MB and is not committed. It is a NASA product, freely
# downloadable, and needed only to REGENERATE the scenes — the rendered PNGs in
# psr/data are what the page loads, so a fresh clone never needs this file.
#   https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif
# Point PSR_DEM at it, or drop it next to this script.
DEM_TIF = os.environ.get('PSR_DEM') or os.path.join(HERE, 'ldem_16_uint.tif')

R_MOON = 1737400.0
SECONDARY_FRAC = 3.0e-3     # sunlit-wall scattering; published range 1e-3 .. 1e-5

# Chandrayaan-2 OHRC, from the published instrument description
OHRC = dict(
    gsd_m=0.25, swath_km=3.0, orbit_km=100.0, band_nm='400-750',
    qe=0.42, tdi_stages=64, line_time_us=290.0, read_noise_e=28.0,
    dark_e_per_s=180.0, prnu=0.012, full_well_e=95000.0, bits=12, smear_px=2.4,
)


def log(m):
    print(f'  {m}', flush=True)


def blur(a, s):
    return a if s <= 0 else gaussian_filter(a.astype(np.float32), s, mode='nearest')


def value_noise(shape, cells, seed):
    g = np.random.default_rng(seed).random((cells + 1, cells + 1)).astype(np.float32)
    out = ndzoom(g, (shape[0] / g.shape[0], shape[1] / g.shape[1]), order=3, mode='nearest')
    return out[:shape[0], :shape[1]].astype(np.float32)


def fbm(shape, octaves=7, base=4, seed=1, gain=0.52):
    out = np.zeros(shape, dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        out += amp * value_noise(shape, base * 2 ** o, seed + o * 977)
        norm += amp
        amp *= gain
    return out / norm


def normals(z, px_m):
    gy, gx = np.gradient(z, px_m)
    n = np.stack([-gx, -gy, np.ones_like(z)], axis=-1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def sample(a, x, y):
    n0, n1 = a.shape
    x0 = np.clip(x.astype(np.int32), 0, n1 - 2)
    y0 = np.clip(y.astype(np.int32), 0, n0 - 2)
    fx, fy = x - x0, y - y0
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
            + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)


def horizon_mask(z, px_m, sun_az, sun_el, steps=600, stride=1.4):
    """Lit only if the sun clears every ridge between here and the horizon. At
    1.5 degrees that test, not the local surface normal, is what carves a PSR.
    Rays leaving the grid stop obstructing rather than clamping to the edge pixel,
    which would turn the last column into an infinitely long wall."""
    n0, n1 = z.shape
    ax = np.deg2rad(sun_az)
    dx, dy = np.sin(ax), -np.cos(ax)
    X, Y = np.meshgrid(np.arange(n1, dtype=np.float32), np.arange(n0, dtype=np.float32))
    best = np.full(z.shape, -np.inf, dtype=np.float32)
    for s in range(1, steps + 1):
        t = s * stride
        px, py = X + dx * t, Y + dy * t
        inside = (px >= 0) & (px <= n1 - 1) & (py >= 0) & (py <= n0 - 1)
        if not inside.any():
            break
        ang = np.where(inside, (sample(z, px, py) - z) / (t * px_m), -np.inf)
        best = np.maximum(best, ang)
    return np.rad2deg(np.arctan(best)) < sun_el


# ── SCENE A: the real south pole ───────────────────────────────────────────
def scene_context(n=900, half_km=85.0):
    if not os.path.exists(DEM_TIF):
        raise SystemExit(
            f'LOLA DEM not found at {DEM_TIF}\n'
            '  Get ldem_16_uint.tif from https://svs.gsfc.nasa.gov/4720, then set\n'
            '  PSR_DEM to its path — or pass --frame-only to skip the south-pole\n'
            '  scene and rebuild just the OHRC frame, which needs no DEM.')
    dem = np.asarray(Image.open(DEM_TIF), dtype=np.float32)
    dem = (dem - 20000.0) * 0.5
    H, W = dem.shape

    half = half_km * 1000.0
    ax = np.linspace(-half, half, n, dtype=np.float32)
    X, Y = np.meshgrid(ax, ax)
    r = np.hypot(X, Y)
    lat = -90.0 + np.rad2deg(r / R_MOON)
    lon = np.rad2deg(np.arctan2(X, -Y))
    u = ((lon + 180.0) % 360.0) / 360.0 * (W - 1)
    v = (90.0 - lat) / 180.0 * (H - 1)
    z = sample(dem, u, v).astype(np.float32)

    px_m = 2 * half / n
    z = blur(z, 3.0)

    nrm = normals(z, px_m)
    az, el = 118.0, 12.0
    a, e = np.deg2rad(az), np.deg2rad(el)
    L = np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)], np.float32)
    shade = np.clip(nrm @ L, 0, None)
    lit = horizon_mask(z, px_m, az, el, steps=420)
    img = np.clip(0.05 + 0.95 * shade * lit, 0, 1) ** (1 / 2.2)

    # A PSR is a place no sun reaches from any azimuth over the whole year, so
    # the mask is the intersection of the shadow tests around the compass.
    psr = np.ones(z.shape, bool)
    for a_deg in (0.0, 60.0, 120.0, 180.0, 240.0, 300.0):
        psr &= ~horizon_mask(z, px_m, a_deg, 1.54, steps=420)

    Image.fromarray((img * 255 + .5).astype(np.uint8), 'L').save(
        os.path.join(OUT, 'context.png'), optimize=True)
    Image.fromarray((psr * 255).astype(np.uint8), 'L').save(
        os.path.join(OUT, 'psr_map.png'), optimize=True)
    return dict(context_px_m=round(px_m, 1), context_half_km=half_km,
                context_psr_frac=round(float(psr.mean()), 4),
                relief_km=round(float((z.max() - z.min()) / 1000), 2))


# ── SCENE B: an OHRC frame of a crater floor ───────────────────────────────
def craters(z, px_m, count, dmin_m, dmax_m, seed, depth_ratio=0.19):
    n = z.shape[0]
    r = np.random.default_rng(seed)
    a = 2.6 - 1.0
    u = r.random(count)
    d = (dmin_m ** -a + u * (dmax_m ** -a - dmin_m ** -a)) ** (-1.0 / a) / px_m
    xs, ys = r.integers(0, n, count), r.integers(0, n, count)
    for cx, cy, dd in zip(xs, ys, d):
        rad = max(1.5, dd * 0.5)
        R = int(np.ceil(rad * 1.6))
        x0, x1 = max(0, cx - R), min(n, cx + R + 1)
        y0, y1 = max(0, cy - R), min(n, cy + R + 1)
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rr = np.hypot(xx - cx, yy - cy) / rad
        depth = depth_ratio * (2 * rad * px_m)
        bowl = np.where(rr < 1.0, -depth * (1.0 - rr ** 2), 0.0)
        rim = np.where((rr >= 1.0) & (rr < 1.6),
                       depth * 0.20 * np.exp(-((rr - 1.0) / 0.26) ** 2), 0.0)
        z[y0:y1, x0:x1] += (bowl + rim).astype(np.float32)
    return z


def boulders(z, px_m, count, seed, dmin_m=0.35, dmax_m=6.0):
    """Sizes on a d^-3 law, the slope boulder surveys report for polar crater
    floors. Height is 0.45 of diameter: blocks sit partly buried in regolith."""
    n = z.shape[0]
    r = np.random.default_rng(seed)
    a = 3.0 - 1.0
    u = r.random(count)
    d_m = (dmin_m ** -a + u * (dmax_m ** -a - dmin_m ** -a)) ** (-1.0 / a)
    xs, ys = r.integers(0, n, count), r.integers(0, n, count)
    marks = []
    for cx, cy, dm in zip(xs, ys, d_m):
        rad = max(0.8, (dm / px_m) * 0.5)
        R = int(np.ceil(rad * 2.2))
        x0, x1 = max(0, cx - R), min(n, cx + R + 1)
        y0, y1 = max(0, cy - R), min(n, cy + R + 1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rr = np.hypot(xx - cx, yy - cy) / rad
        z[y0:y1, x0:x1] += (0.45 * dm * np.exp(-rr ** 2 * 1.5)).astype(np.float32)
        if dm >= 1.5:
            marks.append(dict(x=int(cx), y=int(cy), d=round(float(dm), 2)))
    return z, marks


def to_dn(radiance, gain, seed):
    """Radiance -> electrons -> DN in the sensor's own order. The optics smear the
    photons before the detector counts them, so the blur goes first and the noise
    second; the other way round flatters a denoiser by handing it noise that the
    PSF has conveniently correlated for it."""
    n = radiance.shape[0]
    r = np.random.default_rng(seed)
    sm = blur(radiance, OHRC['smear_px'] * 0.42)
    k = int(round(OHRC['smear_px']))
    if k > 1:                                   # along-track TDI smear: a box
        pad = np.pad(sm, ((k // 2, k // 2), (0, 0)), mode='edge')
        sm = np.mean([pad[i:i + n] for i in range(k)], axis=0).astype(np.float32)

    e = np.clip(sm * gain, 0, None)
    dark = OHRC['dark_e_per_s'] * OHRC['line_time_us'] * 1e-6 * OHRC['tdi_stages']
    sig = r.poisson(e + dark).astype(np.float32)
    sig += r.normal(0, OHRC['read_noise_e'], (n, n)).astype(np.float32)
    sig *= 1.0 + r.normal(0, OHRC['prnu'], (n, n)).astype(np.float32)
    sig += r.normal(0, 11.0, (1, n)).astype(np.float32)          # column offset
    sig *= 1.0 + r.normal(0, 0.010, (1, n)).astype(np.float32)   # column gain
    dn_per_e = (2 ** OHRC['bits'] - 1) / OHRC['full_well_e']
    return np.clip(np.round(sig * dn_per_e), 0, 2 ** OHRC['bits'] - 1).astype(np.uint16), dark


def scene_ohrc(n=1024):
    px_m = OHRC['gsd_m']
    field = n * px_m
    log(f'OHRC frame: {n}x{n} at {px_m} m/px -> {field:.0f} m across')

    z = (fbm((n, n), octaves=8, base=3, seed=31) - 0.5) * 1.9      # regolith undulation
    yy = np.linspace(0, 1, n, dtype=np.float32)[:, None]
    z = z + yy * field * np.tan(np.deg2rad(7.0))                   # floor tilting to the wall
    z = craters(z, px_m, 1400, 0.6, 55.0, seed=41)
    z, marks = boulders(z, px_m, 2600, seed=43)
    nrm = normals(z, px_m)

    # Inside a PSR there is no beam. Light arrives from whatever patch of sky
    # holds sunlit wall, so the field is soft and directional, gated by how much
    # sky each spot can see.
    sky = np.clip(1.0 - (blur(z, 26) - z) / (px_m * 22.0), 0.04, 1.0)
    a, e = np.deg2rad(300.0), np.deg2rad(18.0)
    Ls = np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)], np.float32)
    soft = np.clip(nrm @ Ls, 0, None) * 0.55 + 0.45
    albedo = 0.11 * (0.86 + 0.28 * fbm((n, n), 5, 6, seed=53))
    psr_radiance = albedo * soft * sky * SECONDARY_FRAC

    # ── the paired target ──────────────────────────────────────────────────
    # It must carry the SAME illumination as the observation. A target lit from
    # a different direction inverts every crater's shading, and then no amount of
    # correct enhancement can match it — you would be scoring the pipeline on
    # relighting the scene, which is not what it does. So the target is the PSR
    # radiance field itself with a perfect sensor: no smear, no noise, no
    # quantisation. Recovering it is exactly the job.
    truth = psr_radiance

    # kept only as an illustration of what the terrain is, never as a metric
    # reference: the same rock under a 25 deg sun
    a2, e2 = np.deg2rad(118.0), np.deg2rad(25.0)
    L2 = np.array([np.sin(a2) * np.cos(e2), -np.cos(a2) * np.cos(e2), np.sin(e2)], np.float32)
    mu0 = np.clip(nrm @ L2, 0, None)
    mu = np.clip(nrm[..., 2], 0.05, None)
    lit2 = horizon_mask(z, px_m, 118.0, 25.0, steps=90)
    relit = albedo * mu0 / (mu0 + mu) * lit2 * 2.0 + albedo * sky * 0.05

    gain = (0.70 * OHRC['full_well_e']) / max(float(np.percentile(relit, 99.5)), 1e-9)
    dn, dark = to_dn(psr_radiance, gain, seed=61)

    packed = np.zeros((n, n, 3), np.uint8)
    packed[..., 0] = (dn >> 8).astype(np.uint8)
    packed[..., 1] = (dn & 0xFF).astype(np.uint8)
    Image.fromarray(packed).save(os.path.join(OUT, 'scene_obs.png'), optimize=True)

    for name, arr, pct in (('scene_truth.png', truth, 99.8), ('scene_relit.png', relit, 99.6)):
        lo = float(np.percentile(arr, 0.2))
        t = np.clip((arr - lo) / max(float(np.percentile(arr, pct)) - lo, 1e-12), 0, 1) ** (1 / 2.2)
        Image.fromarray((t * 255 + .5).astype(np.uint8), 'L').save(
            os.path.join(OUT, name), optimize=True)

    dnf = dn.astype(np.float32)
    return dict(
        frame_px=n, frame_m=round(field, 1), gsd_m=px_m,
        secondary_frac=SECONDARY_FRAC,
        dn_mean=round(float(dnf.mean()), 2), dn_std=round(float(dnf.std()), 2),
        dn_p99=int(np.percentile(dnf, 99)), dn_max=int(dnf.max()),
        frac_below_dn8=round(float((dnf < 8).mean()), 4),
        dark_e=round(float(dark), 2),
        read_noise_dn=round(OHRC['read_noise_e'] * (2 ** OHRC['bits'] - 1)
                            / OHRC['full_well_e'], 2),
        boulders_over_1p5m=len(marks),
        scene_snr=round(float(dnf.mean() / max(dnf.std(), 1e-6)), 3),
    ), marks


def main():
    import sys
    os.makedirs(OUT, exist_ok=True)
    skip_a = '--frame-only' in sys.argv
    if skip_a and os.path.exists(os.path.join(OUT, 'scene_meta.json')):
        with open(os.path.join(OUT, 'scene_meta.json'), encoding='utf-8') as f:
            a = json.load(f)['context']
        log('SCENE A: reusing existing render')
    else:
        log('SCENE A: LOLA south pole')
        a = scene_context()
    log('SCENE B: synthetic OHRC frame')
    b, marks = scene_ohrc()
    meta = dict(
        instrument=OHRC, context=a, frame=b, boulders=marks[:400],
        provenance=dict(
            context='NASA/GSFC SVS CGI Moon Kit, LOLA gridded DEM 16 px/deg',
            frame='synthetic terrain from published SFDs; modelled illumination and sensor'))
    with open(os.path.join(OUT, 'scene_meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
    log(json.dumps(a, indent=2))
    log(json.dumps(b, indent=2))
    for nm in ('context.png', 'psr_map.png', 'scene_obs.png', 'scene_truth.png', 'scene_relit.png'):
        p = os.path.join(OUT, nm)
        log(f'{nm}  {os.path.getsize(p) // 1024} KB')


if __name__ == '__main__':
    main()
