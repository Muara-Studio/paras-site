// Steps 07 organize (tiles index into a turning 3×3 cube) and 08 reconstruct (the wrong reassembly). CONTRACT.md §7, §8.
import * as K from './kit.js';
import * as Cam from './camera.js';
import { makeTiles } from './phases-a.js';

// ── Tiny orthographic 3D. Axes: x right, y down, z toward the viewer.
const AX = { x: 0, y: 1, z: 2 };
export function turn([x, y, z], axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return axis === 'x' ? [x, y * c - z * s, y * s + z * c]
    : axis === 'y' ? [x * c + z * s, y, -x * s + z * c]
    : [x * c - y * s, x * s + y * c, z];
}
export const view = (p, yaw, pitch) => turn(turn(p, 'y', yaw), 'x', pitch);
export const project = (p, V) => { const r = view(p, V.yaw, V.pitch); return [V.cx + r[0] * V.s, V.cy + r[1] * V.s, r[2]]; };

// [name, normal, u (image right), v (image down)], with normal = u × v. The first three are the faces in view.
const FACES = [
  ['FRONT', [0, 0, 1], [1, 0, 0], [0, 1, 0]], ['LEFT', [-1, 0, 0], [0, 0, 1], [0, 1, 0]], ['TOP', [0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ['RIGHT', [1, 0, 0], [0, 0, -1], [0, 1, 0]], ['BOTTOM', [0, 1, 0], [1, 0, 0], [0, 0, -1]], ['BACK', [0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
// 54 stickers {face, q: cubie centre, c: sticker centre, u, v, n}; 0–26 sit on FRONT, LEFT, TOP.
export const STICKERS = FACES.flatMap(([face, n, u, v]) => [-1, 0, 1].flatMap(j => [-1, 0, 1].map(i => {
  const q = add(add(n, u, i), v, j);
  return { face, q, c: add(q, n, 0.5), u, v, n };
})));

export const MOVES = [
  { axis: 'y', layer: -1, dir: 1, at: 1.45 }, { axis: 'x', layer: 1, dir: -1, at: 1.95 },
  { axis: 'z', layer: 1, dir: 1, at: 2.45 }, { axis: 'y', layer: 1, dir: -1, at: 2.95 },
];
export const TURN = 0.42;
export const layerName = m => `${m.axis.toUpperCase()}${m.layer > 0 ? '+' : '-'}1`;

// The cube at time t: finished moves applied whole, the current one part-way. `hot` marks the turning layer.
export function cubeAt(t) {
  return STICKERS.map(s0 => {
    const s = { ...s0, hot: false };
    for (const m of MOVES) {
      const k = (t - m.at) / TURN;
      if (k <= 0 || Math.round(s.q[AX[m.axis]]) !== m.layer) continue;
      const a = m.dir * Math.PI / 2 * K.snap(k, 0.6);
      for (const key of ['q', 'c', 'u', 'v', 'n']) s[key] = turn(s[key], m.axis, a);
      s.hot = k < 1;
    }
    return s;
  });
}

// Seeded wrong reassembly for one attempt: slot j shows tile show[j]; perm is the true one-to-one placement
// (tile perm[j] ends at slot j), show adds a duplicated mouth and eye, kind marks slots gone black or filled flat.
export function wrongLayout(cats, attempt) {
  const n = cats.length, rand = K.seeded(97 + attempt * 131), pick = a => a[Math.floor(rand() * a.length)];
  const perm = [...Array(n).keys()], slots = [...perm];
  for (let k = 0; k < Math.ceil(n * 0.45); k++) { const a = pick(slots), b = pick(slots); [perm[a], perm[b]] = [perm[b], perm[a]]; }
  const show = perm.slice(), kind = Array(n).fill('tile');
  for (const cat of ['MOUTH', 'EYES']) {
    const of = slots.filter(i => cats[i] === cat);
    if (of.length) show[pick(slots)] = pick(of);
  }
  for (let k = 0; k < Math.max(2, Math.round(n / 7)); k++) kind[pick(slots)] = k % 2 ? 'flat' : 'gone';
  return { perm, show, kind };
}

const corners = (s, V, g = 0.92) => {
  const p0 = add(add(s.c, s.u, -g / 2), s.v, -g / 2);
  return [project(p0, V), project(add(p0, s.u, g), V), project(add(p0, s.v, g), V)];
};
const flat = r => [[r.x, r.y], [r.x + r.s, r.y], [r.x, r.y + r.s]];
const mix = (A, B, e) => A.map((p, i) => [K.lerp(p[0], B[i][0], e), K.lerp(p[1], B[i][1], e)]);
const rectOf = ([p0, p1, p3]) => {
  const s = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), cx = (p1[0] + p3[0]) / 2, cy = (p1[1] + p3[1]) / 2;
  return { x: cx - s / 2, y: cy - s / 2, s };
};
function poly(ctx, [p0, p1, p3]) {
  ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p1[0] + p3[0] - p0[0], p1[1] + p3[1] - p0[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
}
const mixRect = (a, b, e) => ({ x: K.lerp(a.x, b.x, e), y: K.lerp(a.y, b.y, e), s: K.lerp(a.s, b.s, e) });
const drawTile = (ctx, img, Q) => K.quad(ctx, img, 0, 0, img.width, img.height, Q[0], Q[1], Q[2], 0.5);

// Face labels sit just outside an edge of their face: [name, edge midpoint, dx, dy (×u), align].
const FACE_TAGS = [['FRONT', [0, 1.5, 1.5], 0, 16, 'center'], ['LEFT', [-1.5, 0, -1.5], -14, 0, 'right'], ['TOP', [0, -1.5, -1.5], 0, -16, 'center']];
let from7 = [], from8 = [];   // where each tile started the phase (screen rects), set on enter

export const organize = {
  name: 'organize', step: '07', label: 'ORGANIZE', tone: 'black', dur: 4.2,
  enter(f) { from7 = makeTiles(f).map(t => ({ ...t.pos })); },
  draw(f) {
    const { ctx, t, w, h, u } = f, tiles = makeTiles(f), n = tiles.length;
    K.progress(f, 'INDEXING // 12,480 PROFILES', t / this.dur);
    if (!n) return;
    if (from7.length !== n) this.enter(f);
    // Settle: the cube swings round to face front, so 08 starts from one flat square of tiles.
    const settle = K.smooth((t - 3.45) / 0.6), k = 1 - settle;
    const V = { yaw: (0.5 + 0.3 * K.smooth(t / 3.4)) * k, pitch: -0.42 * k, cx: w / 2, cy: h * 0.44, s: Math.min(w, h) * 0.085 };
    const centre = { x: V.cx - V.s * 0.45, y: V.cy - V.s * 0.45, s: V.s * 0.9 };
    const arrive = i => K.smooth((t - 0.1 - i * 0.022) / 0.75);

    // Tiles that get no sticker in view sink into the cube; every tile gets a final pos for 08.
    for (let i = 0; i < n; i++) tiles[i].pos = { ...centre };
    const draws = [];
    for (let i = 27; i < n; i++) {
      const e = arrive(i - 27);
      if (e < 1) draws.push({ img: tiles[i].img, Q: flat(mixRect(from7[i], centre, e)), z: 9, shade: 0 });
    }
    cubeAt(t).forEach((s, i) => {
      const tile = tiles[i % n], nz = view(s.n, V.yaw, V.pitch)[2], Q = corners(s, V);
      const e = i < 27 ? arrive(i) : 1;
      if (e < 1) return draws.push({ img: tile.img, Q: mix(flat(from7[i % n]), Q, e), z: 10 - e, shade: (1 - nz) * 0.5 * e });
      if (nz < 0.02) return;
      tile.pos = rectOf(Q);
      draws.push({ img: tile.img, Q, z: project(s.c, V)[2], shade: (1 - nz) * 0.5, hot: s.hot });
    });
    draws.sort((a, b) => a.z - b.z);
    for (const d of draws) {
      drawTile(ctx, d.img, d.Q);
      poly(ctx, d.Q);
      if (d.shade > 0) { ctx.fillStyle = `rgba(0,0,0,${d.shade})`; ctx.fill(); }
      ctx.strokeStyle = d.hot ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // Face labels once the cube has formed, then a layer label beside each turning layer.
    const la = K.smooth((t - 1.15) / 0.3);
    for (const [name, p, dx, dy, align] of FACE_TAGS) {
      const [x, y] = project(p, V);
      K.text(ctx, name, x + dx * u, y + dy * u, 10 * u, { color: K.C.DIM, align, base: 'middle', alpha: la * (name === 'FRONT' ? 1 : k) });
    }
    const lx = V.cx + V.s * 3.4;
    for (const m of MOVES) {
      const k = (t - m.at) / TURN, a = K.smooth((k + 0.25) * 4) * (1 - K.smooth((k - 1.2) * 3));
      if (a <= 0) continue;
      const c = [0, 0, 0]; c[AX[m.axis]] = m.layer;
      const [x, y] = project(c, V);
      ctx.save(); ctx.globalAlpha *= a;
      K.line(ctx, x, y, lx - 8 * u, y, 'rgba(255,255,255,0.5)');
      ctx.fillStyle = K.C.TEXT; ctx.fillRect(x - 2, y - 2, 4, 4);
      K.text(ctx, layerName(m), lx, y, 12 * u, { weight: 500, base: 'middle' });
      K.text(ctx, `${String(Math.round(90 * K.clamp(k))).padStart(3, '0')}°`, lx + 44 * u, y, 10 * u, { color: K.C.DIM, base: 'middle' });
      ctx.restore();
    }
    const lock = K.smooth((t - 3.7) / 0.3);
    if (lock > 0) {
      const r = V.s * K.lerp(2.4, 1.75, lock);
      ctx.save(); ctx.globalAlpha *= lock; K.brackets(ctx, V.cx - r, V.cy - r, r * 2, r * 2, 16 * u, K.C.TEXT); ctx.restore();
    }
  },
};

const RETRY = [2.9, 3.3];          // each retry re-deals the layout; 3.9 is the final error
const ERROR = 3.9;

// Horizontal tear: copy a few strips of what is already drawn back onto the canvas, shifted sideways.
function tear(f, seed) {
  const { ctx, w, h, dpr, u } = f, rand = K.seeded(seed);
  for (let i = 0; i < 5; i++) {
    const y = rand() * h, hh = (3 + rand() * 26) * u, dx = (rand() - 0.5) * 70 * u;
    ctx.drawImage(ctx.canvas, 0, y * dpr, w * dpr, hh * dpr, dx, y, w, hh);
  }
}

export const reconstruct = {
  name: 'reconstruct', step: '08', label: 'RECONSTRUCT', tone: 'camera', dur: 4.6,
  enter(f) { from8 = makeTiles(f).map(t => ({ ...t.pos })); },
  draw(f) {
    const { ctx, t, u } = f, tiles = makeTiles(f), n = tiles.length;
    ctx.fillStyle = K.C.BLACK; ctx.fillRect(0, 0, f.w, f.h);
    Cam.drawVideo(f);
    if (n) {
      if (from8.length !== n) this.enter(f);
      // Homes follow the face if it moved since the snapshot.
      const box = f.X.face?.box, dx = f.face && box ? f.face.cx - (box.x + box.s / 2) : 0, dy = f.face && box ? f.face.cy - (box.y + box.s / 2) : 0;
      const slot = j => ({ x: tiles[j].home.x + dx, y: tiles[j].home.y + dy, s: tiles[j].home.s });
      const cats = tiles.map(x => x.cat), at = RETRY.filter(r => t >= r).length, L = wrongLayout(cats, at);
      const prev = at ? wrongLayout(cats, at - 1) : null, wasAt = prev && Array(n);
      if (prev) prev.perm.forEach((ti, j) => { wasAt[ti] = j; });
      const glitch = t >= ERROR ? K.clamp(1 - (t - ERROR) / 0.35) : at ? K.clamp(1 - (t - RETRY[at - 1]) / 0.3) : 0;
      const jit = K.seeded(Math.floor(t * 30) + 7);

      // Matching frame: brackets and a sweep over the face area while it "compares".
      const S = tiles.reduce((b, x, j) => { const r = slot(j); return { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.s), y1: Math.max(b.y1, r.y + r.s) }; }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      const pad = 14 * u;
      K.brackets(ctx, S.x0 - pad, S.y0 - pad, S.x1 - S.x0 + pad * 2, S.y1 - S.y0 + pad * 2, 18 * u, K.C.TEXT);

      L.show.forEach((ti, j) => {
        const to = slot(j), start = prev ? slot(wasAt[ti]) : from8[ti];
        const e = prev ? K.snap((t - RETRY[at - 1]) / 0.22, 0.8) : K.smooth((t - 0.1 - j * 0.04) / 0.7);
        const r = mixRect(start, to, e), x = r.x + (jit() - 0.5) * r.s * 0.7 * glitch;
        if (e >= 1 && L.kind[j] === 'gone') { ctx.fillStyle = K.C.BLACK; ctx.fillRect(to.x, to.y, to.s, to.s); return; }
        // Flat fill: one pixel from the tile's centre, stretched over the slot.
        if (e >= 1 && L.kind[j] === 'flat') return ctx.drawImage(tiles[ti].img, tiles[ti].img.width >> 1, tiles[ti].img.height >> 1, 1, 1, to.x, to.y, to.s, to.s);
        ctx.drawImage(tiles[ti].img, x, r.y, r.s, r.s);
      });
      L.perm.forEach((ti, j) => { tiles[ti].pos = slot(j); });

      const sweep = (t - 1.0) / 0.85;
      if (sweep > 0 && t < RETRY[0]) {
        const y = K.lerp(S.y0, S.y1, sweep % 1);
        K.line(ctx, S.x0 - pad, y, S.x1 + pad, y, 'rgba(255,255,255,0.7)');
      }
      if (glitch > 0) tear(f, Math.floor(t * 30));
    }

    const p = Math.min(0.97, t / 2.5 * 0.97), err = t >= ERROR;
    K.progress(f, err ? '' : t >= RETRY[1] ? 'RETRY 2/3' : t >= RETRY[0] ? 'RETRY 1/3' : 'MATCHING IDENTITY', p);
    if (err) {
      // shortcut: mirrors K.progress's label position (x 21u, baseline h-64u, 14u/500), update if kit.js moves it.
      const s = 'ERROR // NO MATCH', x = Math.round(21 * u), y = Math.round(f.h - 56 * u) - 8 * u, size = 14 * u;
      ctx.save(); ctx.font = `500 ${size}px ${K.FONT}`; ctx.letterSpacing = `${0.08 * size}px`;
      const tw = ctx.measureText(s).width; ctx.restore();
      ctx.fillStyle = K.C.TEXT; ctx.fillRect(x - 6 * u, y - size * 0.95, tw + 12 * u, size * 1.35);
      K.text(ctx, s, x, y, size, { color: K.C.BLACK, weight: 500, track: 0.08, base: 'alphabetic' });
    }
  },
};
