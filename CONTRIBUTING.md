# Contributing to PSR-Net

Thanks for looking at this. PSR-Net has two halves and they are contributed to differently.

## The browser pipeline

Everything under the page itself runs client side with no build step. Open the page, scroll, and the deterministic chain executes on the real 12-bit values. To change a restoration stage, edit its module and reload.

## The trained network

The model is 714,401 parameters, trained offline and exported to ONNX. If you change the architecture you must re-export:

    python psr/train/export_onnx.py

## Reproducing the results table

Before proposing a change that claims a metric improvement, reproduce the baseline:

    python psr/train/evaluate.py

The table in the README is measured on 24 held-out scenes with fixed degradation seeds, with both methods scored after the same affine fit to the target. A pull request that reports different numbers should say which of those conditions it changed.

## What makes a good pull request

- State which metric moved and on what data.
- Do not replace a measured claim with an unmeasured one.
- If a change improves SSIM but costs PSNR, say so. Both numbers belong in the table.

## Reporting problems

Open an issue with the scene, the stage, and what you expected. For questions about method rather than defects, use Discussions.