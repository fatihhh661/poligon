# Çam dalı kartı (branch.png) üretir: Poly Haven pine_tree_01 dal dokusundan
import random, math, sys
from PIL import Image
random.seed(4)
d = Image.open('dist/asset-src/twig_diff.png').convert('RGB')
a = Image.open('dist/asset-src/twig_alpha.png').convert('L')
d.putalpha(a)
def crop(box):
    c = d.crop(box)
    # gri (doygunluğu düşük) atlas artıklarını temizle
    px = c.load()
    for yy in range(c.height):
        for xx in range(c.width):
            r, g, bb_, al = px[xx, yy]
            if al < 90 or max(r, g, bb_) - min(r, g, bb_) < 22:
                px[xx, yy] = (r, g, bb_, 0)
    bb = c.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    return c.crop(bb)
twigA = crop((20, 30, 235, 322))      # dikey dal (çıplak sap kesildi)
twigB = crop((640, 340, 975, 505))    # yatay dal (sap solda)
twigB = twigB.rotate(90, expand=True) # sap altta olacak şekilde
W, H = 1024, 512
card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
# ana sap
from PIL import ImageDraw
dr = ImageDraw.Draw(card)
y0 = H // 2
pts = [(x, y0 + int(6 * math.sin(x / 140))) for x in range(0, W - 60, 4)]
for i in range(len(pts) - 1):
    t = 1 - i / len(pts)
    dr.line([pts[i], pts[i + 1]], fill=(86, 64, 44, 255), width=max(2, int(9 * t)))
def stamp(img, x, y, ang, scale):
    t = img.resize((max(2, int(img.width * scale)), max(2, int(img.height * scale))), Image.LANCZOS)
    # sapı alt-ortada olan sprite: önce dönüş merkezini sap noktasına getir
    pad = Image.new('RGBA', (t.width, t.height * 2), (0, 0, 0, 0))
    pad.paste(t, (0, 0))
    r = pad.rotate(ang, resample=Image.BICUBIC, expand=True)
    card.alpha_composite(r, (int(x - r.width / 2), int(y - r.height / 2)))
n = 70
for i in range(n):
    f = i / n
    x = 30 + f * (W - 120)
    y = y0 + 6 * math.sin(x / 140)
    side = 1 if i % 2 else -1
    ang = side * (35 + random.random() * 45) - 90 * 0  # sapa göre açı
    ang = -90 + side * (30 + random.random() * 40)    # dal ucuna doğru yönelim
    sc = (0.55 + random.random() * 0.25) * (1.0 - f * 0.45)
    stamp(twigA, x, y, ang, sc)
# uç kısmı
for k in range(5):
    stamp(twigA, W - 90 + k * 6, y0 + random.randint(-8, 8), -90 + random.randint(-20, 20), 0.5)
px = card.load()
for yy in range(H):
    for xx in range(W):
        r, g, b_, al = px[xx, yy]
        if al and (max(r, g, b_) - min(r, g, b_) < 26 or al < 100):
            px[xx, yy] = (r, g, b_, 0)
card = card.resize((512, 256), Image.LANCZOS)
card.save('app/assets/tex/branch.png', optimize=True)
prev = Image.new('RGB', card.size, (200, 220, 240)); prev.paste(card, (0, 0), card)
prev.save(sys.argv[1] if len(sys.argv) > 1 else '/tmp/branch_prev.png')
print('ok')
