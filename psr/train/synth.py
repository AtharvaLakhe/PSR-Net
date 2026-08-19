"""Training data for a place with no ground truth.

Nobody has photographed the floor of a permanently shadowed region in reflected
sunlight, so there is no clean image to regress toward. The way out is the one
the published work takes: model the scene and the sensor precisely enough to
generate exactly-paired examples, then learn the inverse of a degradation you
defined.

Two halves, split by cost:

  SCENES, generated once and cached. Terrain is expensive — crater and boulder
  populations drawn from published size-frequency laws, then a diffuse
  wall-scattering illumination model. A few hundred of these is a bank.

  SENSOR, applied fresh on every sample. Shot noise, dark, read noise, PRNU,
  column fixed pattern, PSF, TDI smear and 12-bit quantisation, with every
  parameter drawn from a range wider than the nominal values. This is the part
  the network must invert, so it must never see the same realisation twice.

A model that only works at the nominal parameters has learned the simulator.
The ranges below are deliberately wider than Chandrayaan-2 OHRC's actual
figures for that reason.
"""
import os

import numpy as np
from scipy.ndimage import gaussian_filter, zoom as ndzoom

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, 'bank')

# nominal OHRC, and the range each parameter is sampled from during training
OHRC = dict(read_noise_e=28.0, dark_e_per_s=180.0, prnu=0.012,
            full_well_e=95000.0, bits=12, smear_px=2.4, tdi=64, line_us=290.0)
RANGES = dict(
    psf_sigma=(0.55, 1.9),        # optical blur, in pixels
    smear_px=(1.0, 4.2),          # along-track TDI mismatch
    read_noise_e=(16.0, 44.0),
    dark_scale=(0.4, 2.5),
    prnu=(0.004, 0.024),
    col_offset_e=(3.0, 18.0),
    col_gain=(0.003, 0.018),
    secondary=(1e-4, 6e-3),       # log-uniform: how much wall light gets in
    exposure=(0.45, 1.8),         # gain spread, so the net cannot memorise a level
)


def _value_noise(shape, cells, rng):
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    out = ndzoom(g, (shape[0] / g.shape[0], shape[1] / g.shape[1]), order=3, mode='nearest')
    return out[:shape[0], :shape[1]].astype(np.float32)


def fbm(shape, rng, octaves=7, base=3, gain=0.52):
    out = np.zeros(shape, np.float32)
    amp, norm = 1.0, 0.0
    for _ in range(octaves):
        out += amp * _value_noise(shape, base, rng)
        norm += amp
        amp *= gain
        base *= 2
    return out / norm


def _powerlaw(rng, n, dmin, dmax, slope):
    a = slope - 1.0
    u = rng.random(n)
    return (dmin ** -a + u * (dmax ** -a - dmin ** -a)) ** (-1.0 / a)


def make_scene(seed, n=512, px_m=0.25):
    """One patch of crater floor, as radiance, with no sensor in the way."""
    rng = np.random.default_rng(seed)
    z = (fbm((n, n), rng, 8, 3) - 0.5) * rng.uniform(0.8, 3.2)
    tilt = np.deg2rad(rng.uniform(0.0, 11.0))
    ramp = np.linspace(0, 1, n, dtype=np.float32)
    ang = rng.uniform(0, 2 * np.pi)
    z += (np.cos(ang) * ramp[None, :] + np.sin(ang) * ramp[:, None]) * n * px_m * np.tan(tilt)

    # craters, d^-2.6
    for d_m in _powerlaw(rng, int(rng.uniform(400, 1600)), 0.5, 48.0, 2.6):
        rad = max(1.5, (d_m / px_m) * 0.5)
        cx, cy = rng.integers(0, n, 2)
        R = int(np.ceil(rad * 1.6))
        x0, x1 = max(0, cx - R), min(n, cx + R + 1)
        y0, y1 = max(0, cy - R), min(n, cy + R + 1)
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rr = np.hypot(xx - cx, yy - cy) / rad
        depth = rng.uniform(0.12, 0.23) * (2 * rad * px_m)
        z[y0:y1, x0:x1] += (np.where(rr < 1.0, -depth * (1.0 - rr ** 2), 0.0)
                            + np.where((rr >= 1.0) & (rr < 1.6),
                                       depth * 0.2 * np.exp(-((rr - 1.0) / 0.26) ** 2), 0.0)
                            ).astype(np.float32)

    # boulders, d^-3
    for d_m in _powerlaw(rng, int(rng.uniform(800, 3400)), 0.3, 6.0, 3.0):
        rad = max(0.8, (d_m / px_m) * 0.5)
        cx, cy = rng.integers(0, n, 2)
        R = int(np.ceil(rad * 2.2))
        x0, x1 = max(0, cx - R), min(n, cx + R + 1)
        y0, y1 = max(0, cy - R), min(n, cy + R + 1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rr = np.hypot(xx - cx, yy - cy) / rad
        z[y0:y1, x0:x1] += (rng.uniform(0.3, 0.55) * d_m * np.exp(-rr ** 2 * 1.5)).astype(np.float32)

    gy, gx = np.gradient(z, px_m)
    nrm = np.stack([-gx, -gy, np.ones_like(z)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

    # no beam down here: soft directional light off the sunlit wall, gated by how
    # much sky each spot can see
    sky = np.clip(1.0 - (gaussian_filter(z, 26, mode='nearest') - z) / (px_m * 22.0), 0.04, 1.0)
    a, e = np.deg2rad(rng.uniform(0, 360)), np.deg2rad(rng.uniform(6, 34))
    L = np.array([np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)], np.float32)
    soft = np.clip(nrm @ L, 0, None) * rng.uniform(0.35, 0.7) + rng.uniform(0.3, 0.55)
    albedo = rng.uniform(0.07, 0.16) * (0.85 + 0.3 * fbm((n, n), rng, 5, 6))
    return (albedo * soft * sky).astype(np.float32)


def degrade(clean, rng):
    """Radiance -> DN, in the order the sensor does it. The optics smear the
    photons before the detector counts them, so blur goes first and noise second;
    the other way round hands a denoiser noise the PSF has conveniently
    correlated for it, and flatters the result."""
    n = clean.shape[0]
    p = {k: rng.uniform(*v) for k, v in RANGES.items() if k != 'secondary'}
    sec = float(np.exp(rng.uniform(np.log(RANGES['secondary'][0]), np.log(RANGES['secondary'][1]))))

    rad = clean * sec
    sm = gaussian_filter(rad, p['psf_sigma'], mode='nearest')
    k = int(round(p['smear_px']))
    if k > 1:                                       # along-track smear is a box
        pad = np.pad(sm, ((k // 2, k // 2), (0, 0)), mode='edge')
        sm = np.mean([pad[i:i + n] for i in range(k)], 0).astype(np.float32)

    # gain set so a bright scene lands mid-well, then jittered
    ref = max(float(np.percentile(clean, 99.5)), 1e-9)
    gain = (0.7 * OHRC['full_well_e'] / ref) * p['exposure']
    e = np.clip(sm * gain, 0, None)
    dark = OHRC['dark_e_per_s'] * OHRC['line_us'] * 1e-6 * OHRC['tdi'] * p['dark_scale']

    sig = rng.poisson(e + dark).astype(np.float32)
    sig += rng.normal(0, p['read_noise_e'], (n, n)).astype(np.float32)
    sig *= 1.0 + rng.normal(0, p['prnu'], (n, n)).astype(np.float32)
    sig += rng.normal(0, p['col_offset_e'], (1, n)).astype(np.float32)
    sig *= 1.0 + rng.normal(0, p['col_gain'], (1, n)).astype(np.float32)

    dn_per_e = (2 ** OHRC['bits'] - 1) / OHRC['full_well_e']
    dn = np.clip(np.round(sig * dn_per_e), 0, 2 ** OHRC['bits'] - 1).astype(np.float32)

    # The target is the same scene through a perfect sensor: same light, same
    # gain, no noise, no blur, no quantisation. Recovering that is the job.
    target = np.clip(rad * gain * dn_per_e, 0, 2 ** OHRC['bits'] - 1).astype(np.float32)
    return dn, target


def normalise_pair(dn, target):
    """Both sides scaled by the same robust statistic of the INPUT. The network
    never sees the target's scale, because at inference there is no target."""
    lo = np.percentile(dn, 1.0)
    hi = np.percentile(dn, 99.8)
    span = max(hi - lo, 1e-3)
    x = (dn - lo) / span
    tlo = np.percentile(target, 1.0)
    tspan = max(np.percentile(target, 99.8) - tlo, 1e-6)
    y = (target - tlo) / tspan
    return x.astype(np.float32), y.astype(np.float32)


def build_bank(count=320, n=512, workers=None):
    os.makedirs(BANK, exist_ok=True)
    todo = [i for i in range(count) if not os.path.exists(os.path.join(BANK, f'{i:04d}.npy'))]
    if not todo:
        return count
    from concurrent.futures import ProcessPoolExecutor
    workers = workers or max(2, (os.cpu_count() or 8) - 2)
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for i, arr in zip(todo, ex.map(_one, [(i, n) for i in todo], chunksize=2)):
            np.save(os.path.join(BANK, f'{i:04d}.npy'), arr)
            if i % 20 == 0:
                print(f'  scene {i}/{count}', flush=True)
    return count


def _one(args):
    i, n = args
    return make_scene(1000 + i, n=n)


if __name__ == '__main__':
    import sys
    c = int(sys.argv[1]) if len(sys.argv) > 1 else 320
    print(f'building {c} scenes into {BANK}')
    build_bank(c)
    print('done')
