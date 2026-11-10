// Pure environment-scan logic shared by the student scan page and the local Roboflow proxy.
// No browser or import.meta APIs here so it runs in Node check scripts and server code.

// The scan has two steps ("angles" in the state below): a 360-degree room sweep and a desk check.
export const SCAN_ANGLES = [
  { id: "sweep", title: "Room Sweep", instruction: "Hold the camera at chest height and turn slowly in a full circle until you face where you started." },
  { id: "desk", title: "Desk Check", instruction: "Point the camera down and show your whole desk or work surface." },
];
export const SCAN_ANGLE_IDS = SCAN_ANGLES.map((angle) => angle.id);
// Burst size for the desk check; the sweep keeps its own distinct views instead.
export const SCAN_FRAMES_PER_ANGLE = 3;

export const SCAN_OUTCOME = {
  CLEAR: "clear",
  RISK: "risk_detected",
  RESCAN: "rescan_required",
  TECHNICAL: "technical_error",
};

export const ANGLE_STATUS = {
  PENDING: "pending",
  CAPTURING: "capturing",
  ANALYZING: "analyzing",
  APPROVED: "approved",
  REJECTED: "rejected",
  RECAPTURE: "recapture",
  ERROR: "error",
};

// Lowest confidence any rule reads; detectors are asked for predictions down to this level so
// borderline results become "rescan_required" instead of being silently dropped or failing the scan.
export const SCAN_REQUEST_CONFIDENCE = 0.3;
// A notes/book box smaller than this share of the frame is background decor (e.g. a bookshelf),
// except on the desk view where anything within reach counts.
export const NEAR_OBJECT_MIN_AREA = 0.03;
export const MIN_FRAME_BRIGHTNESS = 30;
export const MIN_FRAME_TEXTURE = 2;
export const DUPLICATE_VIEW_DISTANCE = 4;

// floor: lowest confidence considered at all; flag: confirmed when seen in 2+ frames;
// strong: confirmed from a single frame. Anything between floor and a confirmation is uncertain and approved.
// countBased rules allow `allowed` instances per frame (the student).
// steps: which scan steps a rule judges. Items only count on the desk check, where they would be within reach;
// the room sweep only looks for another person, so things elsewhere in the room never fail the scan.
// Rules match in order, so "laptop screen" is a laptop.
const DESK_ONLY = ["desk"];
export const DETECTION_RULES = [
  { category: "smartwatch", label: "Smartwatch", match: /\bsmart ?watch(es)?\b/, floor: 0.3, flag: 0.5, strong: 0.75, steps: DESK_ONLY },
  { category: "phone", label: "Phone", match: /\b(cell ?phones?|mobile ?phones?|smart ?phones?|phones?|iphones?|android( phone)?|handphones?|cellular( phone)?|mobile)\b/, floor: 0.3, flag: 0.5, strong: 0.75, steps: DESK_ONLY },
  { category: "tablet", label: "Tablet", match: /\b(tablets?|ipads?)\b/, floor: 0.3, flag: 0.5, strong: 0.75, steps: DESK_ONLY },
  { category: "calculator", label: "Calculator", match: /\bcalculators?\b/, floor: 0.3, flag: 0.5, strong: 0.75, steps: DESK_ONLY },
  // Any reliably detected laptop is prohibited, including a single one.
  { category: "laptop", label: "Laptop", match: /\blaptops?\b/, floor: 0.45, flag: 0.6, strong: 0.85, steps: DESK_ONLY },
  { category: "second_screen", label: "Second monitor or screen", match: /\b(tv|television|monitors?|screens?)\b/, floor: 0.4, flag: 0.6, strong: 0.8, steps: DESK_ONLY },
  { category: "notes", label: "Notes or papers", match: /\b(notes?|papers?|notebooks?|sticky notes?|cheat ?sheets?|documents?)\b/, floor: 0.35, flag: 0.55, strong: 0.8, nearOnly: true, steps: DESK_ONLY },
  { category: "book", label: "Book", match: /\b(books?|open book)\b/, floor: 0.4, flag: 0.6, strong: 0.8, nearOnly: true, steps: DESK_ONLY },
  { category: "person", label: "Another person", match: /^(person|people|human|man|woman)$/, floor: 0.4, flag: 0.6, strong: 0.85, countBased: true, allowed: 1, steps: ["sweep", "desk"] },
];

// Detectors that only guess (OWL-ViT is asked for each item by name and often names things that are not there).
// Their answers never decide on their own: they only count for an item a trained detector or Gemini also saw.
export const GUESSING_DETECTORS = new Set(["owl"]);

// Older pages sent five room angles; anything that is not the desk is judged like the room sweep.
function ruleAppliesToStep(rule, angleId) {
  return rule.steps.includes(angleId === "desk" ? "desk" : "sweep");
}

// Never flagged even if a detector reports them; listed so the intent is explicit.
export const IGNORED_LABELS = ["keyboard", "mouse", "chair", "couch", "bed", "dining table", "desk", "wall", "potted plant", "clock", "vase", "cup", "bottle", "lamp", "remote"];

export function normalizeLabel(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// Earbuds, earphones, headphones and headsets are allowed in the scan and during the exam. Checked before the rules
// so "ear phones" or "head phones" is never read as a phone.
export const ALLOWED_AUDIO_DEVICES = /\b(ear ?buds?|ear ?phones?|head ?phones?|head ?sets?|airpods?)\b/;

export function findDetectionRule(label) {
  const normalized = normalizeLabel(label);
  if (!normalized || IGNORED_LABELS.includes(normalized) || ALLOWED_AUDIO_DEVICES.test(normalized)) return null;
  return DETECTION_RULES.find((rule) => rule.match.test(normalized)) || null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Returns { label, confidence, areaRatio } or null when the prediction is unusable.
export function normalizePrediction(raw, image = {}) {
  if (!raw || typeof raw !== "object") return null;
  const label = normalizeLabel(raw.class ?? raw.label ?? raw.name ?? raw.class_name);
  const confidence = finiteNumber(raw.confidence ?? raw.score ?? raw.probability);
  if (!label || confidence === null || confidence < 0 || confidence > 1) return null;

  const imageWidth = finiteNumber(raw.imageWidth ?? image.width);
  const imageHeight = finiteNumber(raw.imageHeight ?? image.height);
  const bbox = Array.isArray(raw.bbox) ? raw.bbox : null;
  const boxWidth = finiteNumber(raw.width ?? bbox?.[2]);
  const boxHeight = finiteNumber(raw.height ?? bbox?.[3]);
  const givenAreaRatio = finiteNumber(raw.areaRatio);
  const areaRatio = givenAreaRatio !== null
    ? givenAreaRatio
    : imageWidth > 0 && imageHeight > 0 && boxWidth > 0 && boxHeight > 0
      ? Math.min(1, (boxWidth * boxHeight) / (imageWidth * imageHeight))
      : null;

  const source = typeof raw.source === "string" ? raw.source : "";
  return { label, confidence, areaRatio, guess: raw.guess === true || GUESSING_DETECTORS.has(source) };
}

export class MalformedDetectorResponseError extends Error {
  constructor(message = "The detector returned an unexpected response.") {
    super(message);
    this.name = "MalformedDetectorResponseError";
  }
}

function parsePredictionList(list, image) {
  if (!Array.isArray(list)) throw new MalformedDetectorResponseError();
  return list.map((item) => normalizePrediction(item, image)).filter(Boolean);
}

// Accepts the response shapes the scan detectors produce and returns
// { frames: [{ predictions: [{ label, confidence, areaRatio }] }] }.
// Throws for errors and anything malformed so they become technical failures, never findings.
export function parseDetectorResponse(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MalformedDetectorResponseError();
  if (typeof raw.error === "string" && raw.error) throw new Error(raw.error);

  if (Array.isArray(raw.frames)) {
    return {
      frames: raw.frames.map((frame) => {
        if (!frame || typeof frame !== "object") throw new MalformedDetectorResponseError();
        return { predictions: parsePredictionList(frame.predictions, frame.image) };
      }),
    };
  }
  if (Array.isArray(raw.predictions)) {
    return { frames: [{ predictions: parsePredictionList(raw.predictions, raw.image) }] };
  }
  // Legacy { passed, findings } responses: findings carry label and confidence only.
  if (typeof raw.passed === "boolean" && Array.isArray(raw.findings)) {
    return { frames: [{ predictions: parsePredictionList(raw.findings) }] };
  }
  throw new MalformedDetectorResponseError();
}

function percent(confidence) {
  return `${Math.round(confidence * 100)}%`;
}

// Classifies one angle's detections. `frames` is [{ predictions }] where predictions may come from
// several detectors. Returns { outcome, findings } with outcome clear | risk_detected: only items that are
// confirmed fail a step, and an uncertain sighting approves it rather than asking for a retake.
export function classifyAngleDetections({ angleId, frames = [] }) {
  const frameCount = Math.max(1, frames.length);
  const consensusFrames = Math.min(2, frameCount);
  const findings = [];

  DETECTION_RULES.filter((rule) => ruleAppliesToStep(rule, angleId)).forEach((rule) => {
    let framesAtFloor = 0;
    let framesAtFlag = 0;
    let maxConfidence = 0;
    // Which photos the item was seen in, so saved scan history can point at them.
    const frameIndexes = [];
    const ruleMatches = frames.map((frame) => (frame?.predictions || [])
      .map((prediction) => normalizePrediction(prediction))
      .filter((prediction) => prediction && findDetectionRule(prediction.label) === rule)
      .filter((prediction) => !(rule.nearOnly && angleId !== "desk" && prediction.areaRatio !== null && prediction.areaRatio < NEAR_OBJECT_MIN_AREA)));
    // A guessing detector's answers only count when a reliable detector also saw this item in the step.
    const reliablySeen = ruleMatches.some((matches) => matches.some((prediction) => !prediction.guess && prediction.confidence >= rule.floor));

    ruleMatches.forEach((frameMatches, frameIndex) => {
      const matches = reliablySeen ? frameMatches : frameMatches.filter((prediction) => !prediction.guess);

      if (rule.countBased) {
        const atFloor = matches.filter((item) => item.confidence >= rule.floor).sort((a, b) => b.confidence - a.confidence);
        const atFlag = atFloor.filter((item) => item.confidence >= rule.flag);
        if (atFloor.length > rule.allowed) {
          framesAtFloor += 1;
          frameIndexes.push(frameIndex);
          maxConfidence = Math.max(maxConfidence, atFloor[rule.allowed].confidence);
        }
        if (atFlag.length > rule.allowed) framesAtFlag += 1;
        return;
      }

      const best = matches.reduce((max, item) => Math.max(max, item.confidence), 0);
      if (best >= rule.floor) {
        framesAtFloor += 1;
        frameIndexes.push(frameIndex);
      }
      if (best >= rule.flag) framesAtFlag += 1;
      maxConfidence = Math.max(maxConfidence, best);
    });

    if (!framesAtFloor) return;
    const confirmed = rule.countBased
      ? framesAtFlag >= consensusFrames || maxConfidence >= rule.strong
      : maxConfidence >= rule.strong || (framesAtFlag >= 1 && framesAtFloor >= consensusFrames);
    // Not sure it is really there: approve instead of sending the student back.
    if (!confirmed) return;

    findings.push({
      angle: angleId,
      category: rule.category,
      label: `${rule.label} detected`,
      confidence: maxConfidence,
      detected: true,
      frameIndexes,
      severity: "risk",
      reason: rule.category === "person"
        ? `Another person was detected (${percent(maxConfidence)}). Make sure you are alone, then retake this step.`
        : `${rule.label} detected (${percent(maxConfidence)}) on your desk. Remove it, then retake this step.`,
    });
  });

  return { outcome: findings.length ? SCAN_OUTCOME.RISK : SCAN_OUTCOME.CLEAR, findings };
}

// Merges detector results frame-by-frame so one frame's predictions from Roboflow and COCO-SSD
// are judged together.
export function mergeDetectorFrames(results, frameCount) {
  const merged = Array.from({ length: Math.max(1, frameCount) }, () => ({ predictions: [] }));
  results.forEach((result) => {
    const frames = result?.frames || [];
    // A single-frame result (a legacy { passed, findings } summary) already covers the whole capture,
    // so it counts for every frame instead of failing multi-frame consensus.
    if (frames.length === 1) {
      merged.forEach((target) => target.predictions.push(...(frames[0].predictions || [])));
      return;
    }
    frames.forEach((frame, index) => {
      const target = merged[Math.min(index, merged.length - 1)];
      target.predictions.push(...(frame.predictions || []));
    });
  });
  return merged;
}

export function withTimeout(promise, timeoutMs, message = "The environment check timed out.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timer));
}

function describeTechnicalFailure(errors) {
  const text = errors.map((error) => (error instanceof Error ? error.message : String(error || ""))).join(" ");
  if (/timed? ?out|abort/i.test(text)) return "The environment check timed out. This is not a violation. Retry the check.";
  if (/network|fetch|offline|failed to/i.test(text)) return "The environment check could not reach the detection service. This is not a violation. Retry the check.";
  return "The environment check could not be completed. This is not a violation. Retry the check.";
}

// Runs every available primary detector in parallel; fallbacks only run when no primary detector
// produced a usable result. Never throws: detector errors, timeouts and malformed responses become
// a technical_error outcome, which is never treated as a finding.
// A detector is async (frames) => rawResponse | null (null = not configured).
// requiredDetectors run with the primaries and must each return a usable result, otherwise the
// angle is unchecked: a configured server-side detector cannot be bypassed by browser-only results.
export async function analyzeAngleCapture({ angleId, frames, requiredDetectors = [], detectors = [], fallbackDetectors = [], timeoutMs = 15000 }) {
  const frameCount = frames?.length || 0;
  if (!frameCount) return { outcome: SCAN_OUTCOME.TECHNICAL, findings: [], reason: "No image was captured for this step. Retake it." };

  const errors = [];
  let requiredMissing = false;
  async function runGroup(group, requiredCount = 0) {
    const settled = await Promise.allSettled(group.map((detector) => withTimeout(Promise.resolve().then(() => detector(frames)), timeoutMs)));
    const parsed = [];
    settled.forEach((entry, index) => {
      const required = index < requiredCount;
      if (entry.status === "rejected") {
        errors.push(entry.reason);
        if (required) requiredMissing = true;
        return;
      }
      if (entry.value === null || entry.value === undefined) {
        if (required) requiredMissing = true;
        return;
      }
      try {
        parsed.push(parseDetectorResponse(entry.value));
      } catch (error) {
        errors.push(error);
        if (required) requiredMissing = true;
      }
    });
    return parsed;
  }

  let results = await runGroup([...requiredDetectors, ...detectors], requiredDetectors.length);
  if (requiredMissing) {
    return { outcome: SCAN_OUTCOME.TECHNICAL, findings: [], reason: errors.length ? describeTechnicalFailure(errors) : "The environment check could not be completed. This is not a violation. Retry the check." };
  }
  if (!results.length && fallbackDetectors.length) results = await runGroup(fallbackDetectors);
  if (!results.length) {
    // No detector ran (none configured or all failed): the angle is unchecked, never approved.
    if (!errors.length) return { outcome: SCAN_OUTCOME.TECHNICAL, findings: [], reason: "No environment detector is available right now. This is not a violation. Retry the check.", detectorCount: 0 };
    return { outcome: SCAN_OUTCOME.TECHNICAL, findings: [], reason: describeTechnicalFailure(errors) };
  }

  const classification = classifyAngleDetections({ angleId, frames: mergeDetectorFrames(results, frameCount) });
  return {
    ...classification,
    // A confirmed item explains a rejection better than an uncertain one listed before it.
    reason: (classification.findings.find((finding) => finding.detected) || classification.findings[0])?.reason || "",
    detectorCount: results.length,
  };
}

// --- Capture quality -------------------------------------------------------------------------

export function getSignatureBrightness(signature) {
  if (!signature?.length) return 0;
  return signature.reduce((sum, value) => sum + value, 0) / signature.length;
}

export function getSignatureTexture(signature) {
  if (!signature?.length) return 0;
  const average = getSignatureBrightness(signature);
  return Math.sqrt(signature.reduce((sum, value) => sum + ((value - average) ** 2), 0) / signature.length);
}

export function getSignatureDistance(previous, next) {
  if (!previous?.length || !next?.length || previous.length !== next.length) return Number.POSITIVE_INFINITY;
  return next.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0) / next.length;
}

// Only rejects frames that cannot show anything (lens covered, very dark, blank); plain walls pass.
export function assessCaptureQuality(signatures = []) {
  if (!signatures.length) return { ok: false, reason: "No image was captured. Make sure the camera is on, then retake this step." };
  const usable = signatures.filter((signature) => getSignatureBrightness(signature) >= MIN_FRAME_BRIGHTNESS && getSignatureTexture(signature) >= MIN_FRAME_TEXTURE);
  if (usable.length * 2 > signatures.length) return { ok: true, reason: "" };
  const dark = signatures.filter((signature) => getSignatureBrightness(signature) < MIN_FRAME_BRIGHTNESS).length * 2 > signatures.length;
  return {
    ok: false,
    reason: dark
      ? "The image is too dark. Turn on a light, then retake this step."
      : "The image looks blank or covered. Uncover the camera and point it at your surroundings, then retake this step.",
  };
}

// Returns the id of another captured angle whose view is practically identical (camera not moved).
export function findDuplicateAngle(angleId, signature, capturedSignatures = {}) {
  return Object.entries(capturedSignatures).find(([otherId, otherSignature]) => (
    otherId !== angleId && otherSignature && getSignatureDistance(otherSignature, signature) < DUPLICATE_VIEW_DISTANCE
  ))?.[0] || null;
}

// --- Room sweep --------------------------------------------------------------------------------
// The bar follows how far the camera actually turned. A laptop webcam has no motion sensor, so the turn is
// measured from the pictures: each sample is compared with a reference picture to find how far the view slid
// sideways. Turning the camera slides the whole picture; a person moving, camera noise or the light changing
// does not, so a camera kept in one spot adds nothing. The slides add up to degrees, and the bar is full at
// 360 degrees. Turning back over a part already shown adds nothing either: progress is the span of directions
// the camera has faced.

export const SWEEP_SAMPLE_INTERVAL_MS = 200;
export const SWEEP_MAX_MS = 120000;
// Samples are measured on a small grayscale picture of this size.
export const TURN_ANALYSIS_WIDTH = 160;
export const TURN_ANALYSIS_HEIGHT = 90;
// Typical laptop webcam width of view. Turns a sideways slide (share of the picture width) into degrees.
export const CAMERA_HORIZONTAL_FOV_DEGREES = 65;
// Largest slide looked for between two pictures, as a share of the width (about 13 degrees). A bigger jump in
// 0.2 s means the camera turned too fast to follow, and that part of the turn is not counted.
export const TURN_MAX_SHIFT_RATIO = 0.2;
// How alike two pictures must be at the best slide to trust it; below this the camera lost track
// (too fast, too dark, or a plain wall with nothing to follow).
export const TURN_MIN_MATCH = 0.6;
// Slides of a pixel or less are camera noise, not turning.
export const TURN_DEAD_ZONE_PX = 1;
export const SWEEP_FULL_TURN_DEGREES = 360;
// Done unlocks this close to a full turn. The degree estimate depends on the camera's real width of view, so a
// full turn can read a little short; coming back to the starting view after most of a turn also finishes it.
export const SWEEP_DONE_DEGREES = 330;
export const SWEEP_RETURN_MIN_DEGREES = 300;
// Ending this close (view distance) to one of the first samples counts as being back at the start. The first few
// samples are used because the very first one is often taken while the student is still settling.
export const SWEEP_RETURN_DISTANCE = 20;
export const SWEEP_START_VIEWS = 3;
// A photo is kept for the AI check every time the camera faces a new direction this far from the kept ones.
export const SWEEP_IMAGE_STEP_DEGREES = 30;
// At most this many photos are sent to the detectors, spread evenly over the sweep.
export const SWEEP_MAX_FRAMES = 12;
// How long a "too fast" or "lost track" hint stays up after it happened.
export const SWEEP_HINT_MS = 1500;

function centered(signature) {
  const average = getSignatureBrightness(signature);
  return signature.map((value) => value - average);
}

// View distance that ignores overall brightness, so the camera's auto exposure is not a different view.
export function getViewDistance(previous, next) {
  if (!previous?.length || !next?.length || previous.length !== next.length) return Number.POSITIVE_INFINITY;
  return getSignatureDistance(centered(previous), centered(next));
}

// 12 x 8 block averages of a grayscale picture (values 0-255, row by row): the signature used for picture
// quality, the desk duplicate check and the return to the start. Averaging blocks keeps camera noise out.
export function getGraySignature(gray, width, height, columns = 12, rows = 8) {
  const signature = [];
  for (let row = 0; row < rows; row += 1) {
    const top = Math.floor((row * height) / rows);
    const bottom = Math.max(top + 1, Math.floor(((row + 1) * height) / rows));
    for (let column = 0; column < columns; column += 1) {
      const left = Math.floor((column * width) / columns);
      const right = Math.max(left + 1, Math.floor(((column + 1) * width) / columns));
      let sum = 0;
      let count = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      signature.push(count ? sum / count : 0);
    }
  }
  return signature;
}

// How much detail each column of the picture has (sum of brightness changes to the next column). A turning
// camera slides this profile sideways; it ignores how bright the picture is overall.
export function getColumnProfile(gray, width, height) {
  const raw = new Array(Math.max(0, width - 1)).fill(0);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width - 1; x += 1) raw[x] += Math.abs(gray[rowStart + x + 1] - gray[rowStart + x]);
  }
  // Light smoothing so single noisy pixels do not decide the match.
  return raw.map((_, x) => (raw[Math.max(0, x - 1)] + raw[x] + raw[Math.min(raw.length - 1, x + 1)]) / 3);
}

// Share (0..1) of the shared columns where previous[x + slide] and next[x] agree. Both profiles are first scaled to
// the same average, so the picture getting brighter or darker does not matter. Counting agreeing columns (instead
// of one overall similarity) means a person moving through part of the picture cannot outvote the still room
// around them: when the camera is still, the room's columns all agree at "no slide".
export const TURN_COLUMN_TOLERANCE = 0.2;

function scaleToAverage(profile) {
  const average = profile.reduce((sum, value) => sum + value, 0) / (profile.length || 1);
  return average > 0 ? profile.map((value) => value / average) : null;
}

function profileAgreement(previous, next, slide) {
  const start = Math.max(0, -slide);
  const end = Math.min(next.length, previous.length - slide);
  const count = end - start;
  if (count < 8) return 0;
  let agreeing = 0;
  for (let x = start; x < end; x += 1) {
    const a = previous[x + slide];
    const b = next[x];
    if (Math.abs(a - b) <= TURN_COLUMN_TOLERANCE * Math.max(1, (a + b) / 2)) agreeing += 1;
  }
  return agreeing / count;
}

// A picture with almost no detail (a plain wall, a covered lens, darkness) cannot be followed.
function hasDetail(profile, width) {
  const average = profile.reduce((sum, value) => sum + value, 0) / (profile.length || 1);
  const spread = Math.sqrt(profile.reduce((sum, value) => sum + (value - average) ** 2, 0) / (profile.length || 1));
  return average >= width * 0.02 && spread >= average * 0.08;
}

// Finds how far the view slid between two column profiles. Returns { shift, match, atEdge } where shift is in
// pixels (positive: the picture moved left, the camera turned right), match is the share of columns that agree at
// that slide, and atEdge means the best slide was the largest one looked for (likely turned even further).
// Returns null when either picture has too little detail to follow.
export function estimateTurnShift(previous, next, maxShift) {
  if (!previous?.length || !next?.length || previous.length !== next.length) return null;
  if (!hasDetail(previous, previous.length) || !hasDetail(next, next.length)) return null;
  const a = scaleToAverage(previous);
  const b = scaleToAverage(next);
  if (!a || !b) return null;
  let bestSlide = 0;
  let bestMatch = -Infinity;
  const matches = new Map();
  for (let slide = -maxShift; slide <= maxShift; slide += 1) {
    const match = profileAgreement(a, b, slide);
    matches.set(slide, match);
    // Ties go to the smaller slide, so a still picture never drifts.
    if (match > bestMatch + 1e-9 || (Math.abs(match - bestMatch) <= 1e-9 && Math.abs(slide) < Math.abs(bestSlide))) {
      bestMatch = match;
      bestSlide = slide;
    }
  }
  let shift = bestSlide;
  const before = matches.get(bestSlide - 1);
  const after = matches.get(bestSlide + 1);
  if (before !== undefined && after !== undefined) {
    // Fit a curve through the best slide and its neighbours for a fraction-of-a-pixel estimate.
    const curve = before - 2 * bestMatch + after;
    if (curve < 0) shift += Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / curve));
  }
  return { shift, match: bestMatch, atEdge: Math.abs(bestSlide) >= maxShift };
}

export function shiftToDegrees(shiftPx, width) {
  if (!width) return 0;
  const shift = Math.abs(shiftPx) <= TURN_DEAD_ZONE_PX ? 0 : shiftPx;
  return (shift / width) * CAMERA_HORIZONTAL_FOV_DEGREES;
}

function isReliableShift(estimate) {
  return Boolean(estimate) && estimate.match >= TURN_MIN_MATCH && !estimate.atEdge;
}

export function createSweep(startedAt) {
  return {
    startedAt,
    lastAt: startedAt,
    heading: 0,
    minHeading: 0,
    maxHeading: 0,
    anchor: null,
    lastSample: null,
    views: [],
    startSignatures: [],
    lastSignature: null,
    tooFastAt: null,
    lostAt: null,
  };
}

// Adds one sample: `profile` from getColumnProfile, `signature` from getGraySignature. `getImage` is called only
// when this sample faces a new direction, so the caller encodes a photo only when it is kept.
export function recordSweepSample(sweep, { profile, signature, timestamp, getImage = null }) {
  const width = profile?.length || 0;
  const maxShift = Math.max(2, Math.round(width * TURN_MAX_SHIFT_RATIO));
  let { heading, anchor, tooFastAt, lostAt } = sweep;

  if (!anchor) {
    anchor = { profile, heading };
  } else {
    // Measured against a fixed reference picture so slow turns add up and noise does not.
    const fromAnchor = estimateTurnShift(anchor.profile, profile, maxShift);
    if (isReliableShift(fromAnchor)) {
      heading = anchor.heading + shiftToDegrees(fromAnchor.shift, width);
      if (Math.abs(fromAnchor.shift) >= maxShift / 2) anchor = { profile, heading };
    } else {
      // The view changed too much for the reference: try the previous sample, then start a new reference here.
      const fromLast = sweep.lastSample ? estimateTurnShift(sweep.lastSample.profile, profile, maxShift) : null;
      if (isReliableShift(fromLast)) heading = sweep.lastSample.heading + shiftToDegrees(fromLast.shift, width);
      else if (fromAnchor?.atEdge || fromLast?.atEdge) tooFastAt = timestamp;
      else lostAt = timestamp;
      anchor = { profile, heading };
    }
  }

  const facesNewDirection = sweep.views.every((view) => Math.abs(view.heading - heading) >= SWEEP_IMAGE_STEP_DEGREES);
  const image = facesNewDirection && getImage ? getImage() : null;
  return {
    ...sweep,
    heading,
    minHeading: Math.min(sweep.minHeading, heading),
    maxHeading: Math.max(sweep.maxHeading, heading),
    anchor,
    lastSample: { profile, heading },
    views: image ? [...sweep.views, { signature, image, timestamp, heading }] : sweep.views,
    startSignatures: sweep.startSignatures.length < SWEEP_START_VIEWS ? [...sweep.startSignatures, signature] : sweep.startSignatures,
    lastSignature: signature,
    lastAt: timestamp,
    tooFastAt,
    lostAt,
  };
}

export function getSweepProgress(sweep, now = sweep.lastAt) {
  const elapsedMs = Math.max(0, now - sweep.startedAt);
  const turnedDegrees = Math.max(0, sweep.maxHeading - sweep.minHeading);
  const startDistance = Math.min(Number.POSITIVE_INFINITY, ...sweep.startSignatures.map((signature) => getViewDistance(signature, sweep.lastSignature)));
  const backAtStart = turnedDegrees >= SWEEP_RETURN_MIN_DEGREES && startDistance < SWEEP_RETURN_DISTANCE;
  const complete = turnedDegrees >= SWEEP_FULL_TURN_DEGREES || backAtStart;
  const tooFast = sweep.tooFastAt !== null && sweep.lastAt - sweep.tooFastAt < SWEEP_HINT_MS;
  return {
    elapsedMs,
    turnedDegrees,
    // The bar only moves while the camera turns, and is full after a full circle.
    coverage: complete ? 1 : Math.min(0.99, turnedDegrees / SWEEP_FULL_TURN_DEGREES),
    complete,
    canFinish: complete || turnedDegrees >= SWEEP_DONE_DEGREES,
    backAtStart,
    startImage: sweep.views[0]?.image || null,
    tooFast,
    lostTrack: !tooFast && sweep.lostAt !== null && sweep.lastAt - sweep.lostAt < SWEEP_HINT_MS,
    timedOut: elapsedMs >= SWEEP_MAX_MS,
  };
}

function spreadEvenly(items, count) {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]);
}

// Judges a finished sweep. Returns { ok: true, frames, signature } or { ok: false, reason }.
export function finishSweep(sweep, now = sweep.lastAt) {
  const progress = getSweepProgress(sweep, now);
  const quality = assessCaptureQuality(sweep.views.map((view) => view.signature));
  if (sweep.views.length && !quality.ok) return { ok: false, reason: quality.reason.replace("retake this step", "redo the room sweep") };
  if (!progress.canFinish || !sweep.views.length) {
    return {
      ok: false,
      reason: `The camera turned only about ${Math.round(progress.turnedDegrees)} degrees. Turn slowly all the way around until you face where you started, then redo the room sweep.`,
    };
  }
  return {
    ok: true,
    frames: spreadEvenly(sweep.views, SWEEP_MAX_FRAMES).map((view) => ({ image: view.image, timestamp: view.timestamp, angle: "sweep" })),
    signature: sweep.views[0].signature,
  };
}

// --- Completion state ------------------------------------------------------------------------

function emptyAngle(id) {
  return { id, status: ANGLE_STATUS.PENDING, captureId: null, requestId: null, frames: [], signature: null, findings: [], reason: "" };
}

export function createScanState(sessionId = 1) {
  return { sessionId, angles: Object.fromEntries(SCAN_ANGLE_IDS.map((id) => [id, emptyAngle(id)])) };
}

function updateAngle(state, angleId, patch) {
  return { ...state, angles: { ...state.angles, [angleId]: { ...state.angles[angleId], ...patch } } };
}

const RESOLVED_STATUS = {
  [SCAN_OUTCOME.CLEAR]: ANGLE_STATUS.APPROVED,
  [SCAN_OUTCOME.RISK]: ANGLE_STATUS.REJECTED,
  [SCAN_OUTCOME.RESCAN]: ANGLE_STATUS.RECAPTURE,
  [SCAN_OUTCOME.TECHNICAL]: ANGLE_STATUS.ERROR,
};

// Every async result carries the captureId/requestId it was started with; results for a superseded
// capture, a retaken angle or a reset scan no longer match and are ignored.
export function scanReducer(state, action) {
  if (action.type === "reset") return createScanState((state?.sessionId || 0) + 1);
  const angle = state.angles[action.angleId];
  if (!angle) return state;

  switch (action.type) {
    case "capture_started":
      if (angle.status === ANGLE_STATUS.CAPTURING) return state;
      return updateAngle(state, action.angleId, { status: ANGLE_STATUS.CAPTURING, captureId: action.captureId, requestId: null, findings: [], reason: "" });
    case "capture_failed":
      if (angle.captureId !== action.captureId || angle.status !== ANGLE_STATUS.CAPTURING) return state;
      return updateAngle(state, action.angleId, { status: ANGLE_STATUS.RECAPTURE, frames: [], signature: null, reason: action.reason || "Capture failed. Retake this step." });
    case "capture_succeeded":
      if (angle.captureId !== action.captureId || angle.status !== ANGLE_STATUS.CAPTURING || !action.frames?.length) return state;
      return updateAngle(state, action.angleId, { status: ANGLE_STATUS.ANALYZING, frames: action.frames, signature: action.signature || null, requestId: null, reason: "" });
    case "analysis_started":
      if (!angle.frames.length || ![ANGLE_STATUS.ANALYZING, ANGLE_STATUS.ERROR].includes(angle.status)) return state;
      if (angle.status === ANGLE_STATUS.ANALYZING && angle.requestId) return state;
      return updateAngle(state, action.angleId, { status: ANGLE_STATUS.ANALYZING, requestId: action.requestId, findings: [], reason: "" });
    case "analysis_resolved": {
      if (!action.requestId || angle.requestId !== action.requestId || angle.status !== ANGLE_STATUS.ANALYZING) return state;
      const status = RESOLVED_STATUS[action.outcome] || ANGLE_STATUS.ERROR;
      const reason = action.reason || (status === ANGLE_STATUS.ERROR ? "The environment check could not be completed. This is not a violation. Retry the check." : "");
      return updateAngle(state, action.angleId, { status, findings: action.findings || [], reason: status === ANGLE_STATUS.APPROVED ? "" : reason });
    }
    case "retake":
      return updateAngle(state, action.angleId, emptyAngle(action.angleId));
    default:
      return state;
  }
}

const CAPTURED_STATUSES = new Set([ANGLE_STATUS.ANALYZING, ANGLE_STATUS.APPROVED, ANGLE_STATUS.REJECTED, ANGLE_STATUS.RECAPTURE, ANGLE_STATUS.ERROR]);

export function isAngleCaptured(angle) {
  return Boolean(angle?.frames?.length) && CAPTURED_STATUSES.has(angle.status);
}

export function summarizeScan(state) {
  const angles = SCAN_ANGLE_IDS.map((id) => state.angles[id]);
  const idsWith = (status) => angles.filter((angle) => angle.status === status).map((angle) => angle.id);
  const capturedCount = angles.filter(isAngleCaptured).length;
  const approvedCount = idsWith(ANGLE_STATUS.APPROVED).length;
  const rejectedIds = idsWith(ANGLE_STATUS.REJECTED);
  const recaptureIds = idsWith(ANGLE_STATUS.RECAPTURE);
  const errorIds = idsWith(ANGLE_STATUS.ERROR);
  const analyzingIds = idsWith(ANGLE_STATUS.ANALYZING);
  const capturingIds = idsWith(ANGLE_STATUS.CAPTURING);
  const missingIds = angles.filter((angle) => !isAngleCaptured(angle)).map((angle) => angle.id);

  let outcome = "incomplete";
  if (rejectedIds.length) outcome = SCAN_OUTCOME.RISK;
  else if (recaptureIds.length) outcome = SCAN_OUTCOME.RESCAN;
  else if (errorIds.length) outcome = SCAN_OUTCOME.TECHNICAL;
  else if (analyzingIds.length || capturingIds.length) outcome = "analyzing";
  else if (approvedCount === SCAN_ANGLE_IDS.length) outcome = SCAN_OUTCOME.CLEAR;

  const nextAngleId = angles.find((angle) => [ANGLE_STATUS.PENDING, ANGLE_STATUS.RECAPTURE].includes(angle.status))?.id
    || rejectedIds[0]
    || null;

  return {
    total: SCAN_ANGLE_IDS.length,
    capturedCount,
    approvedCount,
    missingIds,
    analyzingIds,
    rejectedIds,
    recaptureIds,
    errorIds,
    outcome,
    nextAngleId,
    canEnterExam: outcome === SCAN_OUTCOME.CLEAR,
  };
}
