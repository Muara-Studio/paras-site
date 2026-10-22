// PARAS: the main loop and the visit state machine (CONTRACT.md §4).
import { loadFace, loadSegmenter, fakeFace } from './face.js';
import * as K from './kit.js';
import * as Cam from './camera.js';
import { scan, extract, deconstruct } from './phases-a.js';
import { organize, reconstruct } from './phases-b.js';
import { release, end } from './release.js';

const q = new URLSearchParams(location.search);
const FAKE = q.has('fakeface');
let jump = q.get('phase');                       // dev: start straight at this phase
const AT = Number(q.get('at')) || 0;             // dev: …this many seconds in
const FREEZE = q.has('freeze');                  // dev: …and hold that moment

const VISIT = [scan, extract, deconstruct, organize, reconstruct, release, end];
const ALL = Object.fromEntries([Cam.standby, Cam.approach, Cam.reveal, ...VISIT].map(p => [p.name, p]));

const T = { BOOT: 1.8, GHOST: 0.7, CONFIRM: 0.25, OPEN: 1.5, CLOSE: 1.6, HOLD: 0.7, LOST: 0.5 };

// What PARAS says, per phase: [line, seconds into the phase] (CONTRACT.md §3).
const SUBS = {
  standby: [["Oh, hello. Step in.", 0.3], ["There's a place for everyone here.", 4.5]],
  approach: [["Closer. I can't make you out yet.", 0.2]],
  reveal: [['Found you.', 0.2], ['Stay with me, nearly done.', 1.4]],
  scan: [["Don't move.", 0], ['Let me work out who you are.', 0.7]],
  extract: [["I'll need to take you apart for a moment.", 0]],
  deconstruct: [["Relax. I'm keeping track of every piece.", 0]],
  organize: [['Now, where do you go…', 0], ['This slot looks right for you.', 1.8]],
  reconstruct: [['Assembling you again…', 0], ["Hm. That doesn't line up.", 2.9], ['One more try.', 3.3], ["There's no slot that fits you.", 3.9]],
  release: [['Nothing here could read you.', 1.1], ['Then why bend yourself to fit it?', 4.0]],
  end: [['Then why bend yourself to fit it?', -9]],
  nocam: [["It's dark in here. May I use your camera?", 0.3]],
};

const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d');
const begin = $('begin'), sub = $('sub'), subText = $('sub-text');
const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });

// The frame object every phase draws from (CONTRACT.md §2).
const f = { ctx, video, w: 1, h: 1, dpr: 1, u: 1, t: 0, dt: 0, now: 0, view: { s: 1, ox: 0, oy: 0 }, lm: null, face: null, mask: null, open: 0, X: {}, tone: 'dark' };

let phase, since = 0, armed = false, landmarker, segmenter, lmAt = -9, detectAt = 0, maskAt = 0, faceSince = null, fullSince = null;
let frames = 0, fps = 60, readAt = 0, subShown = '', subLine = '', frozen = false, bootAt = 0, ghost = true, nocamAt = null;

// The title block boots in place over T.BOOT: [selector, start s, length s, decrypt or plain typing].
const BOOT = [['#title h1', 0, 0.6, K.decrypt], ['.kicker', 0.3, 0.7, K.decrypt], ['.about', 0.6, 0.9, K.typed], ['.note', 1.3, 0.45, K.typed]]
  .map(([sel, at, d, fx]) => { const el = document.querySelector(sel); return { el, s: el.textContent, at, d, fx, v: null }; });

function go(p) {
  phase = p; since = f.now; f.t = 0; f.tone = p.tone;
  document.body.dataset.tone = p.tone;
  document.body.dataset.phase = p.name;
  $('num').textContent = p.step;
  $('status').textContent = `/ ${p.label}`;
  $('title').hidden = p.name !== 'standby';
  p.enter?.(f);
}

// lead: seconds of ghost-only standby before the chrome and title come back (the reboot after END).
function restart(lead = T.GHOST) { f.X = {}; f.open = 0; armed = false; frozen = false; bootAt = f.now + lead; go(Cam.standby); }

function layout() {
  f.dpr = Math.min(devicePixelRatio || 1, 2);
  f.w = innerWidth; f.h = innerHeight;
  f.u = K.clamp(Math.min(f.w, f.h) / 800, 0.75, 1.5);
  canvas.width = Math.round(f.w * f.dpr); canvas.height = Math.round(f.h * f.dpr);
}

async function startCamera() {
  $('nocam').hidden = true; nocamAt = null;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    await video.play();
  } catch (e) {
    console.warn('PARAS: camera', e);
    $('nocam').hidden = false; nocamAt = f.now;
    $('retry').focus();
  }
}

function track() {
  if (video.readyState < 2) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  let lm = null;
  if (FAKE) lm = fakeFace(f.now, vw, vh);
  else if (landmarker && f.now - detectAt >= 1 / 30) {
    detectAt = f.now;
    try { lm = landmarker.detectForVideo(video, performance.now()).faceLandmarks?.[0]?.map(p => [p.x * vw, p.y * vh, p.z * vw]) ?? null; } catch { return; }
  } else return;                                  // between detections: keep the last landmarks
  if (lm) { f.lm = lm; lmAt = f.now; } else if (f.now - lmAt > T.LOST) f.lm = null;

  const b = f.lm && Cam.faceBox(f);
  if (!b) { f.face = null; return; }
  const to = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2 }, k = 1 - Math.exp(-f.dt * 12);
  f.face = f.face ? { cx: K.lerp(f.face.cx, to.cx, k), cy: K.lerp(f.face.cy, to.cy, k), r: K.lerp(f.face.r, to.r, k) } : to;
}

function segment() {
  if (!phase.wantsMask || !segmenter || video.readyState < 2 || f.now - maskAt < 1 / 15) return;
  maskAt = f.now;
  try {
    segmenter.segmentForVideo(video, performance.now(), r => {
      const m = r.confidenceMasks?.[0];
      if (m) f.mask = { data: m.getAsFloat32Array().slice(), w: m.width, h: m.height };
    });
  } catch {}
}

// Phase changes: the face drives 01–03, the clock drives the rest.
function advance() {
  const t = f.now - since;
  if (jump && ALL[jump] && f.lm) { f.X = {}; go(ALL[jump]); since -= AT; frozen = FREEZE; jump = null; return; }
  if (phase === Cam.standby) { if (armed) go(Cam.approach); }
  else if (phase === Cam.approach) {
    faceSince = f.face ? faceSince ?? f.now : null;
    if (faceSince !== null && f.now - faceSince > T.CONFIRM) { f.open = 0; fullSince = null; go(Cam.reveal); }
  } else if (phase === Cam.reveal) {
    f.open = K.clamp(f.open + (f.face ? f.dt / T.OPEN : -f.dt / T.CLOSE));
    fullSince = f.open >= 1 ? fullSince ?? f.now : null;
    if (fullSince !== null && f.now - fullSince > T.HOLD) { f.X = {}; go(VISIT[0]); }
    else if (f.open <= 0 && !f.face) go(Cam.approach);
  } else if (!frozen && t >= phase.dur) {
    const next = VISIT[VISIT.indexOf(phase) + 1];
    next ? go(next) : restart();
  }
}

// Standby talks only once the title has booted; a denied camera overrides the phase's lines.
function subtitle() {
  const [key, from] = nocamAt !== null ? ['nocam', nocamAt] : [phase.name, phase === Cam.standby ? Math.max(since, bootAt + T.BOOT) : since];
  const t = f.now - from, line = (SUBS[key] ?? []).filter(l => l[1] <= t).at(-1), cur = line?.[0] ?? '';
  const s = line ? K.typed(cur, t - line[1]) : '';
  if (cur !== subLine) { subLine = cur; $('said').textContent = cur && `PARAS: ${cur}`; }  // screen readers get each line once
  if (s === subShown) return;
  subText.textContent = subShown = s;
  sub.hidden = !s;
  const typing = s.length < cur.length;
  sub.classList.toggle('typing', typing);
  sub.dataset.rest = cur.slice(s.length + (typing ? 1 : 0));  // the caret takes one slot of the untyped rest
}

function boot() {
  const t = f.now - bootAt, g = t < 0;
  if (g !== ghost) document.body.classList.toggle('ghost', ghost = g);
  const ready = phase === Cam.standby && t >= T.BOOT;
  if (begin.hidden === ready) begin.hidden = !ready;
  if (phase !== Cam.standby) return;
  for (const b of BOOT) {
    const v = t >= b.at + b.d ? b.s : t >= b.at ? b.fx(b.s, t - b.at, b.s.length / b.d) : '';
    if (v !== b.v) { b.el.textContent = b.v = v; b.el.dataset.rest = b.s.slice(v.length); }
  }
}

function readout() {
  if (f.now - readAt < 0.25) return;
  fps = Math.round(frames / (f.now - readAt || 1) * 10) / 10; frames = 0; readAt = f.now;
  $('readout').textContent = `FRAME: ${String(Math.floor(f.now * 60)).padStart(6, '0')}\nFPS: ${fps.toFixed(1)}\nSCAN [${f.lm ? 'ON' : 'OFF'}]`;
  $('fps').textContent = fps.toFixed(1);
}

function frame(ms) {
  const now = ms / 1000;
  f.dt = Math.min(0.1, Math.max(0, now - f.now)); f.now = now; frames++;
  if (!phase) restart(0);                         // boot from the first painted frame, not from navigation
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9, s = Math.max(f.w / vw, f.h / vh);
  f.view = { s, ox: (f.w - vw * s) / 2, oy: (f.h - vh * s) / 2 };

  track(); segment(); advance();
  f.t = frozen ? AT : f.now - since;

  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.globalAlpha = 1; ctx.filter = 'none';
  K.backdrop(f, phase.tone);
  ctx.save(); phase.draw(f); ctx.restore();
  Cam.pushHistory(f);
  boot(); subtitle(); readout();
  requestAnimationFrame(frame);
}

// DOM chrome
begin.onclick = () => { if (phase === Cam.standby) armed = true; };
$('retry').onclick = startCamera;
for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => $(b.dataset.open).showModal();
addEventListener('keydown', e => { if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !document.querySelector('dialog[open]')) restart(); });
addEventListener('resize', layout);

layout();
startCamera();
loadFace().then(m => { landmarker = m; return loadSegmenter(); }).then(m => { segmenter = m; }).catch(e => console.warn('PARAS: model', e));
requestAnimationFrame(frame);
