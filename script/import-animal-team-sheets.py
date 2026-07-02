#!/usr/bin/env python3
import json
import os
import shutil
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:
    raise SystemExit("Pillow is required: python3 -m pip install --user pillow") from exc


ROOT = Path(__file__).resolve().parent.parent
# in-repo source sheets (decoupled from the build output); env override allowed
SOURCE_DIR = Path(
    os.environ.get("ANIMAL_SHEET_DIR", str(ROOT / "assets-src" / "team-sheets"))
)
RUNTIME_DATA = ROOT / "match-runtime-assets-source" / "data"
EXTRACTED_DIR = ROOT / "docs" / "assets" / "animal-transparent-revised" / "extracted-runtime"

TEAMS = {
    "brazil": "巴西.png",
    "germany": "德国.png",
    "france": "法国.png",
    "usa": "美国.png",
    "england": "英格兰.png",
    "portugal": "葡萄牙.png",
    "spain": "西班牙 2.png",
    "argentina": "阿根廷.png",
}

RACE_CELLS = {
    "head.png": (0, 0, 81, 77),
    "head_back.png": (0, 1, 81, 77),
    "neck.png": (0, 2, 20, 18),
    "arm_left.png": (0, 3, 14, 11),
    "arm_right.png": (1, 0, 15, 17),
    "hand_left.png": (1, 1, 25, 28),
    "hand_right.png": (1, 2, 23, 38),
    "knee.png": (1, 3, 8, 9),
}

KIT_CELLS = {
    "shirt_front.png": (2, 0, 56, 52),
    "shirt_back.png": (2, 1, 56, 52),
    "sleeve_left.png": (2, 2, 14, 22),
    "sleeve_right.png": (2, 3, 23, 18),
    "shorts.png": (3, 0, 55, 8),
    "shorts_leg.png": (3, 1, 12, 16),
    "socks.png": (3, 2, 11, 14),
    "shoes.png": (3, 3, 16, 6),
}

KIT_COPY_NAMES = {
    "shirt_front.png": ["shirt_front.png"],
    "shirt_back.png": ["shirt_back.png"],
    "sleeve_left.png": ["sleeve_left.png"],
    "sleeve_right.png": ["sleeve_right.png"],
    "shorts.png": ["shorts.png"],
    "shorts_leg.png": ["shorts_leg_left.png", "shorts_leg_right.png"],
    "socks.png": ["socks.png", "socks_left.png", "socks_right.png"],
    "shoes.png": ["shoes_left.png", "shoes_right.png"],
}


def cell_bounds(image, row, col):
    width, height = image.size
    x0 = round(col * width / 4)
    x1 = round((col + 1) * width / 4)
    y0 = round(row * height / 4)
    y1 = round((row + 1) * height / 4)
    return x0, y0, x1, y1


def extract_cell(image, row, col):
    """Cut one grid cell, drop the black label box, return the tight art crop.

    The old version cut everything below 68% of the cell and shaved fixed
    margins — that amputated bottoms/edges of larger parts (the in-game
    "missing limbs" bug). Now: erase only a thin border band (grid lines),
    locate the opaque BLACK label box by row scan and cut exactly there,
    then take the full alpha bbox.
    """
    x0, y0, x1, y1 = cell_bounds(image, row, col)
    cell = image.crop((x0, y0, x1, y1)).convert("RGBA")
    width, height = cell.size
    px = cell.load()

    # erase the card border ring: strokes sit ~4-7px inside the cell, so a
    # 3.5% inset band per axis wipes them without touching the art
    bx = max(6, round(width * 0.035))
    by = max(6, round(height * 0.035))
    for yy in range(height):
        for xx in range(width):
            if xx < bx or yy < by or xx >= width - bx or yy >= height - by:
                r, g, b, a = px[xx, yy]
                px[xx, yy] = (r, g, b, 0)

    # find the label: topmost row in the lower half where dark opaque pixels dominate
    label_top = height
    for yy in range(height // 2, height):
        dark = 0
        for xx in range(0, width, 2):
            r, g, b, a = px[xx, yy]
            if a > 200 and r + g + b < 120:
                dark += 1
        if dark > (width // 2) * 0.35:
            label_top = yy
            break
    if label_top < height:
        for yy in range(max(0, label_top - 2), height):
            for xx in range(width):
                r, g, b, a = px[xx, yy]
                px[xx, yy] = (r, g, b, 0)

    # keep only the largest connected blob: card borders and stray label
    # leftovers are thin strokes with far fewer pixels than the part art
    cell = largest_component(cell)

    bbox = cell.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"no foreground found at row={row} col={col}")
    return cell.crop(bbox)


def largest_component(cell):
    width, height = cell.size
    alpha = list(cell.getchannel("A").getdata())
    seen = bytearray(width * height)
    best = None
    for start in range(width * height):
        if seen[start] or alpha[start] < 16:
            continue
        stack = [start]
        seen[start] = 1
        blob = []
        while stack:
            cur = stack.pop()
            blob.append(cur)
            cx, cy = cur % width, cur // width
            for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                if 0 <= nx < width and 0 <= ny < height:
                    ni = ny * width + nx
                    if not seen[ni] and alpha[ni] >= 16:
                        seen[ni] = 1
                        stack.append(ni)
        # frame detection: the card border ring spans nearly the whole cell;
        # real part art never does. Skip frames outright.
        xs = [b % width for b in blob]
        ys = [b // width for b in blob]
        span_w = (max(xs) - min(xs)) / width
        span_h = (max(ys) - min(ys)) / height
        if span_w > 0.75 and span_h > 0.75:
            continue
        # line-like fragment (one surviving border side / divider stroke)
        bw = max(xs) - min(xs) + 1
        bh = max(ys) - min(ys) + 1
        if (span_w > 0.5 and bh <= 8) or (span_h > 0.5 and bw <= 8):
            continue
        if best is None or len(blob) > len(best):
            best = blob
    if not best:
        return cell
    keep = bytearray(width * height)
    for i in best:
        keep[i] = 1
    px = cell.load()
    for yy in range(height):
        base = yy * width
        for xx in range(width):
            if not keep[base + xx]:
                r, g, b, a = px[xx, yy]
                if a:
                    px[xx, yy] = (r, g, b, 0)
    return cell


def fit_to_canvas(image, width, height):
    """Stretch the art to FILL the spec canvas exactly.

    Source part textures fill their canvases edge-to-edge, and the engine
    maps the whole texture onto the attachment quad — letterboxing made every
    part render smaller than the intended spec. Slight aspect distortion is
    the faithful trade-off.
    """
    if image.width <= 0 or image.height <= 0:
        return Image.new("RGBA", (width, height), (0, 0, 0, 0))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def save_component(sheet, team, name, spec, target_dir):
    row, col, width, height = spec
    art = extract_cell(sheet, row, col)
    if name == "shorts.png":
        # original pelvis_shorts is a 55x8 waistband strip; the sheet draws
        # full shorts — keep the upper 38% (waist) and let shorts_leg parts
        # carry the legs, like the rig does.
        art = art.crop((0, 0, art.width, max(1, int(art.height * 0.38))))
    component = fit_to_canvas(art, width, height)
    target = target_dir / name
    target.parent.mkdir(parents=True, exist_ok=True)
    component.save(target)
    return component


def write_preview(team, components):
    cell_w, cell_h = 120, 92
    labels = list(components.keys())
    preview = Image.new("RGBA", (cell_w * 4, cell_h * 4), (28, 28, 28, 255))
    draw = ImageDraw.Draw(preview)
    for index, label in enumerate(labels):
        col = index % 4
        row = index // 4
        x = col * cell_w
        y = row * cell_h
        draw.rectangle((x, y, x + cell_w - 1, y + cell_h - 1), outline=(98, 98, 98, 255), width=1)
        img = components[label]
        preview.alpha_composite(img, (x + (cell_w - img.width) // 2, y + 10))
        draw.text((x + 6, y + cell_h - 16), label.replace(".png", ""), fill=(238, 238, 238, 255))
    out = EXTRACTED_DIR / f"{team}_preview.png"
    preview.save(out)


def copy_kit_component(team_dir, source_name, image):
    for kit_name in ["home", "away", "goalkeeper"]:
        kit_dir = team_dir / kit_name
        if not kit_dir.exists():
            continue
        for target_name in KIT_COPY_NAMES[source_name]:
            image.save(kit_dir / target_name)


ORIGINAL_KIT_DIMS = {
    "arm_left_sleeve": (14, 22),
    "arm_right_sleeve": (23, 18),
    "shirt_back": (56, 52),
    "shirt_front": (56, 52),
    "leg_left_shoe": (16, 6),
    "leg_left_shorts": (12, 16),
    "leg_left_sock": (11, 14),
    "leg_right_shoe": (16, 6),
    "leg_right_shorts": (12, 16),
    "leg_right_sock": (11, 14),
    "number": (33, 18),
    "pelvis_shorts": (55, 8),
    "hand_left_glove": (26, 24),
    "hand_right_glove": (26, 25),
}


def normalize_team_race(team, team_dir):
    team_file = team_dir / "team.json"
    if not team_file.exists():
        return
    data = json.loads(team_file.read_text())
    # restore original-spec attachment dims (a previous pass drifted some)
    for kit in data.get("kits", {}).values():
        for part, value in kit.items():
            if isinstance(value, dict) and part in ORIGINAL_KIT_DIMS:
                value["width"], value["height"] = ORIGINAL_KIT_DIMS[part]
    data["players"] = [
        {
            "race": team,
            "role": player.get("role"),
            "skin": {},
        }
        for player in data.get("players", [])
    ]
    team_file.write_text(json.dumps(data, indent=4) + "\n")


def main():
    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)
    base_race = json.loads((RUNTIME_DATA / "player" / "races" / "skeleton" / "race.json").read_text())
    race_template = {
        key: base_race[key]
        for key in [
            "arm_left",
            "arm_right",
            "hand_left",
            "hand_right",
            "head_front",
            "head_back",
            "leg_left_knee",
            "leg_right_knee",
            "neck",
        ]
    }
    race_template["full_head"] = True

    for obsolete in ["sheet_a", "sheet_b"]:
        shutil.rmtree(RUNTIME_DATA / "player" / "races" / obsolete, ignore_errors=True)

    for team, filename in TEAMS.items():
        sheet_path = SOURCE_DIR / filename
        sheet = Image.open(sheet_path).convert("RGBA")
        race_dir = RUNTIME_DATA / "player" / "races" / team
        team_dir = RUNTIME_DATA / "teams" / team
        race_dir.mkdir(parents=True, exist_ok=True)

        components = {}
        for name, spec in RACE_CELLS.items():
            components[name] = save_component(sheet, team, name, spec, race_dir)
        (race_dir / "race.json").write_text(json.dumps(race_template, indent=4) + "\n")

        for name, spec in KIT_CELLS.items():
            image = save_component(sheet, team, name, spec, EXTRACTED_DIR / team)
            components[name] = image
            copy_kit_component(team_dir, name, image)

        normalize_team_race(team, team_dir)
        write_preview(team, components)
        print(f"imported {team} from {filename}")


if __name__ == "__main__":
    main()
