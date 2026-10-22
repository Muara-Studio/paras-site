// Step 09 release and the end screen (CONTRACT.md §8, §9). Everything is drawn from f.t, so ?phase=release&at=5&freeze holds.
import * as K from './kit.js';
import * as Cam from './camera.js';
import { makeTiles } from './phases-a.js';

const BREAK = 4.6, FALL = 2.2, FADE = 1.5;

// Separable box blur (radius r cells, edges clamped): spreads the silhouette so its gradient reaches past the body.
export function blur(d, cols, rows, r) {
  const a = new Float32Array(d.length), b = new Float32Array(d.length), n = 2 * r + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let s = 0; for (let k = -r; k <= r; k++) s += d[j * cols + K.clamp(i + k, 0, cols - 1)]; a[j * cols + i] = s / n;
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let s = 0; for (let k = -r; k <= r; k++) s += a[K.clamp(j + k, 0, rows - 1) * cols + i]; b[j * cols + i] = s / n;
  }
  return b;
}

// Coarse person field over a w×h screen: inside(x, y) → 0..1 at each cell centre, blurred twice.
// `cover` = share of body cells, `base` = share of the bottom row (a person at a webcam always reaches it).
export function field(w, h, inside, cols = 64) {
  const rows = Math.max(2, Math.round(cols * h / w)), d = new Float32Array(cols * rows);
  let n = 0, b = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const on = (d[j * cols + i] = inside((i + 0.5) * w / cols, (j + 0.5) * h / rows)) > 0.5;
    n += on; if (j === rows - 1) b += on;
  }
  return { d: blur(blur(d, cols, rows, 1), cols, rows, 1), cols, rows, w, h, cover: n / d.length, base: b / cols };
}

// Bilinear field value at screen (x, y).
export function sample(F, x, y) {
  const { d, cols, rows } = F, gx = K.clamp(x / F.w * cols - 0.5, 0, cols - 1), gy = K.clamp(y / F.h * rows - 0.5, 0, rows - 1);
  const i = Math.min(cols - 2, gx | 0), j = Math.min(rows - 2, gy | 0), u = gx - i, v = gy - j, at = (a, b) => d[b * cols + a];
  return K.lerp(K.lerp(at(i, j), at(i + 1, j), u), K.lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
}

// Push a grid vertex out of the body: along the outward normal (down the gradient), up to k px where the field is 1.
// Deep inside the gradient vanishes, so vertices there stay and lines bunch just outside the silhouette.
export function push(F, x, y, k) {
  const ex = F.w / F.cols, ey = F.h / F.rows, gx = (sample(F, x + ex, y) - sample(F, x - ex, y)) / 2, gy = (sample(F, x, y + ey) - sample(F, x, y - ey)) / 2;
  const m = Math.hypot(gx, gy), s = sample(F, x, y) * k / (m + 0.02);
  return [-gx * s, -gy * s];
}

// Fallback body from the face circle: head ellipse, neck, and a wide shoulder block down to the bottom edge.
export function headShoulders({ cx, cy, r }) {
  return (x, y) => {
    const dx = x - cx, sy = cy + r * 2.7;
    return ((dx / (r * 0.85)) ** 2 + ((y - cy + r * 0.1) / (r * 1.15)) ** 2 < 1)
      || (Math.abs(dx) < r * 0.5 && y > cy && y < sy)
      || ((dx / (r * 2.5)) ** 2 + ((y - sy) / (r * 1.1)) ** 2 < 1) || (y > sy && Math.abs(dx) < r * 2.5) ? 1 : 0;
  };
}

// Seeded shards: each grid cell joins the nearest of ~cells/per random seed points (Voronoi on cell centres).
export function shards(cols, rows, per = 3, seed = 9) {
  const r = K.seeded(seed), seeds = Array.from({ length: Math.max(1, Math.round(cols * rows / per)) }, () => [r() * cols, r() * rows]);
  return Int32Array.from({ length: cols * rows }, (_, k) => {
    const x = k % cols + 0.5, y = (k / cols | 0) + 0.5;
    let best = 0, bd = Infinity;
    seeds.forEach(([sx, sy], q) => { const dd = (sx - x) ** 2 + (sy - y) ** 2; if (dd < bd) { bd = dd; best = q; } });
    return best;
  });
}

// Shard motion τ s after it cracks, closed-form: a snap outward along dir, then drift, gravity and spin.
export function fall(tau, dir, r, u = 1) {
  const jolt = K.snap(tau / 0.25) * (5 + 12 * r[0]) * u, v = (40 + 120 * r[1]) * u * tau;
  return { x: dir[0] * (jolt + v), y: dir[1] * (jolt + v) - 60 * u * r[2] * tau + 450 * u * tau * tau, a: (r[3] - 0.5) * 5 * tau };
}

// The body field: f.mask through the mirrored cover view, or the head-and-shoulders fallback when it's missing, empty or bodiless.
function body(f) {
  const { mask: m, video: v, view: { s, ox, oy }, w, h } = f;
  if (m && v.videoWidth) {
    const kx = m.w / v.videoWidth, ky = m.h / v.videoHeight;
    const F = field(w, h, (x, y) => {
      const mx = (w - x - ox) / s * kx | 0, my = (y - oy) / s * ky | 0;
      return mx >= 0 && my >= 0 && mx < m.w && my < m.h ? m.data[my * m.w + mx] : 0;
    });
    if (F.cover > 0.01 && F.base > 0.1) return F;
  }
  return field(w, h, headShoulders(f.face ?? { cx: w / 2, cy: h * 0.42, r: Math.min(w, h) * 0.17 }));
}

export const release = {
  name: 'release', step: '09', label: 'RELEASE', tone: 'camera', dur: 8.6, wantsMask: true,
  draw(f) {
    const { ctx, w, h, t, u } = f, c = K.cell(f), st = c / 4;
    const face = f.face ?? { cx: w / 2, cy: h * 0.42, r: Math.min(w, h) * 0.17 };
    ctx.fillStyle = K.C.BLACK; ctx.fillRect(0, 0, w, h);
    Cam.drawVideo(f);

    // 0–1 s: the wrong reassembly drifts apart and fades, revealing the live camera.
    if (t < 1) {
      const r = K.seeded(5);
      for (const tl of f.X.tiles ?? makeTiles(f)) {
        const p = K.clamp((t - r() * 0.4) / 0.6), { x, y, s } = tl.pos, dx = x + s / 2 - face.cx, dy = y + s / 2 - face.cy, d = Math.hypot(dx, dy) || 1, e = p * p * 70 * u;
        if (p >= 1) continue;
        ctx.globalAlpha = 1 - p;
        ctx.drawImage(tl.img, x + dx / d * e, y + dy / d * e + e * 0.5, s * (1 - p * 0.25), s * (1 - p * 0.25));
      }
      ctx.globalAlpha = 1;
    }

    // After the break, older frames echo around the visitor.
    if (t > BREAK) Cam.smear(f, { alpha: K.smooth((t - BREAK) / 0.6) * 0.8, cx: face.cx, cy: face.cy, r: face.r });

    // The fine grid, bending away from the body as amp grows, then cracking into falling shards.
    const F = body(f), amp = K.smooth((t - 1) / (BREAK - 1)), k = 1.4 * c * Math.max(amp, t >= BREAK ? 1 : 0);
    const P = (x, y) => {
      const [dx, dy] = push(F, x, y, k), wob = 2.5 * u * Math.min(1, k / (1.4 * c));
      return [x + dx + wob * Math.sin(x * 0.045 + y * 0.031 + t * 2.3), y + dy + wob * Math.sin(y * 0.047 - x * 0.029 + t * 1.9)];
    };
    const x0 = (w % c) / 2 - c, y0 = (h % c) / 2 - c, nx = Math.ceil((w - x0) / c) + 1, ny = Math.ceil((h - y0) / c) + 1;
    ctx.strokeStyle = K.C.TEXT; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 * K.smooth((t - 0.2) / 0.8);
    if (t < BREAK) {
      ctx.beginPath();
      for (let i = 0; i < nx; i++) for (let y = y0; y <= y0 + ny * c; y += st) ctx[y === y0 ? 'moveTo' : 'lineTo'](...P(x0 + i * c, y));
      for (let j = 0; j < ny; j++) for (let x = x0; x <= x0 + nx * c; x += st) ctx[x === x0 ? 'moveTo' : 'lineTo'](...P(x, y0 + j * c));
      ctx.stroke();
    } else {
      const map = shards(nx, ny, 2), groups = [];
      map.forEach((g, q) => (groups[g] ??= []).push(q));
      const far = Math.hypot(w, h) / 2;
      groups.forEach((cells, g) => {
        let cx = 0, cy = 0;
        for (const q of cells) { cx += x0 + (q % nx + 0.5) * c; cy += y0 + ((q / nx | 0) + 0.5) * c; }
        cx /= cells.length; cy /= cells.length;
        const r = K.seeded(g * 7919 + 13), rr = [r(), r(), r(), r()], d = Math.hypot(cx - face.cx, cy - face.cy) || 1;
        const tau = t - BREAK - 0.4 * Math.min(1, d / far), m = fall(Math.max(0, tau), [(cx - face.cx) / d, (cy - face.cy) / d], rr, u);
        ctx.save();
        ctx.globalAlpha *= 1 - K.smooth(tau / (FALL - 0.4));
        ctx.translate(cx + m.x, cy + m.y); ctx.rotate(m.a); ctx.translate(-cx, -cy);
        // Each cell owns its left and top edges, so a shard reads as broken line pieces, not a closed tile.
        ctx.beginPath();
        for (const q of cells) {
          const ax = x0 + (q % nx) * c, ay = y0 + (q / nx | 0) * c;
          ctx.moveTo(...P(ax, ay + c));
          for (let e = st; e <= c; e += st) ctx.lineTo(...P(ax, ay + c - e));
          for (let e = st; e <= c; e += st) ctx.lineTo(...P(ax + e, ay));
        }
        ctx.stroke(); ctx.restore();
      });
    }

    // Last FADE s: the visitor fades to black; only the subtitle (DOM) stays.
    ctx.globalAlpha = K.smooth((t - (this.dur - FADE)) / FADE);
    ctx.fillStyle = K.C.BLACK; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  },
};

export const end = {
  name: 'end', step: '09', label: 'RELEASE', tone: 'black', dur: 3.0,
  draw(f) {
    const { ctx, w, h } = f, p = (f.t - (this.dur - 1.3)) / 1.3;
    ctx.fillStyle = K.C.BLACK; ctx.fillRect(0, 0, w, h); // hide the backdrop grid; it draws back in below
    if (p <= 0) return;
    // Each grid line grows out from the centre on a seeded stagger: clip the kit grid to growing bands.
    const c = K.cell(f), r = K.seeded(3), b = 5 * f.u, grow = () => K.smooth((p - r() * 0.45) / 0.55);
    ctx.save(); ctx.beginPath();
    for (let x = (w % c) / 2; x < w; x += c) { const L = h * grow(); ctx.rect(x - b, (h - L) / 2, 2 * b, L); }
    for (let y = (h % c) / 2; y < h; y += c) { const L = w * grow(); ctx.rect((w - L) / 2, y - b, L, 2 * b); }
    ctx.clip(); K.grid(f, { alpha: 0.5 }); ctx.restore();
  },
};
