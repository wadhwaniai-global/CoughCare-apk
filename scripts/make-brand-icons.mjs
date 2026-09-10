// Generate launcher icons + splash from the Wadhwani AI Global logo.
//   node scripts/make-brand-icons.mjs [logo.png] [markBox=x0,y0,x1,y1]   (default: public/logo.png)
// Writes: assets/brand/{icon.png,adaptive-foreground.png,splash-logo.png,mark-white.png}
//         android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png
//         android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png
// Pure JS (pngjs only): bilinear resampling, 4x supersampled shapes.
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEAL = [0x0b, 0x82, 0x80];
const src = process.argv[2] || `${ROOT}/public/logo.png`;
const logo = PNG.sync.read(fs.readFileSync(src));

// ---- find the mark: leftmost connected blob of opaque pixels (the starburst) ----
function markBox(png) {
  if (process.argv[3]) return process.argv[3].split(',').map(Number);
  const { width: w, height: h, data: d } = png;
  const cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) cols[x]++;
  let x0 = cols.findIndex(c => c > 0); let x1 = x0;
  let gap = 0; for (let x = x0; x < w; x++) { if (cols[x] > 0) { x1 = x; gap = 0; } else if (++gap > w * 0.02) break; }
  let y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const [mx0, my0, mx1, my1] = markBox(logo);
console.log(`mark box: ${mx0},${my0} -> ${mx1},${my1} (${mx1 - mx0 + 1}x${my1 - my0 + 1})`);

// ---- alpha mask of a region, as Float32 [0..1] using the source alpha ----
function alphaMask(png, x0, y0, x1, y1) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = png.data[((y + y0) * png.width + (x + x0)) * 4 + 3] / 255;
  return { w, h, a: out };
}
function resample(mask, tw, th) { // bilinear
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = (x + 0.5) * mask.w / tw - 0.5, sy = (y + 0.5) * mask.h / th - 0.5;
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(mask.w - 1, x0 + 1), y1 = Math.min(mask.h - 1, y0 + 1);
    const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
    const a = mask.a[y0 * mask.w + x0] * (1 - fx) + mask.a[y0 * mask.w + x1] * fx;
    const b = mask.a[y1 * mask.w + x0] * (1 - fx) + mask.a[y1 * mask.w + x1] * fx;
    out[y * tw + x] = a * (1 - fy) + b * fy;
  }
  return { w: tw, h: th, a: out };
}
/** downscale by integer factor with box filter (for supersampled shapes) */
function boxDown(mask, f) {
  const tw = mask.w / f, th = mask.h / f, out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += mask.a[(y * f + j) * mask.w + x * f + i]; out[y * tw + x] = s / (f * f); }
  return { w: tw, h: th, a: out };
}
function roundedSquareMask(size, radiusFrac, circle = false) {
  const f = 4, S = size * f, r = circle ? S / 2 : S * radiusFrac, out = new Float32Array(S * S), c = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside;
    if (circle) inside = Math.hypot(px - c, py - c) <= c;
    else { const qx = Math.max(Math.abs(px - c) - (c - r), 0), qy = Math.max(Math.abs(py - c) - (c - r), 0); inside = Math.hypot(qx, qy) <= r; }
    out[y * S + x] = inside ? 1 : 0;
  }
  return boxDown({ w: S, h: S, a: out }, f);
}
function canvas(size) { const p = new PNG({ width: size, height: size }); p.data.fill(0); return p; }
function paint(png, mask, color, ox = 0, oy = 0) { // "over" compositing
  for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
    const a = mask.a[y * mask.w + x]; if (a <= 0) continue;
    const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= png.width || Y >= png.height) continue;
    const i = (Y * png.width + X) * 4, da = png.data[i + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) png.data[i + k] = Math.round((color[k] * a + png.data[i + k] * da * (1 - a)) / (oa || 1));
    png.data[i + 3] = Math.round(oa * 255);
  }
}
function write(png, file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, PNG.sync.write(png)); }

const mark = alphaMask(logo, mx0, my0, mx1, my1);
const markAspect = mark.w / mark.h;
function placeMark(png, fracOfCanvas, color) {
  const box = Math.round(png.width * fracOfCanvas);
  const mw = markAspect >= 1 ? box : Math.round(box * markAspect), mh = markAspect >= 1 ? Math.round(box / markAspect) : box;
  paint(png, resample(mark, mw, mh), color, Math.round((png.width - mw) / 2), Math.round((png.height - mh) / 2));
}

// ---- 1. source-of-truth assets for app.config.js ----
const brand = `${ROOT}/assets/brand`;
{ const p = canvas(1024); paint(p, roundedSquareMask(1024, 0.22), TEAL); placeMark(p, 0.62, [255, 255, 255]); write(p, `${brand}/icon.png`); }
{ const p = canvas(1024); placeMark(p, 0.58, [255, 255, 255]); write(p, `${brand}/adaptive-foreground.png`); } // Android safe zone is the inner 66%
{ const p = canvas(1024); placeMark(p, 0.9, [255, 255, 255]); write(p, `${brand}/mark-white.png`); }
{ // splash: full logo recoloured white, transparent background (background colour comes from the resource)
  const full = alphaMask(logo, 0, 0, logo.width - 1, logo.height - 1);
  const W = 1400, H = Math.round(W * full.h / full.w);
  const p = new PNG({ width: W, height: H }); p.data.fill(0); paint(p, resample(full, W, H), [255, 255, 255]); write(p, `${brand}/splash-logo.png`);
}

// ---- 2. Android mipmaps (replace the webp set) ----
const RES = `${ROOT}/android/app/src/main/res`;
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(dens)) {
  const dir = `${RES}/mipmap-${name}`;
  for (const f of ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp']) { try { fs.unlinkSync(`${dir}/${f}`); } catch {} }
  const legacy = Math.round(48 * scale), fg = Math.round(108 * scale);
  { const p = canvas(legacy); paint(p, roundedSquareMask(legacy, 0.22), TEAL); placeMark(p, 0.62, [255, 255, 255]); write(p, `${dir}/ic_launcher.png`); }
  { const p = canvas(legacy); paint(p, roundedSquareMask(legacy, 0, true), TEAL); placeMark(p, 0.6, [255, 255, 255]); write(p, `${dir}/ic_launcher_round.png`); }
  { const p = canvas(fg); placeMark(p, 0.58, [255, 255, 255]); write(p, `${dir}/ic_launcher_foreground.png`); }
}
// splash drawable (xxxhdpi): white full logo, ~1080px wide
{
  const full = alphaMask(logo, 0, 0, logo.width - 1, logo.height - 1);
  const W = 1080, H = Math.round(W * full.h / full.w);
  const p = new PNG({ width: W, height: H }); p.data.fill(0); paint(p, resample(full, W, H), [255, 255, 255]);
  write(p, `${RES}/drawable-xxxhdpi/splashscreen_logo.png`);
}
console.log('icons written');
