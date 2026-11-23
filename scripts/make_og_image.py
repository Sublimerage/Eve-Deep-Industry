"""Builds og-image.png - the 1200x630 picture Discord, Slack, X etc. show under a link to the site.

Run from the repo root:  python scripts/make_og_image.py
Needs Pillow and the Inter font (installed on Windows at C:\\Windows\\Fonts\\Inter-*.ttf; pass
--font-dir to point elsewhere). Drawn at 2x and scaled down so lines and text stay smooth.
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, S = 1200, 630, 2  # final size, supersample factor

BG = (10, 10, 11)
TEXT = (233, 233, 234)
SOFT = (163, 163, 167)
MUTE = (107, 107, 112)
ACCENT = (211, 145, 90)
PANEL = (20, 20, 22)
EDGE = (44, 44, 48)

FEATURES = ["Build costs", "Invention & Tech III", "LP Store", "Ledger", "Jita shopping"]


def font(font_dir, name, size):
    return ImageFont.truetype(os.path.join(font_dir, name), size * S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font-dir", default=r"C:\Windows\Fonts")
    ap.add_argument("--out", default="og-image.png")
    args = ap.parse_args()

    img = Image.new("RGB", (W * S, H * S), BG)

    # Soft copper glow behind the logo, like the site's lit graphite backdrop.
    glow = Image.new("RGB", img.size, BG)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([(-150) * S, (-260) * S, 700 * S, 560 * S], fill=(58, 38, 24))
    glow = glow.filter(ImageFilter.GaussianBlur(140 * S))
    img = Image.blend(img, glow, 0.9)
    d = ImageDraw.Draw(img)

    # Logo tile - the same "one part feeding three" tree glyph as the site's favicon.
    tx, ty, ts = 96, 120, 200
    d.rounded_rectangle([tx * S, ty * S, (tx + ts) * S, (ty + ts) * S], radius=36 * S, fill=PANEL, outline=EDGE, width=2 * S)
    gs = 128  # glyph size inside the tile
    gx, gy = tx + (ts - gs) / 2, ty + (ts - gs) / 2
    k = gs / 24.0  # favicon viewBox is 24x24
    p = lambda x, y: ((gx + x * k) * S, (gy + y * k) * S)
    lw = int(1.7 * k * S)
    for a, b in [((12, 7.6), (12, 10.2)), ((12, 10.2), (6, 15.9)), ((12, 10.2), (12, 15.9)), ((12, 10.2), (18, 15.9))]:
        d.line([p(*a), p(*b)], fill=ACCENT, width=lw)
    r = 2.6 * k * S
    for cx, cy in [(12, 5), (6, 18.5), (12, 18.5), (18, 18.5)]:
        x, y = p(cx, cy)
        d.ellipse([x - r, y - r, x + r, y + r], outline=ACCENT, width=lw)

    # Title + tagline.
    x0 = 352
    d.text((x0 * S, 128 * S), "Eve Deep Industry", font=font(args.font_dir, "Inter-SemiBold.ttf", 78), fill=TEXT)
    d.text((x0 * S, 232 * S), "Industry calculator for EVE Online", font=font(args.font_dir, "Inter-Regular.ttf", 36), fill=SOFT)

    # Feature pills, wrapping onto a second row if needed.
    pf = font(args.font_dir, "Inter-Medium.ttf", 24)
    px, py, gap, row_h = 96, 404, 14, 62
    for label in FEATURES:
        tw = d.textlength(label, font=pf) / S
        w = tw + 44
        if px + w > W - 96:
            px, py = 96, py + row_h
        d.rounded_rectangle([px * S, py * S, (px + w) * S, (py + 48) * S], radius=24 * S, fill=PANEL, outline=EDGE, width=2 * S)
        d.text(((px + 22) * S, (py + 10) * S), label, font=pf, fill=TEXT)
        px += w + gap

    # Address, bottom left, in the accent color.
    d.text((96 * S, 554 * S), "evedeepindustry.com", font=font(args.font_dir, "Inter-Medium.ttf", 26), fill=ACCENT)
    d.text(((W - 96) * S, 554 * S), "Free · no sign-up needed", font=font(args.font_dir, "Inter-Regular.ttf", 24), fill=MUTE, anchor="ra")

    img = img.resize((W, H), Image.LANCZOS)
    img.save(args.out, optimize=True)
    print(f"wrote {args.out} ({os.path.getsize(args.out):,} bytes)")


if __name__ == "__main__":
    main()
