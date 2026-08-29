---
name: Bug report
about: Something in the pipeline or the viewer behaves incorrectly
title: ""
labels: bug
---

**Which stage**
Radiometric correction, destripe, guided denoise, retinex, Richardson-Lucy, CLAHE, blob detection, or the ONNX network.

**Which scene**
Scene ID or the input you loaded.

**Expected**
What the output should have been, and how you know.

**Actual**
What happened. Include PSNR/SSIM/CNR readings if the metrics panel was showing.

**Environment**
Browser and version. WebGL and onnxruntime-web behave differently across engines, so this matters.