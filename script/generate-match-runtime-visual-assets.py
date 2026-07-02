#!/usr/bin/env python3
import importlib.util
import math
import os
import random
import subprocess
import tempfile


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSET_SOURCE = os.path.join(ROOT, "match-runtime-assets-source")
UI_GENERATOR = os.path.join(ROOT, "script", "generate-game-ui-assets.py")


def load_ui_tools():
    spec = importlib.util.spec_from_file_location("animal_cup_ui_generator", UI_GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ui = load_ui_tools()


def fill_gradient(img, top, bottom):
    for y in range(img.height):
        t = y / max(img.height - 1, 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        ui.rect(img, 0, y, img.width, 1, color)


def ring(img, cx, cy, radius, color, thickness=3, segments=220):
    last = None
    for step in range(segments + 1):
        a = math.tau * step / segments
        point = (int(round(cx + math.cos(a) * radius)), int(round(cy + math.sin(a) * radius)))
        if last:
            ui.line(img, last[0], last[1], point[0], point[1], color, thickness)
        last = point


def ellipse_ring(img, cx, cy, rx, ry, color, thickness=3, segments=220):
    last = None
    for step in range(segments + 1):
        a = math.tau * step / segments
        point = (int(round(cx + math.cos(a) * rx)), int(round(cy + math.sin(a) * ry)))
        if last:
            ui.line(img, last[0], last[1], point[0], point[1], color, thickness)
        last = point


def draw_seats(img, x, y, w, h, color, seed):
    rng = random.Random(seed)
    ui.rect(img, x, y, w, h, (216, 221, 220, 255))
    row_gap = 16
    seat_w = 10
    seat_h = 8
    for yy in range(y + 8, y + h - 8, row_gap):
        for xx in range(x + 8, x + w - 8, 15):
            shade = rng.randrange(-14, 15)
            ui.round_rect(
                img,
                xx,
                yy,
                seat_w,
                seat_h,
                2,
                (
                    max(0, min(255, color[0] + shade)),
                    max(0, min(255, color[1] + shade)),
                    max(0, min(255, color[2] + shade)),
                    255,
                ),
            )
    for xx in range(x + 36, x + w, 160):
        ui.rect(img, xx, y, 10, h, (235, 237, 234, 255))
        ui.line(img, xx + 10, y, xx + 10, y + h, (170, 174, 172, 255), 2)


def draw_field(img, x, y, w, h):
    ui.rect(img, x - 20, y - 24, w + 40, h + 48, (111, 81, 61, 255))
    ui.rect(img, x, y, w, h, (109, 174, 45, 255))

    for stripe in range(10):
        color = (122, 190, 52, 255) if stripe % 2 == 0 else (97, 158, 42, 255)
        ui.rect(img, x + stripe * w // 10, y, w // 10 + 2, h, color)

    cx = x + w // 2
    cy = y + h // 2
    for radius, alpha in [(325, 52), (245, 45), (165, 38), (86, 32)]:
        ui.circle(img, cx, cy, radius, (186, 220, 76, alpha))

    white = (242, 248, 230, 235)
    line_w = 4
    ui.line(img, x + 76, y + 58, x + w - 76, y + 58, white, line_w)
    ui.line(img, x + w - 76, y + 58, x + w - 76, y + h - 58, white, line_w)
    ui.line(img, x + w - 76, y + h - 58, x + 76, y + h - 58, white, line_w)
    ui.line(img, x + 76, y + h - 58, x + 76, y + 58, white, line_w)
    ui.line(img, cx, y + 58, cx, y + h - 58, white, line_w)
    ring(img, cx, cy, 110, white, line_w)
    ui.circle(img, cx, cy, 5, white)

    box_w = 215
    box_h = 270
    small_w = 82
    small_h = 148
    for side in [0, 1]:
        if side == 0:
            bx = x + 76
            sx = x + 76
            box_inner_x = bx + box_w
            small_inner_x = sx + small_w
        else:
            bx = x + w - 76 - box_w
            sx = x + w - 76 - small_w
            box_inner_x = bx
            small_inner_x = sx
        by = cy - box_h // 2
        sy = cy - small_h // 2
        ui.line(img, bx, by, bx + box_w, by, white, line_w)
        ui.line(img, box_inner_x, by, box_inner_x, by + box_h, white, line_w)
        ui.line(img, bx + box_w, by + box_h, bx, by + box_h, white, line_w)
        ui.line(img, sx, sy, sx + small_w, sy, white, line_w)
        ui.line(img, small_inner_x, sy, small_inner_x, sy + small_h, white, line_w)
        ui.line(img, sx + small_w, sy + small_h, sx, sy + small_h, white, line_w)
        ui.circle(img, bx + (box_w - 60 if side == 0 else 60), cy, 4, white)

    rng = random.Random(9321)
    for _ in range(1800):
        gx = rng.randrange(x + 20, x + w - 20)
        gy = rng.randrange(y + 20, y + h - 20)
        ui.line(img, gx, gy, gx + rng.randrange(-4, 5), gy + rng.randrange(3, 8), (55, 115, 38, 45), 1)


def draw_ad_boards(img, x, y, w, h):
    colors = [
        (45, 106, 188, 255),
        (236, 194, 45, 255),
        (46, 148, 75, 255),
        (75, 68, 63, 255),
        (198, 57, 52, 255),
    ]
    segment = w // len(colors)
    for i, color in enumerate(colors):
        sx = x + i * segment
        ui.rect(img, sx, y, segment + 1, h, color)
        for k in range(5):
            px = sx + 34 + k * 48
            if px + 18 >= sx + segment:
                continue
            ui.circle(img, px, y + h // 2, 7, (255, 255, 255, 180))
            ui.rect(img, px + 12, y + h // 2 - 4, 18, 8, (255, 255, 255, 145))


def stadium_image():
    w, h = 2048, 1024
    img = ui.Image(w, h, (104, 108, 110, 255))
    fill_gradient(img, (132, 136, 138, 255), (86, 90, 93, 255))

    draw_seats(img, 320, 0, 350, 230, (222, 142, 38), 100)
    draw_seats(img, 710, 0, 320, 230, (222, 142, 38), 101)
    draw_seats(img, 1070, 0, 320, 230, (222, 142, 38), 102)
    draw_seats(img, 1430, 0, 300, 230, (222, 142, 38), 103)
    draw_seats(img, 0, 250, 260, 690, (222, 142, 38), 104)
    draw_seats(img, 1788, 250, 260, 690, (222, 142, 38), 105)

    draw_ad_boards(img, 280, 222, 1488, 18)
    draw_field(img, 280, 244, 1488, 666)

    ui.rect(img, 260, 240, 20, 670, (155, 45, 42, 255))
    ui.rect(img, 1768, 240, 20, 670, (155, 45, 42, 255))
    ui.rect(img, 282, 912, 1484, 10, (145, 104, 75, 255))
    ui.rect(img, 0, 940, w, 84, (83, 84, 86, 255))

    for cx in [136, 1912]:
        ui.circle(img, cx, 104, 38, (40, 42, 44, 95))
        ring(img, cx, 100, 28, (233, 234, 232, 255), 8)
        for a in range(0, 360, 45):
            rad = math.radians(a)
            ui.line(img, cx, 100, int(cx + math.cos(rad) * 28), int(100 + math.sin(rad) * 28), (52, 54, 57, 210), 2)

    ui.add_noise(img, int(w * h * 0.018), 8801, 10)
    return img


def save_jpeg_from_png(image, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "stadium.png")
        jpg = os.path.join(tmp, "stadium.jpg")
        ui.save_png(image, png)
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "-z", "2048", "4096", png, "--out", jpg],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        os.replace(jpg, target)


def main():
    save_jpeg_from_png(
        stadium_image(),
        os.path.join(ASSET_SOURCE, "data", "stadiums", "asia", "stadium.jpg"),
    )


if __name__ == "__main__":
    main()
