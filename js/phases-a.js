// Steps 04 scan, 05 extract, 06 deconstruct (owner: agent D1). Contract: CONTRACT.md §7, §8.
import * as K from './kit.js';
import * as Cam from './camera.js';
import { TESS, PARTS } from './face.js';

export const CATS = ['EYES', 'NOSE', 'MOUTH', 'CONTOURS'];
const FEATURES = ['EYES', 'NOSE', 'MOUTH'];

// Canonical-mesh indices (eyes + brows, nose, lips), used until face.js has loaded PARTS.
const FALLBACK = {
  EYES: [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173, 263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398, 70, 63, 105, 66, 107, 300, 293, 334, 296, 336],
  NOSE: [1, 2, 4, 5, 6, 19, 45, 48, 64, 94, 97, 98, 115, 168, 195, 197, 220, 275, 278, 294, 326, 327, 344, 440],
  MOUTH: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
};
const part = k => PARTS[k]?.length ? PARTS[k] : FALLBACK[k];

// Pure: a cols×rows rectangle of square tiles over the face box {x,y,w,h}. pts = landmarks in screen px,
// parts = {EYES, NOSE, MOUTH} index lists. A tile takes the feature with 3+ of its landmarks, else CONTOURS;
// tiles no landmark reaches are dropped (the rectangle's empty corners).
export function cutFace(box, pts, parts, cols = 5, rows = 6) {
  const s = box.h * 1.02 / rows, gx = box.x + (box.w - cols * s) / 2, gy = box.y + (box.h - rows * s) / 2;
  const owner = {};
  for (const c of ['EYES', 'MOUTH', 'NOSE']) for (const i of parts[c] ?? []) owner[i] ??= c;
  const cells = Array.from({ length: cols * rows }, () => ({ n: 0, EYES: 0, NOSE: 0, MOUTH: 0 }));
  pts.forEach(([x, y], i) => {
    const c = Math.floor((x - gx) / s), r = Math.floor((y - gy) / s);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const cell = cells[r * cols + c];
    cell.n++;
    if (owner[i]) cell[owner[i]]++;
  });
  const rand = K.seeded(7), count = {}, tiles = [];
  cells.forEach((cell, k) => {
    if (pts.length && !cell.n) return;
    let cat = 'CONTOURS', best = 2;
    for (const c of ['EYES', 'MOUTH', 'NOSE']) if (cell[c] > best) { cat = c; best = cell[c]; }
    count[cat] = (count[cat] ?? 0) + 1;
    tiles.push({
      id: tiles.length, cat, code: `${cat[0]}-${String(count[cat]).padStart(2, '0')}`, mesh: rand() < 0.3,
      home: { x: gx + (k % cols) * s, y: gy + Math.floor(k / cols) * s, s },
    });
  });
  return tiles;
}

// Pure: where each tile lands in 06. One loose block per category, blocks side by side with a shared row count
// (the one giving the biggest tiles), kept between the top chrome and the subtitle.
// Returns {pos: [{x,y,s}] aligned with tiles, heads: [{cat,x,y,w,n}]}.
// shortcut: blocks only sit side by side, so phones get small tiles; stack 2×2 when narrow if that matters.
export function sortLayout(tiles, w, h, u) {
  const groups = CATS.map(cat => tiles.filter(t => t.cat === cat)).filter(g => g.length);
  const top = 150 * u, bottom = h * 0.82 - 48 * u;
  let s = 0, rows = 1, cols = [];
  for (let r = 1; r <= Math.max(1, ...groups.map(g => g.length)); r++) {
    const c = groups.map(g => Math.ceil(g.length / r)), sumCols = c.reduce((a, b) => a + b, 0);
    const fit = Math.min(64 * u, (w - 40 * u) / (sumCols * 1.4 + (groups.length - 1) * 1.1), (bottom - top) / (r * 1.6 + 0.9));
    if (fit > s + 0.5) { s = fit; rows = r; cols = c; }
  }
  s = Math.max(8, s);
  const widths = cols.map(c => c * 1.4 * s - 0.4 * s);
  let x = (w - widths.reduce((a, b) => a + b, 0) - (groups.length - 1) * 1.5 * s) / 2;
  const y = top + Math.max(0, (bottom - top - (rows * 1.6 + 0.9) * s) / 2) + 0.9 * s;
  const rand = K.seeded(5), pos = [], heads = [];
  groups.forEach((g, gi) => {
    heads.push({ cat: g[0].cat, x, y: y - 0.9 * s, w: widths[gi], n: g.length });
    g.forEach((t, j) => {
      pos[tiles.indexOf(t)] = { x: x + (j % cols[gi]) * 1.4 * s + (rand() - 0.5) * 0.2 * s, y: y + Math.floor(j / cols[gi]) * 1.6 * s + (rand() - 0.5) * 0.2 * s, s };
    });
    x += widths[gi] + 1.5 * s;
  });
  return { pos, heads };
}

// Pure: a seeded appearance rank per index (a shuffled 0..n-1).
export function ranks(n, seed) {
  const a = [...Array(n).keys()], rand = K.seeded(seed);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function meshPath(g, pts) {
  g.beginPath();
  if (TESS.length) for (const [a, b] of TESS) { if (pts[a] && pts[b]) { g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); } }
  else for (const [x, y] of pts) { g.moveTo(x + 0.8, y); g.arc(x, y, 0.8, 0, 7); }
}

const tileCanvas = paint => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  paint(c.getContext('2d'));
  return c;
};

// Cut the face snapshot into square tiles: X.face = { img, box }, X.tiles = [...]. Idempotent.
export function makeTiles(f) {
  if (f.X.tiles) return f.X.tiles;
  const face = f.X.face ??= Cam.snapshot(f), k = face.img.width / face.box.s;
  const pts = f.lm ? f.lm.map(p => Cam.toScreen(f, p)) : [];
  const box = Cam.faceBox(f) ?? { x: face.box.x, y: face.box.y, w: face.box.s, h: face.box.s };
  f.X.tiles = cutFace(box, pts, { EYES: part('EYES'), NOSE: part('NOSE'), MOUTH: part('MOUTH') });
  for (const t of f.X.tiles) {
    const { x, y, s } = t.home;
    t.pos = { ...t.home };
    t.img = tileCanvas(g => g.drawImage(face.img, (x - face.box.x) * k, (y - face.box.y) * k, s * k, s * k, 0, 0, 128, 128));
    if (t.mesh) t.meshImg = tileCanvas(g => {
      g.fillStyle = K.C.INK; g.fillRect(0, 0, 128, 128);
      g.scale(128 / s, 128 / s); g.translate(-x, -y);
      meshPath(g, pts);
      g.strokeStyle = 'rgba(236,236,236,0.6)'; g.lineWidth = s / 128; g.stroke();
    });
  }
  return f.X.tiles;
}

const look = t => t.mesh && t.meshImg ? t.meshImg : t.img;
const bboxOf = ps => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ps) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const THUMB_AT = [0.55, 0.85, 1.15];

export const scan = {
  name: 'scan', step: '04', label: 'SCANNING', tone: 'camera', dur: 2.0,
  draw(f) {
    const { ctx, t, w, h, u, dpr } = f, e = K.smooth(t / 1.4), Z = 1 + 0.18 * e;
    // the view glides the face toward the centre while zooming in
    const fx = f.face?.cx ?? w / 2, fy = f.face?.cy ?? h / 2, tx = K.lerp(fx, w / 2, e), ty = K.lerp(fy, h * 0.44, e);
    ctx.fillStyle = K.C.BLACK; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(tx, ty); ctx.scale(Z, Z); ctx.translate(-fx, -fy); Cam.drawVideo(f); ctx.restore();
    const shade = ctx.createLinearGradient(0, h * 0.62, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = shade; ctx.fillRect(0, h * 0.62, w, h * 0.38);

    if (f.lm) {
      const P = f.lm.map(p => { const [x, y] = Cam.toScreen(f, p); return [tx + (x - fx) * Z, ty + (y - fy) * Z]; });
      const b = bboxOf(P), sweep = K.clamp((t - 0.15) / 1.1), sy = K.lerp(b.y - 12 * u, b.y + b.h + 12 * u, sweep);
      // mesh draws on above the scan line
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, sy); ctx.clip();
      meshPath(ctx, P);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = K.C.TEXT;
      for (const k of ['EYES', 'MOUTH']) for (const i of part(k)) if (P[i]) ctx.fillRect(P[i][0] - 0.75, P[i][1] - 0.75, 1.5, 1.5);
      ctx.restore();
      if (sweep > 0 && sweep < 1) {
        const band = ctx.createLinearGradient(0, sy - 40 * u, 0, sy);
        band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(1, 'rgba(255,255,255,0.14)');
        ctx.fillStyle = band; ctx.fillRect(b.x - 60 * u, sy - 40 * u, b.w + 120 * u, 40 * u);
        K.line(ctx, b.x - 60 * u, sy, b.x + b.w + 60 * u, sy, 'rgba(255,255,255,0.9)', 1);
      }

      // feature boxes, then the right-hand column of thumbnails copied from this frame
      const F = FEATURES.map(k => bboxOf(part(k).map(i => P[i]).filter(Boolean)));
      const S = 76 * u, cx = w - 20 * u - S;
      FEATURES.forEach((name, i) => {
        if (t < THUMB_AT[i] || !(F[i].w > 0)) return;
        const p = K.snap((t - THUMB_AT[i]) / 0.25), d = S * (0.4 + 0.6 * p), y = 136 * u + i * (S + 34 * u);
        const c = Math.max(F[i].w, F[i].h) * 1.25, sx = F[i].x + F[i].w / 2 - c / 2, sy2 = F[i].y + F[i].h / 2 - c / 2;
        ctx.drawImage(ctx.canvas, sx * dpr, sy2 * dpr, c * dpr, c * dpr, cx + (S - d) / 2, y + (S - d) / 2, d, d);
        K.rect(ctx, cx + (S - d) / 2, y + (S - d) / 2, d, d, 'rgba(255,255,255,0.7)', 1);
        K.text(ctx, name, cx + S / 2, y + S + 8 * u, 9 * u, { align: 'center', color: K.C.DIM, alpha: K.clamp(p) });
      });
      // a focus box hops eyes → nose → mouth, landing as each thumbnail pops
      const q = K.clamp((t - THUMB_AT[0]) / 0.3, 0, 2), i = Math.min(1, Math.floor(q)), m = K.smooth((q - i) / 0.6);
      const A = F[i], B = F[i + 1], a = K.clamp((t - 0.35) / 0.2) * K.clamp((1.9 - t) / 0.3), pad = 8 * u;
      if (a > 0 && A.w > 0 && B.w > 0) {
        const bx = K.lerp(A.x, B.x, m) - pad, by = K.lerp(A.y, B.y, m) - pad, bw = K.lerp(A.w, B.w, m) + 2 * pad, bh = K.lerp(A.h, B.h, m) + 2 * pad;
        ctx.save(); ctx.globalAlpha = a;
        K.rect(ctx, bx, by, bw, bh, 'rgba(255,255,255,0.85)', 1);
        K.line(ctx, bx + bw / 2 - 6 * u, by + bh / 2, bx + bw / 2 + 6 * u, by + bh / 2, K.C.TEXT, 1);
        K.line(ctx, bx + bw / 2, by + bh / 2 - 6 * u, bx + bw / 2, by + bh / 2 + 6 * u, K.C.TEXT, 1);
        ctx.restore();
      }
    }
    K.progress(f, 'SCANNING FACE', t / this.dur, f.tone);
  },
};

export const extract = {
  name: 'extract', step: '05', label: 'EXTRACTING', tone: 'light', dur: 1.6,
  enter(f) { makeTiles(f); },
  draw(f) {
    const { ctx, t, u } = f, tiles = makeTiles(f), n = tiles.length, order = ranks(n, 3);
    const b = bboxOf(tiles.flatMap(({ home: { x, y, s } }) => [[x, y], [x + s, y + s]])), pad = 12 * u;
    K.brackets(ctx, b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 14 * u, K.C.INK, 1);
    const shown = {};
    tiles.forEach((tl, i) => {
      const at = 0.06 + order[i] * (1.05 / n), p = (t - at) / 0.2;
      if (p <= 0) return;
      shown[tl.cat] = (shown[tl.cat] ?? 0) + 1;
      const { x, y, s } = tl.home, d = s * (0.55 + 0.45 * K.snap(p)), r = K.seeded(tl.id + 11);
      ctx.drawImage(look(tl), x + (s - d) / 2, y + (s - d) / 2, d, d);
      // the cut mark: an offset outline that flashes and stays faint
      K.rect(ctx, x + (r() - 0.5) * 12 * u, y + (r() - 0.5) * 12 * u, s, s, `rgba(17,17,17,${0.15 + 0.45 * K.clamp(1 - (t - at) / 0.6)})`, 1);
    });
    const done = Object.values(shown).reduce((a, v) => a + v, 0);
    K.text(ctx, `${String(done).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, b.x + b.w + pad, b.y - pad - 16 * u, 9 * u, { align: 'right', color: K.C.INK_DIM });
    K.text(ctx, CATS.map(c => `${c} ${String(shown[c] ?? 0).padStart(2, '0')}`).join('   '), b.x - pad, b.y + b.h + pad + 8 * u, 9 * u, { color: K.C.INK_DIM });
    K.progress(f, 'EXTRACTING FEATURES', t / this.dur, f.tone);
  },
};

let sorted;   // cached 06 layout, rebuilt for new tiles or a resize
const FLY = 0.9;

export const deconstruct = {
  name: 'deconstruct', step: '06', label: 'DECONSTRUCT', tone: 'black', dur: 3.0,
  enter(f) { makeTiles(f); },
  draw(f) {
    const { ctx, t, w, h, u } = f, tiles = makeTiles(f), order = ranks(tiles.length, 9);
    if (sorted?.tiles !== tiles || sorted.w !== w || sorted.h !== h) sorted = { tiles, w, h, ...sortLayout(tiles, w, h, u) };
    const step = Math.min(0.04, 1.0 / tiles.length), dim = 'rgba(255,255,255,0.12)';

    // where the face was: faint home cells
    const ghost = `rgba(255,255,255,${0.12 - 0.08 * K.smooth((t - 1) / 1.2)})`;
    for (const { home: { x, y, s } } of tiles) K.rect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, ghost, 1);

    const first = {};
    tiles.forEach((tl, i) => {
      const at = 0.25 + order[i] * step, p = K.clamp((t - at) / FLY), k = K.snap(p), to = sorted.pos[i], from = tl.home;
      first[tl.cat] = Math.min(first[tl.cat] ?? 9, at);
      tl.pos = { x: K.lerp(from.x, to.x, k), y: K.lerp(from.y, to.y, k), s: K.lerp(from.s, to.s, k) };
      const { x, y, s } = tl.pos;
      // leader from the tile's place in the face to where it is now
      if (p > 0 && p < 1) K.line(ctx, from.x + from.s / 2, from.y + from.s / 2, x + s / 2, y + s / 2, `rgba(255,255,255,${0.35 * Math.sin(p * Math.PI)})`, 1);
      ctx.drawImage(look(tl), x, y, s, s);
      if (p > 0.6) K.text(ctx, K.decrypt(tl.code, (p - 0.6) * FLY, 20), x, y + s + 4 * u, 8 * u, { color: K.C.DIM });
    });

    // category headers with a rule and a fine bracket line down the block
    for (const hd of sorted.heads) {
      const a = K.clamp((t - first[hd.cat] - 0.4) / 0.3);
      if (a <= 0) continue;
      const s = sorted.pos.find(Boolean).s, bottom = Math.max(...sorted.pos.filter((_, i) => tiles[i].cat === hd.cat).map(p => p.y + p.s)) + 16 * u;
      ctx.save(); ctx.globalAlpha = a;
      K.text(ctx, K.decrypt(hd.cat, t - first[hd.cat] - 0.4, 22), hd.x, hd.y - 2 * u, 10 * u, { weight: 500 });
      K.text(ctx, String(hd.n).padStart(2, '0'), hd.x + hd.w, hd.y - 2 * u, 9 * u, { align: 'right', color: K.C.DIM });
      K.line(ctx, hd.x, hd.y + 14 * u, hd.x + hd.w * a, hd.y + 14 * u, 'rgba(255,255,255,0.35)', 1);
      K.line(ctx, hd.x - 0.25 * s, hd.y + 14 * u, hd.x - 0.25 * s, K.lerp(hd.y + 14 * u, bottom, a), dim, 1);
      ctx.restore();
    }
    K.progress(f, 'SORTING FRAGMENTS', t / this.dur, f.tone);
  },
};
