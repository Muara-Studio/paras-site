// Camera looks and phases 01–03 (CONTRACT.md §6): the mirrored cover video, its grey ghost, a frame history for the time smear.
import * as K from './kit.js';

const TAU = Math.PI * 2;

// Video px → screen CSS px. The picture is mirrored (a selfie) and covers the viewport.
export function toScreen(f, p) {
  const { s, ox, oy } = f.view;
  return [f.w - (p[0] * s + ox), p[1] * s + oy];
}

// Draw the video, or a downscaled copy of it, mirrored over the cover rect.
function cover(f, src, smooth = true) {
  const { ctx, video, view: { s, ox, oy } } = f;
  ctx.save();
  ctx.translate(f.w, 0); ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(src, ox, oy, video.videoWidth * s, video.videoHeight * s);
  ctx.restore();
}

export function drawVideo(f, o = {}) {
  if (!f.video.videoWidth) return;
  f.ctx.save();
  f.ctx.globalAlpha *= o.alpha ?? 1;
  if (o.filter) f.ctx.filter = o.filter;
  cover(f, f.video);
  f.ctx.restore();
}

export function faceBox(f) {
  if (!f.lm) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of f.lm) {
    const [x, y] = toScreen(f, p);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// A square, mirrored grab of the current frame around the face: { img, box: {x, y, s} } in screen px.
export function snapshot(f, size = 512) {
  const b = faceBox(f) ?? { x: f.w / 2 - 150, y: f.h / 2 - 150, w: 300, h: 300 };
  const s = Math.max(b.w, b.h) * 1.15, box = { x: b.x + b.w / 2 - s / 2, y: b.y + b.h / 2 - s / 2, s };
  const img = document.createElement('canvas');
  img.width = img.height = size;
  const g = img.getContext('2d'), k = size / s;
  g.fillStyle = K.C.BLACK; g.fillRect(0, 0, size, size);
  g.scale(k, k); g.translate(-box.x, -box.y);
  drawVideo({ ...f, ctx: g }, {});
  return { img, box };
}

// Frame history: a ring of small canvases, reused, filled at ≤30 fps (~2 s).
const HN = 60, HW = 320;
let hist = [], head = 0, count = 0, histAt = -1;

export function pushHistory(f) {
  const v = f.video;
  if (!v.videoWidth || f.now - histAt < 1 / 30 - 0.004) return;
  histAt = f.now;
  const h = Math.round(HW * v.videoHeight / v.videoWidth);
  if (hist[0]?.height !== h) { hist = Array.from({ length: HN }, () => new OffscreenCanvas(HW, h)); head = count = 0; }
  hist[head].getContext('2d').drawImage(v, 0, 0, HW, h);
  head = (head + 1) % HN; count = Math.min(count + 1, HN);
}

const past = lag => hist[(head - 1 - Math.min(lag, count - 1) + HN) % HN];

// Time smear: concentric rings, each one `lag` frames older than the ring inside it. Low-res on purpose (chunky pixels).
export function smear(f, o = {}) {
  if (!count || !f.video.videoWidth) return;
  const { ctx } = f, n = o.rings ?? 9, lag = o.lag ?? 3;
  const cx = o.cx ?? f.face?.cx ?? f.w / 2, cy = o.cy ?? f.face?.cy ?? f.h / 2, r = o.r ?? (f.face?.r ?? 160) * 1.2;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * (i + 1) / n, 0, TAU);
    if (i) ctx.arc(cx, cy, r * i / n, 0, TAU, true);   // opposite winding cuts the hole: an annulus
    ctx.clip();
    cover(f, past(i * lag), false);
    ctx.restore();
  }
  ctx.restore();
}

// The standby look: the camera as a dark, grey, heavily blurred ghost. Blurring a 96 px copy is far cheaper than a full-screen blur.
let ghostCv;
function ghost(f, alpha = 0.34) {
  const v = f.video;
  if (!v.videoWidth) return;
  const gw = 96, gh = Math.round(gw * v.videoHeight / v.videoWidth);
  if (ghostCv?.height !== gh) ghostCv = new OffscreenCanvas(gw, gh);
  const g = ghostCv.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.5) brightness(0.85) blur(1.5px)';
  g.clearRect(0, 0, gw, gh);
  g.drawImage(v, 0, 0, gw, gh);
  f.ctx.save(); f.ctx.globalAlpha *= alpha; cover(f, ghostCv); f.ctx.restore();
}

function base(f) {
  f.ctx.fillStyle = K.C.DARK; f.ctx.fillRect(0, 0, f.w, f.h);
  ghost(f);
}

// The floor darkens toward the bottom edge, under the subtitle.
function shade(f) {
  const { ctx, w, h } = f, g = ctx.createLinearGradient(0, h * 0.6, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.6, w, h * 0.4);
}

function circle(ctx, x, y, r, color, lw = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

// Tall side brackets, "[ ]", around a box.
function sides(ctx, x, y, w, h, arm, color, lw = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  ctx.moveTo(x + arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + arm, y + h);
  ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h);
  ctx.stroke();
}

// Blob tracking: hollow markers riding spread landmarks (brows, eyes, nose, cheeks, mouth, chin, temples).
const BLOBS = [10, 151, 70, 300, 33, 263, 168, 1, 98, 327, 234, 454, 61, 291, 17, 152, 132, 361];
const FAINT = 'rgba(242,242,242,0.12)';

function blobs(f, a) {
  if (!f.lm || a <= 0) return;
  const { ctx, u, t } = f, rand = K.seeded(7);
  let prev = null;
  ctx.save(); ctx.globalAlpha *= a;
  for (const i of BLOBS) {
    // draw every random number up front so each blob keeps its traits whether or not it shows
    const r = (5 + rand() * 13) * u, ph = rand() * TAU, sp = 0.4 + rand() * 0.6, guide = rand() < 0.3, across = rand() < 0.5, len = (90 + rand() * 320) * u;
    if (Math.sin(t * sp + ph) < 0.15) { prev = null; continue; }  // each blob blinks in and out on its own clock
    const [lx, ly] = toScreen(f, f.lm[i]);
    const x = lx + Math.sin(t * 1.3 + ph) * 5 * u, y = ly + Math.cos(t * 1.1 + ph) * 5 * u;  // a tracker that lags a little
    circle(ctx, x, y, r, 'rgba(242,242,242,0.45)');
    if (prev) K.line(ctx, prev[0], prev[1], x, y, FAINT);
    if (guide) across ? K.line(ctx, x + r, y, x + r + len, y, FAINT) : K.line(ctx, x, y + r, x, y + r + len, FAINT);
    prev = [x, y];
  }
  ctx.restore();
}

export const standby = {
  name: 'standby', step: '01', label: 'PARAS', tone: 'camera', dur: Infinity,
  draw(f) {
    base(f); K.grid(f); shade(f);
    blobs(f, 0.7 * K.smooth(f.t / 1.2));
  },
};

// 02: the grid locks on. Corner brackets snap onto the face box and a fine crosshair marks its centre.
export const approach = {
  name: 'approach', step: '02', label: 'APPROACH', tone: 'camera', dur: Infinity,
  draw(f) {
    const { ctx, w, h, u, t } = f, fc = f.face;
    base(f); K.grid(f); shade(f);
    blobs(f, 0.7 * (1 - K.smooth(t / 0.6)));
    if (!fc) {
      // searching: a dim frame breathing at the centre
      const s = Math.min(w, h) * (0.3 + 0.015 * Math.sin(t * 3));
      K.brackets(ctx, w / 2 - s, h / 2 - s, s * 2, s * 2, 18 * u, K.C.DIM, 1);
      return;
    }
    const k = K.snap(t / 0.5), s = fc.r * K.lerp(1.8, 1.1, k);
    ctx.save(); ctx.globalAlpha *= K.smooth(t / 0.3);
    K.line(ctx, 0, fc.cy, w, fc.cy, 'rgba(242,242,242,0.18)');
    K.line(ctx, fc.cx, 0, fc.cx, h, 'rgba(242,242,242,0.18)');
    K.line(ctx, fc.cx - 10 * u, fc.cy, fc.cx + 10 * u, fc.cy, K.C.TEXT);
    K.line(ctx, fc.cx, fc.cy - 10 * u, fc.cx, fc.cy + 10 * u, K.C.TEXT);
    K.brackets(ctx, fc.cx - s, fc.cy - s, s * 2, s * 2, 18 * u, K.C.TEXT, 1);
    ctx.restore();
  },
};

// 03: a colour circle opens from the face (f.open) over the ghost, smeared through time; ring and counter track it.
let last = null;   // where the circle sits while the face is lost and it closes again

export const reveal = {
  name: 'reveal', step: '03', label: 'DETECTING', tone: 'camera', dur: Infinity,
  enter() { last = null; },
  draw(f) {
    const { ctx, w, h, u, t } = f, p = K.clamp(f.open);
    const fc = last = f.face ?? last ?? { cx: w / 2, cy: h / 2, r: Math.min(w, h) * 0.25 };
    const { cx, cy } = fc, R = fc.r * 1.1;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)), cr = far * K.smooth(p);

    base(f);
    if (cr > 0.5) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.clip();
      drawVideo(f);
      smear(f, { cx, cy, r: cr });
      drawVideo(f, { alpha: K.smooth((p - 0.8) / 0.2) });   // sharpen at the end so 04 starts from the crisp camera
      ctx.restore();
    }
    K.grid(f); shade(f);

    const k = K.snap(t / 0.45), bw = R * K.lerp(1.7, 1.39, k), bh = R * 1.02;
    ctx.save(); ctx.globalAlpha *= K.smooth(t / 0.25);
    sides(ctx, cx - bw, cy - bh, bw * 2, bh * 2, 15 * u, K.C.TEXT);
    K.text(ctx, String(Math.round(p * 100)).padStart(3, '0'), cx + bw, cy - bh - 6 * u, 13 * u, { align: 'right', base: 'bottom' });
    circle(ctx, cx, cy, R, 'rgba(242,242,242,0.3)');
    K.ring(ctx, cx, cy, R, p, K.C.TEXT, 1);
    K.line(ctx, cx, cy - R - 5 * u, cx, cy - R + 5 * u, K.C.TEXT);
    ctx.restore();

    K.text(ctx, 'HOLD STILL', cx, cy + R * 0.68, 24 * u, { align: 'center', base: 'middle', weight: 500, track: 0.12, alpha: K.smooth((p - 0.85) / 0.1) });
  },
};
