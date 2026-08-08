#!/usr/bin/env python
"""生成 macOS 风格应用图标（白盘内缩 + 超椭圆 squircle + 接触式投影）。

用法：
    uv run --with pillow --with numpy python scripts/make-icon.py <输出.png>

构图（1024×1024 画布，4 倍超采样绘制后降采样）：
  - 白色 squircle 底板内缩至 80.5%（Apple HIG 图标网格安全区），
    底板用超椭圆（n≈5）近似 Apple 连续曲率，而非圆弧圆角矩形；
  - 底板带极浅纵向渐变（顶部受光）与底部接触式投影；
  - 猫头鹰图形取 frontend/public/brand/mark.png，居中，占底板高度 60%。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
SUPER = 4  # 超采样倍数
CANVAS = SIZE * SUPER

PLATE_RATIO = 0.805   # 底板占画布比例（HIG 安全区）
SQUIRCLE_N = 5.0      # 超椭圆指数，近似 Apple 连续曲率 squircle
OWL_IN_PLATE = 0.60   # 猫头鹰占底板高度比例

# A4 定稿投影参数：紧、下移、接触式托底
SHADOW_BLUR = 8 * SUPER
SHADOW_DY = 6 * SUPER
SHADOW_ALPHA = 80     # ~31%

ROOT = Path(__file__).resolve().parent.parent
OWL = ROOT / "frontend/public/brand/mark.png"


def squircle_mask(size: int, ratio: float) -> Image.Image:
    """居中的超椭圆蒙版（L 模式），边长 = size*ratio。"""
    side = int(size * ratio)
    mask = Image.new("L", (size, size), 0)
    # 超椭圆参数方程：x = a·sign(cos t)·|cos t|^(2/n)
    t = np.linspace(0, 2 * np.pi, 1440)
    a = side / 2
    exp = 2.0 / SQUIRCLE_N
    x = a * np.sign(np.cos(t)) * np.abs(np.cos(t)) ** exp + size / 2
    y = a * np.sign(np.sin(t)) * np.abs(np.sin(t)) ** exp + size / 2
    ImageDraw.Draw(mask).polygon(list(zip(x, y)), fill=255)
    return mask


def vgrad(size: int, top: tuple, bottom: tuple) -> Image.Image:
    """垂直线性渐变 RGB 图。"""
    t = np.linspace(0, 1, size, dtype=np.float32)[:, None]
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    for i in range(3):
        arr[..., i] = (top[i] + (bottom[i] - top[i]) * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def make_icon(output: Path) -> None:
    board = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    # 底板投影（接触式）
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.putalpha(squircle_mask(CANVAS, PLATE_RATIO).point(
        lambda v: v * SHADOW_ALPHA // 255))
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    board.alpha_composite(shadow, (0, SHADOW_DY))

    # 渐变底板
    plate = vgrad(CANVAS, (255, 255, 255), (238, 240, 244)).convert("RGBA")
    plate.putalpha(squircle_mask(CANVAS, PLATE_RATIO))
    board.alpha_composite(plate)

    # 顶部 1px 高光（上边缘亮线）
    edge = ImageChops.subtract(
        squircle_mask(CANVAS, PLATE_RATIO),
        squircle_mask(CANVAS, PLATE_RATIO - 0.004),
    )
    top_half = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(top_half).rectangle((0, 0, CANVAS, CANVAS // 2), fill=255)
    edge = ImageChops.multiply(edge, top_half)
    highlight = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 0))
    highlight.putalpha(edge.point(lambda v: v * 60 // 255))
    board.alpha_composite(highlight)

    # 猫头鹰
    owl = Image.open(OWL).convert("RGBA")
    owl = owl.crop(owl.getbbox())
    target_h = int(CANVAS * PLATE_RATIO * OWL_IN_PLATE)
    ratio = target_h / owl.height
    owl = owl.resize((int(owl.width * ratio), target_h), Image.LANCZOS)
    board.alpha_composite(
        owl, ((CANVAS - owl.width) // 2, (CANVAS - owl.height) // 2))

    icon = board.resize((SIZE, SIZE), Image.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    icon.save(output)
    print(f"已生成 {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    make_icon(args.output)


if __name__ == "__main__":
    main()
