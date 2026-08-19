"""Train PSR-Net on physics it cannot argue with.

Scenes come from a cached bank; the sensor is re-randomised on every single
sample, so the network sees a given piece of terrain many times but never the
same noise, blur, gain or column pattern twice. That is what stops it learning
the simulator instead of the inverse problem.

Validation holds out both: scenes it has never seen, degraded with a fixed seed
so the number is comparable run to run.
"""
import argparse
import json
import math
import os
import time

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

import synth
from model import PSRNet, count_params

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'runs')
VAL_SCENES = 24          # held out from the front of the bank


class Patches(Dataset):
    def __init__(self, files, crop=128, length=20000, train=True):
        self.scenes = [np.load(f, mmap_mode='r') for f in files]
        self.crop = crop
        self.length = length
        self.train = train

    def __len__(self):
        return self.length

    def __getitem__(self, i):
        # a fresh stream per sample in training; a fixed one for validation, so
        # the held-out number means the same thing every time it is printed
        rng = np.random.default_rng(None if self.train else (9000 + i))
        s = self.scenes[rng.integers(len(self.scenes))]
        n = s.shape[0]
        c = self.crop
        y0, x0 = rng.integers(0, n - c, 2)
        clean = np.array(s[y0:y0 + c, x0:x0 + c], dtype=np.float32)

        if self.train:
            k = rng.integers(4)
            if k:
                clean = np.rot90(clean, k)
            if rng.random() < 0.5:
                clean = clean[:, ::-1]
            clean = np.ascontiguousarray(clean)

        dn, target = synth.degrade(clean, rng)
        x, y = synth.normalise_pair(dn, target)
        return torch.from_numpy(x)[None], torch.from_numpy(y)[None]


def charbonnier(a, b, eps=1e-3):
    return torch.sqrt((a - b) ** 2 + eps ** 2).mean()


def grad_loss(a, b):
    """Edges count as much as levels. Without this the network is free to win on
    mean error by smoothing every rim it is not sure about — which is exactly the
    behaviour that loses the boulders."""
    ax = a[:, :, :, 1:] - a[:, :, :, :-1]
    ay = a[:, :, 1:, :] - a[:, :, :-1, :]
    bx = b[:, :, :, 1:] - b[:, :, :, :-1]
    by = b[:, :, 1:, :] - b[:, :, :-1, :]
    return (ax - bx).abs().mean() + (ay - by).abs().mean()


def psnr(a, b):
    mse = F.mse_loss(a, b).item()
    return 10 * math.log10(1.0 / max(mse, 1e-12))


def ssim(a, b, win=11, sigma=1.5):
    coords = torch.arange(win, dtype=a.dtype, device=a.device) - win // 2
    g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
    g = (g / g.sum())
    k = (g[:, None] @ g[None, :])[None, None]
    mu_a, mu_b = F.conv2d(a, k), F.conv2d(b, k)
    saa = F.conv2d(a * a, k) - mu_a ** 2
    sbb = F.conv2d(b * b, k) - mu_b ** 2
    sab = F.conv2d(a * b, k) - mu_a * mu_b
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    s = ((2 * mu_a * mu_b + c1) * (2 * sab + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (saa + sbb + c2))
    return s.mean().item()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--steps', type=int, default=30000)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--crop', type=int, default=128)
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--width', type=int, default=32)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--name', default='psrnet')
    ap.add_argument('--resume', default='')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True

    files = sorted(os.path.join(synth.BANK, f) for f in os.listdir(synth.BANK) if f.endswith('.npy'))
    val_files, train_files = files[:VAL_SCENES], files[VAL_SCENES:]
    print(f'{len(train_files)} train scenes, {len(val_files)} held out', flush=True)

    tr = DataLoader(Patches(train_files, args.crop, length=args.batch * 400, train=True),
                    batch_size=args.batch, num_workers=args.workers, shuffle=True,
                    pin_memory=True, persistent_workers=args.workers > 0, drop_last=True)
    # Validation runs in-process. Two more spawned workers cost a gigabyte each
    # on Windows and the val set is 192 patches — the copy is not worth the RAM,
    # and running out of it mid-validation is how the first attempt died.
    va = DataLoader(Patches(val_files, 192, length=192, train=False),
                    batch_size=8, num_workers=0, shuffle=False)

    net = PSRNet(width=args.width).to(dev).to(memory_format=torch.channels_last)
    print(f'PSR-Net {count_params(net):,} parameters on {dev}', flush=True)

    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4, betas=(0.9, 0.9))
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=args.steps, pct_start=0.05, div_factor=20, final_div_factor=200)
    scaler = torch.amp.GradScaler(dev, enabled=(dev == 'cuda'))

    step = 0
    best = -1e9
    hist = []
    if args.resume and os.path.exists(args.resume):
        ck = torch.load(args.resume, map_location=dev)
        net.load_state_dict(ck['model']); opt.load_state_dict(ck['opt'])
        sched.load_state_dict(ck['sched']); step = ck['step']; best = ck.get('best', best)
        print(f'resumed at step {step}', flush=True)

    def validate():
        net.eval()
        p_out = p_in = s_out = s_in = 0.0
        n = 0
        with torch.no_grad():
            for x, y in va:
                x, y = x.to(dev), y.to(dev)
                with torch.autocast(dev, torch.float16, enabled=(dev == 'cuda')):
                    o = net(x)
                o = o.float().clamp(0, 1.4)
                p_out += psnr(o, y); p_in += psnr(x.clamp(0, 1.4), y)
                s_out += ssim(o, y); s_in += ssim(x.clamp(0, 1.4), y)
                n += 1
        net.train()
        return p_out / n, p_in / n, s_out / n, s_in / n

    t0 = time.time()
    net.train()
    done = False
    while not done:
        for x, y in tr:
            x = x.to(dev, non_blocking=True).to(memory_format=torch.channels_last)
            y = y.to(dev, non_blocking=True).to(memory_format=torch.channels_last)
            with torch.autocast(dev, torch.float16, enabled=(dev == 'cuda')):
                o = net(x)
                loss = charbonnier(o, y) + 0.35 * grad_loss(o, y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            step += 1

            if step % 200 == 0:
                el = time.time() - t0
                print(f'step {step:6d}/{args.steps}  loss {loss.item():.5f}  '
                      f'lr {sched.get_last_lr()[0]:.2e}  {step / max(el, 1):.1f} it/s', flush=True)

            if step % 2000 == 0 or step == args.steps:
                po, pi, so, si = validate()
                hist.append(dict(step=step, psnr=po, psnr_in=pi, ssim=so, ssim_in=si))
                print(f'  VAL step {step}  PSNR {pi:.2f} -> {po:.2f} dB  '
                      f'(+{po - pi:.2f})   SSIM {si:.3f} -> {so:.3f}', flush=True)
                ck = dict(model=net.state_dict(), opt=opt.state_dict(), sched=sched.state_dict(),
                          step=step, best=best, args=vars(args))
                torch.save(ck, os.path.join(OUT, f'{args.name}_last.pt'))
                if po > best:
                    best = po
                    ck['best'] = best
                    torch.save(ck, os.path.join(OUT, f'{args.name}_best.pt'))
                    print(f'  new best {best:.2f} dB', flush=True)
                with open(os.path.join(OUT, f'{args.name}_history.json'), 'w') as f:
                    json.dump(hist, f, indent=1)

            if step >= args.steps:
                done = True
                break

    print(f'finished {step} steps in {(time.time() - t0) / 60:.1f} min, best {best:.2f} dB', flush=True)


if __name__ == '__main__':
    main()
