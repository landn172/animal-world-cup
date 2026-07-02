// In-match screenshot: grab the current rendered frame and composite a small
// paper-craft score strip on top, then download it as a PNG.
//
// The match renderer is created without `preserveDrawingBuffer`, so reading the
// canvas directly (view.toDataURL) yields a blank frame. Pixi's extract plugin
// re-renders the stage into a fresh 2D canvas, which is the supported way to
// screenshot a live WebGL scene. The React HUD (scoreboard, buttons) is DOM and
// never part of the extract, so we redraw just the score onto the capture.
import { portraitSrc, runtimeHeadSrc } from "../data/teams";

function loadImg(src, fallback) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (!fallback) return resolve(null);
      const fb = new Image();
      fb.onload = () => resolve(fb);
      fb.onerror = () => resolve(null);
      fb.src = fallback;
    };
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function captureMatch(teams) {
  const g = window.__matchGame;
  if (!g || !g.renderer || !g.stage || !g.renderer.extract) return false;

  // current frame -> 2D canvas; downscale to a sensible share width.
  // No target: read the screen framebuffer (the camera-cropped view). Passing
  // g.stage would render the entire stadium instead of what's on screen.
  // Works because the renderer is created with preserveDrawingBuffer:true.
  const src = g.renderer.extract.canvas();
  if (!src || !src.width) return false;
  const scale = Math.min(1, 1600 / src.width);
  const W = Math.round(src.width * scale);
  const H = Math.round(src.height * scale);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(src, 0, 0, W, H);

  // live score from the runtime (same source as the on-screen scoreboard)
  const p = g.pitch;
  const sr = p && p.redTeam ? p.redTeam.score | 0 : 0;
  const sb = p && p.blueTeam ? p.blueTeam.score | 0 : 0;
  const minute = p ? Math.min(90, Math.floor((p.matchTime || 0) / 60)) : 0;

  const [hr, hb, fr, fb] = await Promise.all([
    loadImg(portraitSrc(teams.red), runtimeHeadSrc(teams.red)),
    loadImg(portraitSrc(teams.blue), runtimeHeadSrc(teams.blue)),
    loadImg(`/match-runtime-min/data/teams/${teams.red}/flag.png`),
    loadImg(`/match-runtime-min/data/teams/${teams.blue}/flag.png`),
  ]);

  // --- paper-craft score strip, centered at the top ---
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const u = Math.max(0.62, W / 1600);
  const headR = 30 * u;
  const flagW = 42 * u, flagH = 28 * u;
  const gap = 14 * u;
  const numFont = `900 ${Math.round(60 * u)}px ${font}`;
  const clockFont = `800 ${Math.round(26 * u)}px ${font}`;

  ctx.font = numFont;
  const wR = ctx.measureText(String(sr)).width;
  const wB = ctx.measureText(String(sb)).width;
  ctx.font = clockFont;
  const wClock = ctx.measureText(`${minute}'`).width;

  const clockPad = 10 * u;
  const segs = [flagW, 2 * headR, wR, wClock + clockPad * 2, wB, 2 * headR, flagW];
  const total = segs.reduce((a, b) => a + b, 0) + gap * (segs.length - 1);
  const padX = 28 * u;
  const pillW = total + padX * 2;
  const pillH = Math.max(2 * headR + 20 * u, 86 * u);
  const pillX = 18 * u; // broadcast style: top-left, matching the live scoreboard
  const pillY = 18 * u;
  const cy = pillY + pillH / 2;

  ctx.fillStyle = "rgba(255,254,248,0.94)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 22 * u);
  ctx.fill();
  ctx.lineWidth = 4 * u;
  ctx.strokeStyle = "rgba(120,90,50,0.30)";
  ctx.stroke();

  let x = pillX + padX;
  const drawFlag = (img) => {
    if (img) ctx.drawImage(img, x, cy - flagH / 2, flagW, flagH);
    x += flagW + gap;
  };
  const drawHead = (img) => {
    const hx = x + headR;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, cy, headR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.clip();
    if (img) {
      const s = Math.max((2 * headR) / img.width, (2 * headR) / img.height);
      ctx.drawImage(img, hx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(hx, cy, headR, 0, Math.PI * 2);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = "rgba(93,144,56,0.55)";
    ctx.stroke();
    x += 2 * headR + gap;
  };
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const drawNum = (n) => {
    ctx.font = numFont;
    ctx.fillStyle = "#4f8a2f";
    ctx.fillText(String(n), x, cy + 2 * u);
    x += ctx.measureText(String(n)).width + gap;
  };
  const drawClock = () => {
    // grass-green clock pill, matching the live scoreboard
    const ph = 40 * u;
    ctx.fillStyle = "#5d9038";
    roundRect(ctx, x, cy - ph / 2, wClock + clockPad * 2, ph, ph / 2);
    ctx.fill();
    ctx.font = clockFont;
    ctx.fillStyle = "#fff7e2";
    ctx.fillText(`${minute}'`, x + clockPad, cy + 2 * u);
    x += wClock + clockPad * 2 + gap;
  };

  drawFlag(fr);
  drawHead(hr);
  drawNum(sr);
  drawClock();
  drawNum(sb);
  drawHead(hb);
  drawFlag(fb);

  await new Promise((res) => {
    cv.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `animal-cup-${teams.red}-vs-${teams.blue}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
      res();
    }, "image/png");
  });
  return true;
}
