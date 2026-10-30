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
// strong: confirmed from a single frame. Anything between floor and a confirmation is ambiguous.
// countBased rules allow `allowed` instances per frame (the student).
// Rules match in order, so "laptop screen" is a laptop and "headphones" is not a phone.
export const DETECTION_RULES = [
  { category: "audio_device", label: "Earbuds or headphones", match: /\b(earbuds?|earphones?|headphones?|headset|airpods?)\b/, floor: 0.3, flag: 0.5, strong: 0.75 },
  { category: "smartwatch", label: "Smartwatch", match: /\bsmart ?watch(es)?\b/, floor: 0.3, flag: 0.5, strong: 0.75 },
  { category: "phone", label: "Phone", match: /\b(cell ?phones?|mobile ?phones?|smart ?phones?|phones?|iphones?|android( phone)?|handphones?|cellular( phone)?|mobile)\b/, floor: 0.3, flag: 0.5, strong: 0.75 },
  { category: "tablet", label: "Tablet", match: /\b(tablets?|ipads?)\b/, floor: 0.3, flag: 0.5, strong: 0.75 },
  { category: "calculator", label: "Calculator", match: /\bcalculators?\b/, floor: 0.3, flag: 0.5, strong: 0.75 },
  // Any reliably detected laptop is prohibited, including a single one.
  { category: "laptop", label: "Laptop", match: /\blaptops?\b/, floor: 0.45, flag: 0.6, strong: 0.85 },
  { category: "second_screen", label: "Second monitor or screen", match: /\b(tv|television|monitors?|screens?)\b/, floor: 0.4, flag: 0.6, strong: 0.8 },
  { category: "notes", label: "Notes or papers", match: /\b(notes?|papers?|notebooks?|sticky notes?|cheat ?sheets?|documents?)\b/, floor: 0.35, flag: 0.55, strong: 0.8, nearOnly: true },
  { category: "book", label: "Book", match: /\b(books?|open book)\b/, floor: 0.4, flag: 0.6, strong: 0.8, nearOnly: true },
  { category: "person", label: "Another person", match: /^(person|people|human|man|woman)$/, floor: 0.4, flag: 0.6, strong: 0.85, countBased: true, allowed: 1 },
];

// Never flagged even if a detector reports them; listed so the intent is explicit.
export const IGNORED_LABELS = ["keyboard", "mouse", "chair", "couch", "bed", "dining table", "desk", "wall", "potted plant", "clock", "vase", "cup", "bottle", "lamp", "remote"];

export function normalizeLabel(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function findDetectionRule(label) {
  const normalized = normalizeLabel(label);
  if (!normalized || IGNORED_LABELS.includes(normalized)) return null;
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

  return { label, confidence, areaRatio };
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
// several detectors. Returns { outcome, findings } with outcome clear | risk_detected | rescan_required.
export function classifyAngleDetections({ angleId, frames = [] }) {
  const frameCount = Math.max(1, frames.length);
  const consensusFrames = Math.min(2, frameCount);
  const findings = [];

  DETECTION_RULES.forEach((rule) => {
    let framesAtFloor = 0;
    let framesAtFlag = 0;
    let maxConfidence = 0;

    frames.forEach((frame) => {
      const matches = (frame?.predictions || [])
        .map((prediction) => normalizePrediction(prediction))
        .filter((prediction) => prediction && findDetectionRule(prediction.label) === rule)
        .filter((prediction) => !(rule.nearOnly && angleId !== "desk" && prediction.areaRatio !== null && prediction.areaRatio < NEAR_OBJECT_MIN_AREA));

      if (rule.countBased) {
        const atFloor = matches.filter((item) => item.confidence >= rule.floor).sort((a, b) => b.confidence - a.confidence);
        const atFlag = atFloor.filter((item) => item.confidence >= rule.flag);
        if (atFloor.length > rule.allowed) {
          framesAtFloor += 1;
          maxConfidence = Math.max(maxConfidence, atFloor[rule.allowed].confidence);
        }
        if (atFlag.length > rule.allowed) framesAtFlag += 1;
        return;
      }

      const best = matches.reduce((max, item) => Math.max(max, item.confidence), 0);
      if (best >= rule.floor) framesAtFloor += 1;
      if (best >= rule.flag) framesAtFlag += 1;
      maxConfidence = Math.max(maxConfidence, best);
    });

    if (!framesAtFloor) return;
    const confirmed = rule.countBased
      ? framesAtFlag >= consensusFrames || maxConfidence >= rule.strong
      : maxConfidence >= rule.strong || (framesAtFlag >= 1 && framesAtFloor >= consensusFrames);

    findings.push({
      angle: angleId,
      category: rule.category,
      label: confirmed ? `${rule.label} detected` : `Possible ${rule.label.toLowerCase()}`,
      confidence: maxConfidence,
      detected: confirmed,
      severity: confirmed ? "risk" : "uncertain",
      reason: confirmed
        ? `${rule.label} detected (${percent(maxConfidence)}). Remove it from your exam area, then retake this step.`
        : `The image was unclear (possible ${rule.label.toLowerCase()}, ${percent(maxConfidence)}). Improve the lighting or hold the camera steady, then retake this step.`,
    });
  });

  const outcome = findings.some((finding) => finding.detected)
    ? SCAN_OUTCOME.RISK
    : findings.length ? SCAN_OUTCOME.RESCAN : SCAN_OUTCOME.CLEAR;
  return { outcome, findings };
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
    reason: classification.findings[0]?.reason || "",
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
// A laptop webcam has no motion sensor, so the sweep is judged from the pictures: the view must keep
// changing (distinct views), last long enough for a slow full turn, and end back at the starting view.
// View distances ignore overall brightness so the camera's auto exposure does not count as movement.

export const SWEEP_SAMPLE_INTERVAL_MS = 500;
export const SWEEP_MIN_MS = 20000;
export const SWEEP_MAX_MS = 90000;
// A sample this different from the last kept view becomes a new view.
export const SWEEP_VIEW_DISTANCE = 14;
export const SWEEP_MIN_VIEWS = 8;
export const SWEEP_TARGET_VIEWS = 12;
export const SWEEP_COVERAGE_BEFORE_RETURN = 0.9;
// At most this many views are sent to the detectors, spread evenly over the sweep.
export const SWEEP_MAX_FRAMES = 12;
// Ending this close to the first view counts as being back where the sweep started.
export const SWEEP_RETURN_DISTANCE = 16;
// Two samples this far apart, half a second apart, mean the camera turned too fast to see clearly.
// Only shown as a hint; the sweep's duration check is what rejects a rushed turn.
export const SWEEP_FAST_DISTANCE = 24;

function centered(signature) {
  const average = getSignatureBrightness(signature);
  return signature.map((value) => value - average);
}

export function getViewDistance(previous, next) {
  if (!previous?.length || !next?.length || previous.length !== next.length) return Number.POSITIVE_INFINITY;
  return getSignatureDistance(centered(previous), centered(next));
}

export function createSweep(startedAt) {
  return { startedAt, views: [], lastSignature: null, lastAt: startedAt, tooFastAt: null };
}

// True when this sample shows something new, so the caller should keep its image.
export function isNewSweepView(sweep, signature) {
  const lastView = sweep.views.at(-1);
  return !lastView || getViewDistance(lastView.signature, signature) >= SWEEP_VIEW_DISTANCE;
}

// Adds one sample; `image` is only given for samples that isNewSweepView accepted.
export function recordSweepSample(sweep, { signature, timestamp, image = null }) {
  const jump = sweep.lastSignature ? getViewDistance(sweep.lastSignature, signature) : 0;
  return {
    ...sweep,
    views: image && isNewSweepView(sweep, signature) ? [...sweep.views, { signature, image, timestamp }] : sweep.views,
    lastSignature: signature,
    lastAt: timestamp,
    tooFastAt: jump >= SWEEP_FAST_DISTANCE ? timestamp : sweep.tooFastAt,
  };
}

export function getSweepProgress(sweep, now = sweep.lastAt) {
  const elapsedMs = Math.max(0, now - sweep.startedAt);
  const viewCount = sweep.views.length;
  const enoughTurning = elapsedMs >= SWEEP_MIN_MS && viewCount >= SWEEP_MIN_VIEWS;
  const startDistance = viewCount ? getViewDistance(sweep.views[0].signature, sweep.lastSignature) : Number.POSITIVE_INFINITY;
  const backAtStart = enoughTurning && startDistance < SWEEP_RETURN_DISTANCE;
  return {
    elapsedMs,
    viewCount,
    // Distinct views only estimate how far the camera turned, so coverage stays below full until the
    // view is back at the start.
    coverage: backAtStart ? 1 : Math.min(SWEEP_COVERAGE_BEFORE_RETURN, viewCount / SWEEP_TARGET_VIEWS),
    canFinish: enoughTurning,
    backAtStart,
    tooFast: sweep.tooFastAt !== null && sweep.lastAt - sweep.tooFastAt < 2000,
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
  if (progress.viewCount < SWEEP_MIN_VIEWS) {
    return { ok: false, reason: "The sweep did not show enough of the room. Turn slowly in a full circle so the whole room is shown, then redo the room sweep." };
  }
  if (progress.elapsedMs < SWEEP_MIN_MS) {
    return { ok: false, reason: "The sweep was too quick to check the room. Turn more slowly, taking about 30 seconds for the full circle." };
  }
  if (!progress.backAtStart) {
    return { ok: false, reason: "The sweep did not end where it started. Turn all the way around until you face your starting view again." };
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
