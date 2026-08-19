"""Export the trained network and prove the export still computes the same thing.

An ONNX file that loads is not an ONNX file that agrees. Opset choices,
PixelShuffle lowering and fp16 casting all have quiet ways of changing the
answer, so this exports, re-runs both graphs on the same input, and refuses to
ship if they diverge.
"""
import argparse
import json
import os

import numpy as np
import torch

from model import PSRNet, count_params

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, '..', 'model'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', default=os.path.join(HERE, 'runs', 'psrnet_best.pt'))
    ap.add_argument('--out', default=os.path.join(WEB, 'psrnet.onnx'))
    ap.add_argument('--tol', type=float, default=2e-3)
    args = ap.parse_args()

    os.makedirs(WEB, exist_ok=True)
    ck = torch.load(args.ckpt, map_location='cpu')
    width = ck.get('args', {}).get('width', 32)
    net = PSRNet(width=width)
    net.load_state_dict(ck['model'])
    net.eval()
    print(f'checkpoint step {ck["step"]}, best {ck.get("best", float("nan")):.2f} dB, '
          f'{count_params(net):,} parameters')

    # Dynamic height and width: the page runs 512x512, the lab runs crops, and a
    # fixed-shape graph would force tiling for no reason.
    dummy = torch.randn(1, 1, 256, 256)
    torch.onnx.export(
        net, (dummy,), args.out,
        input_names=['input'], output_names=['output'],
        dynamic_axes={'input': {2: 'h', 3: 'w'}, 'output': {2: 'h', 3: 'w'}},
        opset_version=17, do_constant_folding=True, dynamo=False,
    )
    size = os.path.getsize(args.out)
    print(f'wrote {args.out}  {size / 1e6:.2f} MB')

    import onnxruntime as ort
    sess = ort.InferenceSession(args.out, providers=['CPUExecutionProvider'])
    worst = 0.0
    # only multiples of four: the tracer folds the pad branch away, and the
    # browser side pads to that grid before it calls in
    for hw in [(256, 256), (128, 192), (512, 512)]:
        x = np.random.RandomState(hw[0]).randn(1, 1, *hw).astype(np.float32) * 0.3 + 0.5
        with torch.no_grad():
            a = net(torch.from_numpy(x)).numpy()
        b = sess.run(['output'], {'input': x})[0]
        d = float(np.abs(a - b).max())
        worst = max(worst, d)
        print(f'  {hw[0]}x{hw[1]}  max |torch - onnx| = {d:.2e}')
    if worst > args.tol:
        raise SystemExit(f'export disagrees with the model by {worst:.2e} — not shipping it')

    meta = dict(
        params=count_params(net), width=width, step=int(ck['step']),
        best_val_psnr=float(ck.get('best', 0.0)), size_bytes=size,
        opset=17, size_multiple=4,
        input='1x1xHxW float32, percentile-normalised DN; H and W divisible by 4',
        note='Trained on synthetic PSR frames with a randomised OHRC sensor model.',
    )
    with open(os.path.join(WEB, 'psrnet.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    # carry the benchmark next to the weights, so the page quotes a measurement
    # that shipped with the model rather than a number typed into the markup
    bench = os.path.join(HERE, 'runs', 'benchmark.json')
    if os.path.exists(bench):
        import shutil
        shutil.copy(bench, os.path.join(WEB, 'benchmark.json'))
        print('benchmark copied alongside the weights')
    else:
        print('no benchmark yet — run evaluate.py, then export again')

    print('agreement within tolerance; metadata written')


if __name__ == '__main__':
    main()
