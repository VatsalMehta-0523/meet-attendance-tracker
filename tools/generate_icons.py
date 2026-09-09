"""Regenerates icons/icon{16,48,128}.png and icons/icon-alert{16,48,128}.png.

Run from a venv with the dependencies in requirements.txt installed:

    tools\\.venv\\Scripts\\python tools\\generate_icons.py   (Windows)
    tools/.venv/bin/python tools/generate_icons.py           (macOS/Linux)
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"

BG_DARK = (15, 15, 20, 255)      # #0F0F14
ACCENT = (167, 139, 250, 255)    # #A78BFA
WHITE = (240, 240, 245, 255)


def draw_icon(size, alert=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = size * 0.04
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=size * 0.22, fill=BG_DARK)

    cx, cy = size / 2, size * 0.46
    r = size * 0.30
    ring_color = (239, 68, 68, 255) if alert else ACCENT
    ring_width = max(1, int(size * 0.045))

    bell_w = size * 0.34
    bell_h = size * 0.34
    top = cy - bell_h * 0.55

    d.ellipse(
        [cx - size * 0.05, top - size * 0.05, cx + size * 0.05, top + size * 0.03],
        fill=ring_color,
    )

    body_top = top + size * 0.02
    body = [
        (cx - bell_w * 0.5, cy + bell_h * 0.45),
        (cx - bell_w * 0.42, body_top + bell_h * 0.15),
        (cx - bell_w * 0.30, body_top),
        (cx + bell_w * 0.30, body_top),
        (cx + bell_w * 0.42, body_top + bell_h * 0.15),
        (cx + bell_w * 0.5, cy + bell_h * 0.45),
    ]
    d.polygon(body, fill=WHITE)
    d.ellipse(
        [cx - bell_w * 0.16, cy + bell_h * 0.40, cx + bell_w * 0.16, cy + bell_h * 0.62],
        fill=WHITE,
    )

    arc_bbox_outer = [cx - r * 1.55, cy - r * 1.55, cx + r * 1.55, cy + r * 1.55]
    arc_bbox_inner = [cx - r * 1.15, cy - r * 1.15, cx + r * 1.15, cy + r * 1.15]
    d.arc(arc_bbox_outer, start=200, end=340, fill=ring_color, width=ring_width)
    d.arc(
        arc_bbox_inner,
        start=205,
        end=335,
        fill=(ring_color[0], ring_color[1], ring_color[2], 160),
        width=max(1, ring_width - 1),
    )

    if alert:
        dot_r = size * 0.09
        dx, dy = cx + bell_w * 0.42, cy - bell_h * 0.55
        d.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=(239, 68, 68, 255))
        d.ellipse(
            [dx - dot_r * 0.5, dy - dot_r * 0.5, dx + dot_r * 0.5, dy + dot_r * 0.5],
            fill=WHITE,
        )

    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        draw_icon(size, alert=False).save(OUT_DIR / f"icon{size}.png")
        draw_icon(size, alert=True).save(OUT_DIR / f"icon-alert{size}.png")
    print(f"Icons written to {OUT_DIR}")


if __name__ == "__main__":
    main()
