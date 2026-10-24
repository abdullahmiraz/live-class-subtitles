"""Turn the raw shots in store/build/ into the Chrome Web Store images (store/*.png).
  uv run --no-project --with pillow python store/compose.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = Path(__file__).resolve().parent
B = S / "build"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
NAVY, BLUE, YELLOW = (16, 42, 92), (26, 115, 232), (255, 214, 64)


def gradient(w, h):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(NAVY[i] * (1 - t) + (10, 22, 48)[i] * t) for i in range(3)))
    return im


def shadowed(canvas, img, xy, radius=14):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    sh = Image.new("RGBA", (img.size[0] + 40, img.size[1] + 40), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([20, 24, img.size[0] + 20, img.size[1] + 24], radius, fill=(0, 0, 0, 110))
    from PIL import ImageFilter
    canvas.paste(sh.filter(ImageFilter.GaussianBlur(12)), (xy[0] - 20, xy[1] - 20), sh.filter(ImageFilter.GaussianBlur(12)))
    canvas.paste(img, xy, mask)


def save(im, name):
    im.convert("RGB").save(S / name, optimize=True)
    print("wrote", S / name, im.size)


# 1-2, 4: real pages at 1280x800, as they are
save(Image.open(B / "raw-wordcard.png"), "screenshot-1-panel.png")
save(Image.open(B / "raw-subtitles.png"), "screenshot-2-subtitles.png")
save(Image.open(B / "raw-welcome.png"), "screenshot-4-setup.png")

# 3: the three popup tabs side by side
im = gradient(1280, 800).convert("RGBA")
d = ImageDraw.Draw(im)
d.text((640, 58), "Everything in one small popup", font=ImageFont.truetype(BOLD, 36), fill="white", anchor="mm")
d.text((640, 102), "Basic · Advanced · Extra", font=ImageFont.truetype(REG, 22), fill=(190, 205, 235), anchor="mm")
pops = [Image.open(B / f"raw-popup-{t}.png").convert("RGBA") for t in ("basic", "advanced", "extra")]
k = min(360 / pops[0].size[0], 630 / max(p.size[1] for p in pops))  # same scale for all, whole popup visible
pops = [p.resize((int(p.size[0] * k), int(p.size[1] * k)), Image.LANCZOS) for p in pops]
gap = 40
x = (1280 - sum(p.size[0] for p in pops) - gap * 2) // 2
for p in pops:
    shadowed(im, p, (x, 142))
    x += p.size[0] + gap
save(im, "screenshot-3-settings.png")

# small promo tile 440x280
im = gradient(440, 280).convert("RGBA")
icon = Image.open(S.parent / "extension/icons/128.png").convert("RGBA").resize((112, 112), Image.LANCZOS)
im.paste(icon, (164, 22), icon)
d = ImageDraw.Draw(im)
d.text((220, 160), "Live Class Subtitles", font=ImageFont.truetype(BOLD, 27), fill="white", anchor="mm")
d.text((220, 200), "Russian classes, in your language, live", font=ImageFont.truetype(REG, 17), fill=YELLOW, anchor="mm")
d.text((220, 236), "Free · private · learn as you listen", font=ImageFont.truetype(REG, 15), fill=(190, 205, 235), anchor="mm")
save(im, "promo-small.png")
