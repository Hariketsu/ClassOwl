#!/usr/bin/env python
"""生成 macOS 风格圆角矩形应用图标。

用法：
    .venv/bin/python scripts/make-icon.py <输出.png> [--base #181d26] [--scale 0.62]

底板为 1024×1024 圆角矩形（半径约 22.37%，贴 macOS squircle 观感），
猫头鹰图形取 build-resources/icon.png（已带透明通道），居中缩放到 --scale 比例。
4 倍超采样绘制后降采样，保证边缘抗锯齿。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SUPER = 4  # 超采样倍数
RADIUS_RATIO = 0.2237  # macOS 圆角矩形半径约占边长 22.37%

ROOT = Path(__file__).resolve().parent.parent
GLYPH = ROOT / "build-resources" / "icon.png"


def make_icon(output: Path, base: str, scale: float) -> None:
    canvas = SIZE * SUPER
    radius = int(canvas * RADIUS_RATIO)

    board = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(board)
    draw.rounded_rectangle((0, 0, canvas - 1, canvas - 1), radius=radius, fill=base)

    glyph = Image.open(GLYPH).convert("RGBA")
    bbox = glyph.getbbox()
    if bbox:
        glyph = glyph.crop(bbox)
    target = int(canvas * scale)
    ratio = target / max(glyph.size)
    glyph = glyph.resize(
        (int(glyph.width * ratio), int(glyph.height * ratio)),
        Image.LANCZOS,
    )
    offset = ((canvas - glyph.width) // 2, (canvas - glyph.height) // 2)
    board.alpha_composite(glyph, offset)

    icon = board.resize((SIZE, SIZE), Image.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    icon.save(output)
    print(f"已生成 {output}（底板 {base}，图形占比 {scale:.0%}）")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--base", default="#181d26", help="底板颜色，默认近黑")
    parser.add_argument("--scale", type=float, default=0.62, help="图形占边长比例")
    args = parser.parse_args()
    make_icon(args.output, args.base, args.scale)


if __name__ == "__main__":
    main()
