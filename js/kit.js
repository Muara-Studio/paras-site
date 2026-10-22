// Drawing kit (owner: agent B). Canvas 2D only; see CONTRACT.md §5.

export const C = {
  DARK: '#222222', BLACK: '#000000', PAPER: '#ececec',
  TEXT: '#f2f2f2', DIM: 'rgba(242,242,242,0.45)', LINE: 'rgba(255,255,255,0.10)', TICK: 'rgba(255,255,255,0.35)',
  INK: '#111111', INK_DIM: 'rgba(17,17,17,0.45)', INK_LINE: 'rgba(0,0,0,0.10)', INK_TICK: 'rgba(0,0,0,0.35)',
};
export const FONT = '"IBM Plex Mono", ui-monospace, monospace';

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => (t = clamp(t), t * t * (3 - 2 * t));
// Ease-out-back: snap(0) = 0, snap(1) = 1, overshoots past 1 on the way.
export const snap = (t, o = 1.2) => (t = clamp(t), t * (1 + (1 - t) * (o + 2 - (o + 1) * t))); // factored so both ends are exact
export function seeded(seed = 1) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }
const hash = (a, b) => { const x = Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663); return Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; };
const px = v => Math.round(v) + 0.5; // centre 1 px strokes on a pixel so they stay crisp at dpr 1 and 2

export function text(ctx, s, x, y, size, o = {}) {
  const tr = (o.track ?? 0.06) * size, align = o.align ?? 'left';
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.fillStyle = o.color ?? C.TEXT;
  ctx.font = `${o.weight ?? 400} ${size}px ${FONT}`;
  ctx.letterSpacing = `${tr}px`;
  ctx.textAlign = align;
  ctx.textBaseline = o.base ?? 'top';
  // letterSpacing also pads after the last glyph; shift so centred/right text stays on its anchor
  ctx.fillText(s, x + (align === 'center' ? tr / 2 : align === 'right' || align === 'end' ? tr : 0), y);
  ctx.restore();
}
export const typed = (s, t, cps = 32) => s.slice(0, Math.max(0, Math.floor(t * cps)));

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/+*<>_';
// Chars appear left to right at cps; each scrambles until the head is 4 chars past it.
export function decrypt(s, t, cps = 26) {
  const k = t * cps, b = Math.floor(t * 24); // glyphs reshuffle 24x a second, fixed within a bucket
  let out = '';
  for (let i = 0; i < s.length && i < k; i++) out += i < k - 4 || s[i] === ' ' ? s[i] : GLYPHS[hash(i, b) % GLYPHS.length];
  return out;
}

export function line(ctx, x0, y0, x1, y1, color = C.LINE, lw = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
export function rect(ctx, x, y, w, h, color = C.LINE, lw = 1) { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h); }
export function brackets(ctx, x, y, w, h, arm, color = C.TEXT, lw = 1) {
  const a = Math.min(arm, w / 2, h / 2), r = x + w, b = y + h;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  ctx.moveTo(x, y + a); ctx.lineTo(x, y); ctx.lineTo(x + a, y);
  ctx.moveTo(r - a, y); ctx.lineTo(r, y); ctx.lineTo(r, y + a);
  ctx.moveTo(r, b - a); ctx.lineTo(r, b); ctx.lineTo(r - a, b);
  ctx.moveTo(x + a, b); ctx.lineTo(x, b); ctx.lineTo(x, b - a);
  ctx.stroke();
}
export function ring(ctx, x, y, r, p, color = C.TEXT, lw = 1) {
  if (!(p > 0)) return;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + clamp(p) * Math.PI * 2); ctx.stroke();
}

export const cell = f => 72 * f.u; // 68 px at 1440x757, as in the original
// Markers: [x, y as viewport fractions, drift px/s x, y, kind 0 square / 1 circle]
const MARKS = (() => { const r = seeded(7); return Array.from({ length: 8 }, (_, i) => [r(), r(), (r() - 0.5) * 10, (r() - 0.5) * 6, i < 6 ? 0 : 1]); })();
const wrap = (v, m) => ((v % m) + m) % m;

// One base colour (opaque) at three strengths: lines, brighter + ticks, markers. One path per style.
export function grid(f, o = {}) {
  const { ctx, w, h, u } = f, c = o.cell ?? cell(f), ox = (w % c) / 2, oy = (h % c) / 2, arm = 6 * u;
  ctx.save();
  ctx.strokeStyle = o.color ?? (f.tone === 'light' ? C.INK : '#ffffff');
  ctx.lineWidth = 1;
  const a = ctx.globalAlpha * (o.alpha ?? 1);
  ctx.beginPath();
  for (let x = ox; x <= w; x += c) { ctx.moveTo(px(x), 0); ctx.lineTo(px(x), h); }
  for (let y = oy; y <= h; y += c) { ctx.moveTo(0, px(y)); ctx.lineTo(w, px(y)); }
  ctx.globalAlpha = a * 0.11; ctx.stroke();
  ctx.beginPath();
  for (let x = ox; x <= w; x += c) for (let y = oy; y <= h; y += c) {
    ctx.moveTo(px(x) - arm, px(y)); ctx.lineTo(px(x) + arm, px(y)); ctx.moveTo(px(x), px(y) - arm); ctx.lineTo(px(x), px(y) + arm);
  }
  ctx.globalAlpha = a * 0.3; ctx.stroke();
  const t = f.now ?? 0, sq = Math.round(9 * u), cr = 12 * u;
  ctx.beginPath();
  for (const [mx, my, vx, vy, k] of MARKS) {
    const x = wrap(mx * w + vx * t, w), y = wrap(my * h + vy * t, h);
    if (k) { ctx.moveTo(x + cr, y); ctx.arc(x, y, cr, 0, Math.PI * 2); } else ctx.rect(px(x - sq / 2), px(y - sq / 2), sq, sq);
  }
  ctx.globalAlpha = a * 0.38; ctx.stroke();
  ctx.restore();
}

export function backdrop(f, tone) {
  const { ctx, w, h } = f;
  if (tone === 'camera') return;
  ctx.fillStyle = tone === 'light' ? C.PAPER : tone === 'black' ? C.BLACK : C.DARK;
  ctx.fillRect(0, 0, w, h);
  grid(f, { color: tone === 'light' ? C.INK : '#ffffff', alpha: tone === 'black' ? 0.75 : tone === 'light' ? 0.6 : 1 });
}

// Bottom bar: label left, 1 px track with a 3 px fill and 10% ticks under it, 000% right.
export function progress(f, label, p, tone = f.tone) {
  const { ctx, w, h, u } = f, ink = tone === 'light', col = ink ? C.INK : C.TEXT;
  const x0 = Math.round(21 * u), x1 = w - x0, y = px(h - 56 * u), q = clamp(p || 0);
  text(ctx, label, x0, y - 8 * u, 14 * u, { color: col, weight: 500, track: 0.08, base: 'alphabetic' });
  text(ctx, `${String(Math.round(q * 100)).padStart(3, '0')}%`, x1, y - 8 * u, 14 * u, { color: col, weight: 500, track: 0.08, align: 'right', base: 'alphabetic' });
  ctx.save();
  ctx.strokeStyle = ink ? '#a0a0a0' : '#525252'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(x0, y); ctx.lineTo(x1, y);
  for (let i = 1; i <= 10; i++) { const x = px(lerp(x0, x1, i / 10)); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 2 + 4 * u); }
  ctx.stroke();
  if (q > 0) line(ctx, x0, y, lerp(x0, x1, q), y, col, 3);
  ctx.restore();
}

// Draw image rect (sx, sy, sw, sh) onto the parallelogram p0 (top-left), p1 (top-right), p3 (bottom-left).
// bleed (px) grows the quad outward so abutting antialiased quads don't show hairline seams.
export function quad(ctx, img, sx, sy, sw, sh, p0, p1, p3, bleed = 0) {
  if (!sw || !sh) return;
  const bx = bleed * sw / (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1), by = bleed * sh / (Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) || 1);
  ctx.save();
  ctx.transform((p1[0] - p0[0]) / sw, (p1[1] - p0[1]) / sw, (p3[0] - p0[0]) / sh, (p3[1] - p0[1]) / sh, p0[0], p0[1]);
  ctx.drawImage(img, sx, sy, sw, sh, -bx, -by, sw + 2 * bx, sh + 2 * by);
  ctx.restore();
}
