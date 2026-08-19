"""PSR-Net: the restoration network.

A NAFNet-style U-Net, deliberately small. Two reasons it is not 22 M parameters:
it has to be downloaded by a web page, and it has to be honest about how much
information is actually present in a frame whose whole dynamic range is a dozen
DN. Capacity beyond what the data supports is capacity available for inventing
detail, which is the failure mode this entire project is designed against.

No attention over long range, no adversarial head, no diffusion prior. The
blocks are depthwise convolution, a SimpleGate (split the channels, multiply
them — a nonlinearity with no activation function to tune) and channel
attention. Everything is residual, so the identity is the easy path and the
network only has to learn the correction.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class SimpleGate(nn.Module):
    """Split the channels in half and multiply. NAFNet's finding is that this
    beats GELU here while costing nothing, and it keeps the graph free of the
    activation functions that ONNX exporters most often disagree about."""

    def forward(self, x):
        a, b = x.chunk(2, dim=1)
        return a * b


class Block(nn.Module):
    def __init__(self, c, expand=2):
        super().__init__()
        d = c * expand
        self.norm1 = nn.GroupNorm(1, c)
        self.conv1 = nn.Conv2d(c, d, 1)
        self.dw = nn.Conv2d(d, d, 3, padding=1, groups=d)
        self.gate = SimpleGate()
        # channel attention: a per-channel gain read off the global average
        self.sca = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Conv2d(d // 2, d // 2, 1))
        self.conv2 = nn.Conv2d(d // 2, c, 1)

        self.norm2 = nn.GroupNorm(1, c)
        self.conv3 = nn.Conv2d(c, d, 1)
        self.conv4 = nn.Conv2d(d // 2, c, 1)

        self.beta = nn.Parameter(torch.zeros(1, c, 1, 1))
        self.gamma = nn.Parameter(torch.zeros(1, c, 1, 1))

    def forward(self, x):
        y = self.conv1(self.norm1(x))
        y = self.gate(self.dw(y))
        y = y * self.sca(y)
        y = self.conv2(y)
        x = x + y * self.beta

        y = self.gate(self.conv3(self.norm2(x)))
        y = self.conv4(y)
        return x + y * self.gamma


class PSRNet(nn.Module):
    def __init__(self, width=32, enc=(2, 2, 4), dec=(2, 2), mid=4):
        super().__init__()
        w = width
        self.head = nn.Conv2d(1, w, 3, padding=1)

        self.enc1 = nn.Sequential(*[Block(w) for _ in range(enc[0])])
        self.down1 = nn.Conv2d(w, w * 2, 2, stride=2)
        self.enc2 = nn.Sequential(*[Block(w * 2) for _ in range(enc[1])])
        self.down2 = nn.Conv2d(w * 2, w * 4, 2, stride=2)
        self.mid = nn.Sequential(*[Block(w * 4) for _ in range(mid)])

        # PixelShuffle upsampling: no transposed-convolution checkerboard, which
        # on a noise-limited frame would be indistinguishable from real texture
        self.up2 = nn.Sequential(nn.Conv2d(w * 4, w * 8, 1, bias=False), nn.PixelShuffle(2))
        self.dec2 = nn.Sequential(*[Block(w * 2) for _ in range(dec[0])])
        self.up1 = nn.Sequential(nn.Conv2d(w * 2, w * 4, 1, bias=False), nn.PixelShuffle(2))
        self.dec1 = nn.Sequential(*[Block(w) for _ in range(dec[1])])

        self.tail = nn.Conv2d(w, 1, 3, padding=1)

    def forward(self, x):
        # pad so both downsamples are exact, then crop back
        _, _, h, wd = x.shape
        ph, pw = (-h) % 4, (-wd) % 4
        if ph or pw:
            x = F.pad(x, (0, pw, 0, ph), mode='reflect')

        inp = x
        e1 = self.enc1(self.head(x))
        e2 = self.enc2(self.down1(e1))
        m = self.mid(self.down2(e2))
        d2 = self.dec2(self.up2(m) + e2)
        d1 = self.dec1(self.up1(d2) + e1)
        # residual: the network predicts the correction, not the picture
        out = self.tail(d1) + inp

        if ph or pw:
            out = out[:, :, :h, :wd]
        return out


def count_params(m):
    return sum(p.numel() for p in m.parameters())


if __name__ == '__main__':
    net = PSRNet()
    x = torch.randn(1, 1, 130, 127)
    y = net(x)
    print('params', f'{count_params(net):,}')
    print('in', tuple(x.shape), '-> out', tuple(y.shape))
