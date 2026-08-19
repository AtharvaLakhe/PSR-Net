"""Learned model versus the deterministic chain, on scenes neither has seen.

The comparison has to be fair or it is worth nothing, so both are given exactly
the same input, both are scored after the same affine fit to the target, and the
held-out scenes are degraded with fixed seeds so the numbers are reproducible.

The classical chain here is a faithful port of the one the web page runs — same
operators, same order, same parameters. If the network wins, it wins against the
real baseline and not against a strawman.
"""
import argparse
import json
import os

import numpy as np
import torch
from scipy.ndimage import gaussian_filter, uniform_filter
from skimage.exposure import equalize_adapthist
from skimage.metrics import structural_similarity

import synth
from model import PSRNet

HERE = os.path.dirname(os.path.abspath(__file__))


# ── the deterministic chain, as the page runs it ───────────────────────────
def radiometric(dn):
    hist, edges = np.histogram(dn, bins=256, range=(0, max(np.percentile(dn, 99.5), 8)))
    mode = edges[int(np.argmax(hist[:64]))]
    return dn - mode


def destripe(a):
    smooth = gaussian_filter(a, 6, mode='nearest')
    resid = a - smooth
    return a - np.median(resid, axis=0, keepdims=True)


def guided(a, radius=6, eps=9.0):
    mean = uniform_filter(a, radius * 2 + 1, mode='nearest')
    mean_sq = uniform_filter(a * a, radius * 2 + 1, mode='nearest')
    var = np.maximum(mean_sq - mean * mean, 0)
    A = var / (var + eps)
    B = mean - A * mean
    return uniform_filter(A, radius * 2 + 1, mode='nearest') * a + \
        uniform_filter(B, radius * 2 + 1, mode='nearest')


def retinex(a, scales=(22, 60, 140)):
    lo = max(np.percentile(a, 1), 0)
    norm = np.maximum(a - lo, 0) + 1e-3
    out = np.zeros_like(a)
    for s in scales:
        out += np.log(norm) - np.log(gaussian_filter(norm, s, mode='nearest') + 1e-3)
    return out / len(scales)


def richardson_lucy(a, sigma=1.35, iters=24):
    lo = a.min() - 1e-3
    obs = a - lo
    est = obs.copy()
    for _ in range(iters):
        conv = gaussian_filter(est, sigma, mode='nearest')
        est = np.maximum(est * gaussian_filter(obs / np.maximum(conv, 1e-6), sigma, mode='nearest'), 0)
    return est + lo


def clahe(a, clip=2.6):
    lo, hi = np.percentile(a, 0.2), np.percentile(a, 99.8)
    x = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    return equalize_adapthist(x, kernel_size=a.shape[0] // 8, clip_limit=clip / 100 * 2.6, nbins=128)


def classical(dn):
    x = radiometric(dn)
    x = destripe(x)
    x = guided(x)
    x = retinex(x)
    x = richardson_lucy(x)
    return clahe(x)


# ── scoring ────────────────────────────────────────────────────────────────
def norm01(a):
    lo, hi = np.percentile(a, 0.5), np.percentile(a, 99.5)
    return np.clip((a - lo) / max(hi - lo, 1e-9), 0, 1)


def affine_fit(x, y):
    """Enhancement is not asked to reproduce the target's tone curve, only its
    structure, so both are put on a common scale before the error is taken. Same
    convention the page uses, applied identically to every method here."""
    A = np.stack([x.ravel(), np.ones(x.size)], 1)
    coef, *_ = np.linalg.lstsq(A, y.ravel(), rcond=None)
    return np.clip(coef[0] * x + coef[1], 0, 1)


def scores(pred, target):
    p = affine_fit(norm01(pred), target)
    mse = float(np.mean((p - target) ** 2))
    return (10 * np.log10(1.0 / max(mse, 1e-12)),
            float(structural_similarity(p, target, data_range=1.0)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', default=os.path.join(HERE, 'runs', 'psrnet_best.pt'))
    ap.add_argument('--scenes', type=int, default=24)
    ap.add_argument('--size', type=int, default=384)
    ap.add_argument('--out', default=os.path.join(HERE, 'runs', 'benchmark.json'))
    args = ap.parse_args()

    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    ck = torch.load(args.ckpt, map_location=dev)
    net = PSRNet(width=ck.get('args', {}).get('width', 32)).to(dev).eval()
    net.load_state_dict(ck['model'])

    files = sorted(os.path.join(synth.BANK, f) for f in os.listdir(synth.BANK)
                   if f.endswith('.npy'))[:args.scenes]
    rows = {'raw': [], 'classical': [], 'learned': []}

    for i, f in enumerate(files):
        rng = np.random.default_rng(50_000 + i)          # fixed: reproducible
        scene = np.load(f)[:args.size, :args.size]
        dn, target = synth.degrade(scene, rng)
        x, y = synth.normalise_pair(dn, target)
        y = np.clip(y, 0, 1)

        rows['raw'].append(scores(x, y))
        rows['classical'].append(scores(classical(dn.astype(np.float32)), y))
        with torch.no_grad():
            t = torch.from_numpy(x)[None, None].to(dev)
            out = net(t).float().cpu().numpy()[0, 0]
        rows['learned'].append(scores(out, y))
        print(f'  scene {i:2d}  raw {rows["raw"][-1][0]:5.2f}  '
              f'classical {rows["classical"][-1][0]:5.2f}  learned {rows["learned"][-1][0]:5.2f} dB',
              flush=True)

    summary = {}
    for k, v in rows.items():
        a = np.array(v)
        summary[k] = dict(psnr=float(a[:, 0].mean()), psnr_std=float(a[:, 0].std()),
                          ssim=float(a[:, 1].mean()), ssim_std=float(a[:, 1].std()))
    summary['gain_over_raw_db'] = summary['learned']['psnr'] - summary['raw']['psnr']
    summary['gain_over_classical_db'] = summary['learned']['psnr'] - summary['classical']['psnr']
    summary['scenes'] = len(files)
    summary['size'] = args.size
    summary['step'] = int(ck['step'])

    print('\n  method      PSNR dB        SSIM')
    for k in ('raw', 'classical', 'learned'):
        s = summary[k]
        print(f'  {k:10s} {s["psnr"]:6.2f} ±{s["psnr_std"]:.2f}   {s["ssim"]:.3f} ±{s["ssim_std"]:.3f}')
    print(f'\n  learned - classical = {summary["gain_over_classical_db"]:+.2f} dB')

    with open(args.out, 'w') as f:
        json.dump(summary, f, indent=1)
    print(f'  wrote {args.out}')


if __name__ == '__main__':
    main()
