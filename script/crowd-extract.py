#!/usr/bin/env python3
"""Extract crowd-animal race folders from generated part sheets.

The generated sheets keep the template's OPAQUE dark-grey background (the team
source sheets were transparent). Colour-key it to transparent (the parts'
dark-brown outline survives the threshold), then ERODE the alpha 1px to drop the
anti-aliased bg fringe that otherwise reads as a faint rectangle on the grey
stands. Reuses extract_cell / fit_to_canvas from import-animal-team-sheets.py.
Clothing rows are ignored (the crowd shares the recolored kit).

    /usr/bin/python3 script/crowd-extract.py            # all sheets
    /usr/bin/python3 script/crowd-extract.py panda fox  # only these ids
"""
import importlib.util
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SHEETS = ROOT / "assets-src" / "crowd-sheets"
RACES = ROOT / "match-runtime-assets-source" / "data" / "player" / "races"

spec = importlib.util.spec_from_file_location("team_import", Path(__file__).resolve().parent / "import-animal-team-sheets.py")
ti = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ti)

RACE_CELLS = ti.RACE_CELLS

base_race = json.loads((RACES / "skeleton" / "race.json").read_text())
RACE_TEMPLATE = {k: base_race[k] for k in [
    "arm_left", "arm_right", "hand_left", "hand_right",
    "head_front", "head_back", "leg_left_knee", "leg_right_knee", "neck",
]}
RACE_TEMPLATE["full_head"] = True


def knockout_bg(img):
    """Magenta chroma-key. The sheets are generated on SOLID MAGENTA (FF00FF),
    which collides with no animal colour, so cutting it never eats eyes/ears/
    grey fur the way the old dark-grey key did. alpha 0 where magenta
    (min(R,B)-G is large); despill the magenta-tinted edge toward green."""
    img = img.convert("RGBA")
    r, g, b = img.convert("RGB").split()
    rb = ImageChops.darker(r, b)                 # min(R, B)
    m = ImageChops.subtract(rb, g)               # magenta-ness = min(R,B) - G
    alpha = m.point(lambda v: 0 if v > 55 else (255 if v < 28 else int(255 * (55 - v) / 27)))
    img.putalpha(alpha)
    # despill: pull the leftover magenta fringe (R,B > G) back toward G
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            cr, cg, cb, ca = px[x, y]
            if ca and cr > cg and cb > cg and (min(cr, cb) - cg) > 20:
                px[x, y] = (cg, cg, cg, ca) if False else (min(cr, cg + 18), cg, min(cb, cg + 18), ca)
    return img


def main():
    only = set(sys.argv[1:])
    sheets = sorted(p for p in SHEETS.glob("*.png") if not only or p.stem in only)
    if not sheets:
        raise SystemExit(f"no sheets in {SHEETS}")
    for sheet_path in sheets:
        animal = sheet_path.stem
        sheet = knockout_bg(Image.open(sheet_path))
        race_dir = RACES / animal
        race_dir.mkdir(parents=True, exist_ok=True)
        for name, (row, col, w, h) in RACE_CELLS.items():
            art = ti.extract_cell(sheet, row, col)
            # erode 1px: kill the anti-aliased magenta fringe
            art.putalpha(art.getchannel("A").filter(ImageFilter.MinFilter(3)))
            bbox = art.getchannel("A").getbbox()
            if bbox:
                art = art.crop(bbox)
            ti.fit_to_canvas(art, w, h).save(race_dir / name)
        (race_dir / "race.json").write_text(json.dumps(RACE_TEMPLATE, indent=4) + "\n")
        print(f"extracted {animal}")
    print(f"\n{len(sheets)} crowd races -> {RACES}")


if __name__ == "__main__":
    main()
