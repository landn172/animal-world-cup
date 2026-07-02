#!/usr/bin/env python3
import math
import os
import random
import struct
import zlib


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "public", "animal-cup", "ui")


def rgba(color):
    if len(color) == 4:
        return color
    return color[0], color[1], color[2], 255


class Image:
    def __init__(self, width, height, fill=(0, 0, 0, 0)):
        self.width = width
        self.height = height
        self.pixels = [rgba(fill)] * (width * height)

    def get(self, x, y):
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return (0, 0, 0, 0)
        return self.pixels[y * self.width + x]

    def set(self, x, y, color):
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        self.pixels[y * self.width + x] = rgba(color)

    def blend(self, x, y, color):
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        sr, sg, sb, sa = rgba(color)
        if sa <= 0:
            return
        if sa >= 255:
            self.set(x, y, (sr, sg, sb, sa))
            return
        dr, dg, db, da = self.get(x, y)
        a = sa / 255.0
        inv = 1.0 - a
        out_a = int(sa + da * inv)
        self.set(
            x,
            y,
            (
                int(sr * a + dr * inv),
                int(sg * a + dg * inv),
                int(sb * a + db * inv),
                out_a,
            ),
        )

    def paste(self, other, x, y):
        for yy in range(other.height):
            for xx in range(other.width):
                self.blend(x + xx, y + yy, other.get(xx, yy))


def save_png(image, path):
    rows = []
    for y in range(image.height):
        row = bytearray([0])
        for x in range(image.width):
            row.extend(image.get(x, y))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", image.width, image.height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def rect(img, x, y, w, h, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            img.blend(xx, yy, color)


def circle(img, cx, cy, r, color):
    r2 = r * r
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2:
                img.blend(x, y, color)


def rounded_mask(x, y, w, h, r, px, py):
    left = x + r
    right = x + w - r - 1
    top = y + r
    bottom = y + h - r - 1
    cx = min(max(px, left), right)
    cy = min(max(py, top), bottom)
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r


def round_rect(img, x, y, w, h, r, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if rounded_mask(x, y, w, h, r, xx, yy):
                img.blend(xx, yy, color)


def border_round_rect(img, x, y, w, h, r, thickness, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if not rounded_mask(x, y, w, h, r, xx, yy):
                continue
            if not rounded_mask(x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, max(1, r - thickness), xx, yy):
                img.blend(xx, yy, color)


def line(img, x1, y1, x2, y2, color, thickness=1):
    steps = int(max(abs(x2 - x1), abs(y2 - y1), 1))
    radius = max(0, thickness // 2)
    for i in range(steps + 1):
        t = i / steps
        x = int(round(x1 + (x2 - x1) * t))
        y = int(round(y1 + (y2 - y1) * t))
        if thickness <= 1:
            img.blend(x, y, color)
        else:
            circle(img, x, y, radius, color)


def gradient_round_rect(img, x, y, w, h, r, top, bottom):
    for yy in range(y, y + h):
        t = (yy - y) / max(h - 1, 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        for xx in range(x, x + w):
            if rounded_mask(x, y, w, h, r, xx, yy):
                img.blend(xx, yy, color)


def triangle(img, points, color):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            pt = (x, y)
            d1 = sign(pt, points[0], points[1])
            d2 = sign(pt, points[1], points[2])
            d3 = sign(pt, points[2], points[0])
            if not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0)):
                img.blend(x, y, color)


def add_noise(img, amount, seed, alpha=18):
    rng = random.Random(seed)
    for _ in range(amount):
        x = rng.randrange(img.width)
        y = rng.randrange(img.height)
        r, g, b, a = img.get(x, y)
        if a:
            d = rng.randrange(-alpha, alpha + 1)
            img.set(x, y, (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)), a))


def scene_field():
    w, h = 1600, 900
    img = Image(w, h, (166, 222, 238, 255))
    for y in range(h):
        t = y / h
        if y < 420:
            c = (
                int(171 * (1 - t) + 236 * t),
                int(224 * (1 - t) + 247 * t),
                int(239 * (1 - t) + 221 * t),
                255,
            )
        else:
            band = 10 if ((y - 420) // 54) % 2 else -8
            c = (106 + band, 175 + band // 2, 84 + band // 3, 255)
        rect(img, 0, y, w, 1, c)

    for cx, cy, scale in [(180, 125, 1.0), (1060, 92, 0.82), (1340, 170, 0.66)]:
        for dx, dy, rr in [(-44, 0, 48), (0, -12, 62), (52, 4, 44), (94, 14, 34)]:
            circle(img, int(cx + dx * scale), int(cy + dy * scale), int(rr * scale), (255, 255, 250, 190))

    for x in range(-120, w + 160, 22):
        y = 386 + int(32 * math.sin(x / 125.0))
        line(img, x, y, x + 180, y - 52, (101, 166, 90, 255), 18)
        line(img, x, y + 26, x + 180, y - 22, (81, 147, 82, 255), 14)

    line(img, 0, 618, w, 512, (242, 255, 228, 78), 16)
    line(img, 0, 642, w, 536, (65, 130, 66, 42), 6)
    line(img, 820, 450, 760, h, (238, 255, 229, 66), 12)
    circle(img, 790, 626, 166, (240, 255, 230, 42))
    circle(img, 790, 626, 148, (91, 161, 73, 90))

    rng = random.Random(7711)
    for _ in range(420):
        x = rng.randrange(w)
        y = rng.randrange(420, h)
        line(img, x, y, x + rng.randrange(-7, 8), y + rng.randrange(5, 12), (59, 119, 54, 64), 2)
    return img


def wood_board(w, h):
    img = Image(w, h)
    round_rect(img, 18, 24, w - 36, h - 42, 28, (82, 46, 25, 230))
    for x in range(36, w - 34, 66):
        base = 142 + (x // 11) % 26
        rect(img, x, 34, 54, h - 65, (base, 86, 48, 255))
        rect(img, x + 4, 42, 6, h - 82, (232, 164, 92, 48))
        line(img, x + 35, 42, x + 14, h - 46, (79, 44, 25, 54), 2)
    round_rect(img, 30, 36, w - 60, h - 66, 20, (194, 126, 70, 160))
    border_round_rect(img, 18, 24, w - 36, h - 42, 28, 8, (74, 40, 22, 255))
    border_round_rect(img, 30, 36, w - 60, h - 66, 20, 2, (246, 184, 107, 108))
    add_noise(img, int(w * h * 0.025), 3001)
    return img


def parchment_panel(w, h):
    img = Image(w, h)
    round_rect(img, 10, 16, w - 20, h - 28, 28, (99, 61, 30, 90))
    gradient_round_rect(img, 8, 8, w - 16, h - 24, 30, (255, 246, 211, 255), (235, 197, 129, 255))
    round_rect(img, 22, 22, w - 44, h - 52, 22, (255, 253, 231, 188))
    border_round_rect(img, 8, 8, w - 16, h - 24, 30, 8, (122, 80, 43, 255))
    border_round_rect(img, 22, 22, w - 44, h - 52, 22, 2, (255, 255, 255, 118))
    for x in range(38, w - 48, 54):
        line(img, x, 34, x + 22, h - 42, (161, 110, 63, 24), 2)
    add_noise(img, int(w * h * 0.04), 4002, 12)
    return img


def dialogue_bubble():
    w, h = 1200, 300
    img = Image(w, h)
    round_rect(img, 24, 34, w - 48, h - 70, 58, (94, 65, 43, 92))
    triangle(img, [(176, h - 58), (238, h - 58), (188, h - 12)], (94, 65, 43, 92))
    round_rect(img, 16, 20, w - 32, h - 68, 58, (255, 247, 218, 255))
    triangle(img, [(174, h - 68), (244, h - 68), (188, h - 18)], (255, 247, 218, 255))
    round_rect(img, 42, 48, w - 84, h - 126, 40, (255, 255, 242, 182))
    border_round_rect(img, 16, 20, w - 32, h - 68, 58, 8, (116, 79, 48, 255))
    border_round_rect(img, 32, 36, w - 64, h - 100, 46, 2, (255, 255, 255, 150))
    add_noise(img, int(w * h * 0.018), 5003, 8)
    return img


def ticket(w, h, tint):
    img = Image(w, h)
    round_rect(img, 8, 12, w - 16, h - 22, 18, (84, 54, 31, 84))
    gradient_round_rect(img, 5, 5, w - 10, h - 18, 18, (255, 251, 228, 255), tint)
    circle(img, 5, h // 2, 15, (0, 0, 0, 0))
    circle(img, w - 5, h // 2, 15, (0, 0, 0, 0))
    border_round_rect(img, 5, 5, w - 10, h - 18, 18, 4, (116, 77, 42, 255))
    for y in range(22, h - 28, 13):
        rect(img, w - 54, y, 3, 6, (117, 79, 45, 80))
    add_noise(img, int(w * h * 0.025), tint[0] + tint[1], 10)
    return img


def button(w, h, top, bottom, edge):
    img = Image(w, h)
    round_rect(img, 9, 13, w - 18, h - 24, 24, (69, 43, 20, 110))
    gradient_round_rect(img, 6, 5, w - 12, h - 22, 24, top, bottom)
    round_rect(img, 28, 12, w - 56, 10, 8, (255, 255, 255, 72))
    round_rect(img, 18, h - 28, w - 36, 13, 12, (80, 48, 17, 44))
    border_round_rect(img, 6, 5, w - 12, h - 22, 24, 5, edge)
    add_noise(img, int(w * h * 0.02), top[0] + bottom[1], 8)
    return img


def stamp(size, top, bottom):
    img = Image(size, size)
    cx = size // 2
    cy = size // 2
    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            d = math.sqrt(dx * dx + dy * dy)
            if d < size * 0.47:
                t = (y / max(size - 1, 1)) * 0.7 + d / size * 0.3
                color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
                img.blend(x, y, color)
            if size * 0.39 < d < size * 0.48:
                img.blend(x, y, (102, 64, 30, 230))
    circle(img, cx - size // 6, cy - size // 7, size // 11, (255, 255, 255, 82))
    add_noise(img, int(size * size * 0.02), top[0] * 10 + bottom[2], 8)
    return img


def atlas():
    img = Image(2048, 1024, (0, 0, 0, 0))
    pieces = [
        (wood_board(640, 230), 24, 22),
        (parchment_panel(610, 410), 24, 286),
        (dialogue_bubble(), 700, 22),
        (ticket(360, 128, (239, 216, 172, 255)), 700, 370),
        (button(420, 120, (255, 223, 103, 255), (235, 156, 52, 255), (105, 67, 27, 255)), 700, 536),
        (stamp(150, (255, 235, 151, 255), (230, 159, 58, 255)), 1140, 390),
        (stamp(150, (242, 111, 91, 255), (185, 57, 50, 255)), 1320, 390),
        (stamp(150, (105, 170, 230, 255), (49, 105, 180, 255)), 1500, 390),
    ]
    for piece, x, y in pieces:
        img.paste(piece, x, y)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    assets = {
        "scene-field.png": scene_field(),
        "wood-board.png": wood_board(640, 230),
        "parchment-panel.png": parchment_panel(610, 410),
        "dialogue-bubble.png": dialogue_bubble(),
        "team-ticket.png": ticket(360, 128, (239, 216, 172, 255)),
        "button-kickoff.png": button(420, 120, (255, 223, 103, 255), (235, 156, 52, 255), (105, 67, 27, 255)),
        "stamp-gold.png": stamp(150, (255, 235, 151, 255), (230, 159, 58, 255)),
        "stamp-red.png": stamp(150, (242, 111, 91, 255), (185, 57, 50, 255)),
        "stamp-blue.png": stamp(150, (105, 170, 230, 255), (49, 105, 180, 255)),
        "ui-atlas.png": atlas(),
    }
    for name, image in assets.items():
        save_png(image, os.path.join(OUT_DIR, name))


if __name__ == "__main__":
    main()
