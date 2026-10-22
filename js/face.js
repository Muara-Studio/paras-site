// Face + body tracking: MediaPipe Tasks Vision from jsDelivr, models from Google's bucket.
// Frames stay in the browser; only the library and model files are downloaded.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

// Filled by loadFace(): mesh edges as [a, b] index pairs, and landmark index sets per feature.
export let TESS = [];
export let OVAL = [];
export const PARTS = { EYES: [], NOSE: [], MOUTH: [], CONTOURS: [] };

// MediaPipe has no nose connection set; these are the canonical-mesh nose indices.
const NOSE = [1, 2, 4, 5, 6, 19, 45, 48, 64, 94, 97, 98, 115, 168, 195, 197, 220, 275, 278, 294, 326, 327, 344, 440];

let vision;
const loadVision = () => vision ??= (async () => {
  const m = await import(`${CDN}/vision_bundle.mjs`);
  return { m, files: await m.FilesetResolver.forVisionTasks(`${CDN}/wasm`) };
})();

const pairs = c => c.map(e => [e.start, e.end]);
const ids = (...sets) => [...new Set(sets.flat().flatMap(e => [e.start, e.end]))];

export async function loadFace() {
  const { m, files } = await loadVision();
  const F = m.FaceLandmarker;
  TESS = pairs(F.FACE_LANDMARKS_TESSELATION);
  OVAL = pairs(F.FACE_LANDMARKS_FACE_OVAL);
  PARTS.EYES = ids(F.FACE_LANDMARKS_LEFT_EYE, F.FACE_LANDMARKS_RIGHT_EYE, F.FACE_LANDMARKS_LEFT_EYEBROW, F.FACE_LANDMARKS_RIGHT_EYEBROW);
  PARTS.NOSE = NOSE;
  PARTS.MOUTH = ids(F.FACE_LANDMARKS_LIPS);
  PARTS.CONTOURS = ids(F.FACE_LANDMARKS_FACE_OVAL);
  const make = delegate => F.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    // forgiving thresholds: dim rooms, glasses, a turned head
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  return make('GPU').catch(() => make('CPU'));
}

export async function loadSegmenter() {
  const { m, files } = await loadVision();
  return m.ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${MODELS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`, delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

// ?fakeface: MediaPipe's canonical face mesh (Apache-2.0), 468 points, unit height, y down.
let fake;
fetch(new URL('./fakeface.json', import.meta.url)).then(r => r.json()).then(d => { fake = d; }).catch(() => {});

// Landmarks in video px for a pretend face that sways a little.
export function fakeFace(now, vw, vh) {
  if (!fake) return null;
  const h = vh * 0.5, cx = vw * (0.5 + 0.03 * Math.sin(now * 0.7)), cy = vh * 0.48;
  return fake.map(p => [cx + p[0] * h, cy + p[1] * h, p[2] * h]);
}
