import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FiArrowDown, FiArrowUp, FiCamera, FiCheckCircle, FiClock, FiMic, FiRefreshCw, FiRepeat, FiShield, FiUpload, FiXCircle } from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import AudioMonitoringTimeline from "../../components/exam/AudioMonitoringTimeline";
import { Button, Card, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useLiveAudioMonitoring } from "../../hooks/useLiveAudioMonitoring";
import {
  ANGLE_STATUS,
  SCAN_ANGLES,
  SCAN_FRAMES_PER_ANGLE,
  SCAN_OUTCOME,
  SCAN_REQUEST_CONFIDENCE,
  analyzeAngleCapture,
  assessCaptureQuality,
  createScanState,
  findDuplicateAngle,
  isAngleCaptured,
  parseDetectorResponse,
  scanReducer,
  summarizeScan,
} from "../../lib/environmentScan";
import { buildExamCompatibilityResult, normalizeBrowserCapabilities } from "../../lib/examCompatibility";
import { createLiveObjectMonitor } from "../../lib/liveObjectMonitor";
import { MICROPHONE_VIOLATION_CONFIRM_MS, SILENCE_RESUME_LEVEL, classifyMicrophoneState, createMicrophoneInterruptionGate, isMicrophonePermissionRevoked } from "../../lib/microphoneSignal";
import { getExamAttemptEligibility, formatAttemptUsage } from "../../lib/examAttempts";
import { FILE_UPLOAD_ACCEPT, FILE_UPLOAD_LIMIT_BYTES, FILE_UPLOAD_MIME_TYPES, getCorrectAnswers, getQuestionConfig, normalizeChoiceItems } from "../../lib/examQuestionTypes";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";
import { createIncidentTracker, EXAM_VIOLATION_LIMIT, hasProvidedAnswer, mergeAttemptViolations, violationWarning } from "../../lib/examViolationLimit";

function moveItemToIndex(items, fromIndex, toIndex) {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

const SCAN_ANGLE_STATUS_LABELS = {
  [ANGLE_STATUS.PENDING]: "Not captured",
  [ANGLE_STATUS.CAPTURING]: "Capturing...",
  [ANGLE_STATUS.ANALYZING]: "Captured - analyzing",
  [ANGLE_STATUS.APPROVED]: "Approved",
  [ANGLE_STATUS.REJECTED]: "Item detected",
  [ANGLE_STATUS.RECAPTURE]: "Recapture needed",
  [ANGLE_STATUS.ERROR]: "Check failed - retry",
};

const TAB_INACTIVE_GRACE_MS = 1000;
const MAX_CAPTURE_RETRIES = 3;
const SCAN_BURST_INTERVAL_MS = 250;
const ENV_SCAN_TIMEOUT_MS = 12000;
// Covers the first COCO-SSD model download on slow connections; a timeout is a retryable technical failure.
const ENV_SCAN_ANALYSIS_TIMEOUT_MS = 25000;
const FULLSCREEN_START_TIMEOUT_MS = 4000;
const LOOKING_AWAY_LIMIT_MS = 5000;
const LOOKING_DOWN_LIMIT_MS = 1500;
const EYE_GAZE_LIMIT_MS = 3000;
const GAZE_CALIBRATION_SAMPLES = 8;
const GAZE_HORIZONTAL_THRESHOLD = 0.18;
const GAZE_DOWN_THRESHOLD = 0.2;
const GAZE_BLENDSHAPE_THRESHOLD = 0.5;
const GAZE_HISTORY_SAMPLES = 4;
const GAZE_REQUIRED_AWAY_SAMPLES = 3;
const BASIC_FACE_SAMPLE_WIDTH = 160;
const BASIC_FACE_SAMPLE_HEIGHT = 100;
const OBJECT_SCAN_INTERVAL_MS = 1000;
const FILE_PICKER_SETTLE_MS = 350;
const EXAM_INTERRUPTION_LIMIT = 3;
const ROBOFLOW_OBJECT_CONFIDENCE = Number(import.meta.env.VITE_ROBOFLOW_OBJECT_CONFIDENCE || 0.35);
const ROBOFLOW_MODEL_ID = import.meta.env.VITE_ROBOFLOW_MODEL || "spare-gadget-detection";
const ROBOFLOW_MODEL_VERSION = import.meta.env.VITE_ROBOFLOW_MODEL_VERSION || "16";
const ROBOFLOW_API_BASE = import.meta.env.VITE_ROBOFLOW_API_BASE || "https://detect.roboflow.com";
const SNAPSHOT_VIOLATION_TYPES = new Set(["MULTIPLE_FACE", "NO_FACE", "LOOKING_AWAY", "PHONE_DETECTED", "GADGET_DETECTED"]);
const FACE_LANDMARKER_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const VISION_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const DEFAULT_EXAM_SETTINGS = {
  randomizeQuestions: false,
  randomizeChoices: false,
  requireEnvironmentScan: false,
  liveCameraMonitoring: false,
  liveAudioMonitoring: false,
  captureSnapshots: false,
};

let mediaPipeModulePromise;
let roboflowModulePromise;
let cocoSsdModulePromise;

function loadMediaPipe() {
  mediaPipeModulePromise ||= import("@mediapipe/tasks-vision");
  return mediaPipeModulePromise;
}

function loadRoboflow() {
  roboflowModulePromise ||= import("@roboflow/inference-sdk");
  return roboflowModulePromise;
}

function loadCocoSsd() {
  cocoSsdModulePromise ||= Promise.all([
    import("@tensorflow/tfjs"),
    import("@tensorflow-models/coco-ssd"),
  ]).then(([, cocoSsd]) => cocoSsd);
  return cocoSsdModulePromise;
}

function normalizeDetectionLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExamSettings(settings) {
  const parsed = typeof settings === "string" ? JSON.parse(settings || "{}") : settings || {};
  const bool = (...keys) => keys.some((key) => parsed[key] === true || parsed[key] === "true" || parsed[key] === 1);

  return {
    randomizeQuestions: bool("randomizeQuestions", "randomize_questions"),
    randomizeChoices: bool("randomizeChoices", "randomize_choices"),
    requireEnvironmentScan: bool("requireEnvironmentScan", "require_environment_scan"),
    liveCameraMonitoring: bool("liveCameraMonitoring", "live_camera_monitoring"),
    liveAudioMonitoring: bool("liveAudioMonitoring", "live_audio_monitoring"),
    captureSnapshots: bool("captureSnapshots", "capture_snapshots"),
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function stableShuffle(items, seedText) {
  const next = [...items];
  const random = seededRandom(hashSeed(seedText));
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function applySavedOrder(items, savedIds) {
  if (!Array.isArray(savedIds) || !savedIds.length) return null;
  const byId = new Map(items.map((item) => [String(item.id ?? item.key), item]));
  const ordered = savedIds.map((id) => byId.get(String(id))).filter(Boolean);
  const seen = new Set(ordered.map((item) => String(item.id ?? item.key)));
  const missing = items.filter((item) => !seen.has(String(item.id ?? item.key)));
  return ordered.length ? [...ordered, ...missing] : null;
}

function prepareQuestionsForAttempt(questionRows, settings, savedOrder, studentId, examId) {
  const shouldRandomizeQuestion = (question) => !["Ordering / Sequencing", "Matching Type"].includes(question.question_type);
  const stableQuestionOrder = applySavedOrder(questionRows, savedOrder?.questionIds);
  const orderedQuestions = stableQuestionOrder || (settings.randomizeQuestions
    ? [
      ...stableShuffle(questionRows.filter(shouldRandomizeQuestion), `${studentId}:${examId}:questions`),
      ...questionRows.filter((question) => !shouldRandomizeQuestion(question)),
    ]
    : questionRows);

  const choiceOrder = {};
  const questions = orderedQuestions.map((question) => {
    const config = getQuestionConfig(question);
    const choices = question.choices || config.choices || [];
    if (!settings.randomizeChoices || !["Multiple Choice", "Multiple Select", "Picture Choice", "Drag and Drop"].includes(question.question_type) || choices.length < 2) {
      return question;
    }
    const savedChoices = applySavedOrder(choices, savedOrder?.choiceIds?.[question.id]);
    const orderedChoices = savedChoices || stableShuffle(choices, `${studentId}:${examId}:${question.id}:choices`);
    choiceOrder[question.id] = orderedChoices.map((choice) => choice.id || choice.key);
    return { ...question, choices: orderedChoices };
  });

  return {
    questions,
    order: {
      questionIds: questions.map((question) => question.id),
      choiceIds: { ...(savedOrder?.choiceIds || {}), ...choiceOrder },
    },
  };
}

function formatDurationLabel(duration) {
  return Number(duration) > 0 ? `${duration} minutes` : "No timer";
}

function getDurationMinutes(exam) {
  const value = Number.parseFloat(String(exam?.time_limit || exam?.duration || 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatRemainingTime(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return "--:--";
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText = String(minutes).padStart(hours ? 2 : 1, "0");
  const secondText = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
}

function dataUrlToPayload(dataUrl) {
  return dataUrl.split(",")[1] || dataUrl;
}

function getExamProgressKey(studentId, examId) {
  return studentId && examId ? `smart-proctoring-exam-progress:${studentId}:${examId}` : "";
}

function readSavedExamProgress(studentId, examId) {
  const key = getExamProgressKey(studentId, examId);
  if (!key) return null;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeSavedExamProgress(studentId, examId, progress) {
  const key = getExamProgressKey(studentId, examId);
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(progress));
}

function clearSavedExamProgress(studentId, examId) {
  const key = getExamProgressKey(studentId, examId);
  if (key) window.localStorage.removeItem(key);
}

function normalizeInterruptionState(value = {}) {
  const count = Math.max(0, Number(value.interruption_count ?? value.interruptionCount ?? 0) || 0);
  const limit = Math.max(1, Number(value.interruption_limit ?? value.interruptionLimit ?? EXAM_INTERRUPTION_LIMIT) || EXAM_INTERRUPTION_LIMIT);
  return {
    count,
    limit,
    resumeAllowed: value.resume_allowed ?? value.resumeAllowed ?? count <= limit,
    shouldAutoSubmit: value.should_auto_submit ?? value.shouldAutoSubmit ?? count > limit,
  };
}

function interruptionWarning(state) {
  if (state.count >= state.limit) return "You have used all recoverable interruptions. Another interruption will automatically submit your exam.";
  if (state.count > 0) return `Exam recovered from ${state.count} of ${state.limit} recoverable interruptions.`;
  return "Recoverable technical interruptions are tracked separately from violations.";
}

function renderStatusPips(count, limit) {
  return (
    <span className="student-proctor-pips" aria-hidden="true">
      {Array.from({ length: limit }, (_, index) => <i className={index < count ? "on" : ""} key={index} />)}
    </span>
  );
}

function buildRecoveryEventKey(reason, startedAt, savedAt = "") {
  return `${reason}:${new Date(startedAt || 0).getTime() || "pending"}:${new Date(savedAt || Date.now()).getTime() || Date.now()}`;
}

function getEnvironmentScanError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/permission|notallowed|denied/i.test(message)) return "Camera permission denied. Please allow camera access.";
  if (/inactive|hidden|tab|focus/i.test(message)) return "Please keep this browser tab active while scanning.";
  if (/capture|image|frame|canvas/i.test(message)) return "Unable to capture scan image. Please try again.";
  if (/server|api|roboflow|analysis|fetch|network|timeout/i.test(message)) return "Environment analysis failed. Please scan again.";
  if (/right/i.test(message)) return "Please show the right side of your environment.";
  if (/left/i.test(message)) return "Please show the left side of your environment.";
  if (/center/i.test(message)) return "Please show the center view of your environment.";
  if (/sweep|incomplete|coverage|movement/i.test(message)) return "Please show the left, center, and right side of your environment.";
  return "Environment scan failed. Please try again.";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ENV_SCAN_TIMEOUT_MS) {
  const controller = new window.AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await window.fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getFullscreenElement() {
  return window.document.fullscreenElement
    || window.document.webkitFullscreenElement
    || window.document.mozFullScreenElement
    || window.document.msFullscreenElement
    || null;
}

async function requestFullscreen(element = window.document.documentElement) {
  const request = element.requestFullscreen
    || element.webkitRequestFullscreen
    || element.webkitEnterFullscreen
    || element.mozRequestFullScreen
    || element.msRequestFullscreen;

  if (!request) {
    throw new Error("Fullscreen is not supported by this browser.");
  }

  await request.call(element);
}

async function waitForFullscreen() {
  if (getFullscreenElement()) return;
  await wait(250);
  if (!getFullscreenElement()) {
    throw new Error("Fullscreen did not start.");
  }
}

async function exitFullscreen() {
  const exit = window.document.exitFullscreen
    || window.document.webkitExitFullscreen
    || window.document.mozCancelFullScreen
    || window.document.msExitFullscreen;

  if (getFullscreenElement() && exit) {
    await exit.call(window.document);
  }
}

function getUsableScanEndpoint(endpoint) {
  if (!endpoint) return "";
  if (import.meta.env.PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(endpoint)) return "";
  return endpoint;
}

function getFrameSignature(context, width, height) {
  const signature = [];
  const columns = 12;
  const rows = 8;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.floor((column + 0.5) * (width / columns));
      const y = Math.floor((row + 0.5) * (height / rows));
      const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
      signature.push((red + green + blue) / 3);
    }
  }

  return signature;
}

export default function StudentExamTake() {
  const { examId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [selectedMatchingLeft, setSelectedMatchingLeft] = useState({});
  const [files, setFiles] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [timerEndsAt, setTimerEndsAt] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoSubmitRequired, setAutoSubmitRequired] = useState(false);
  const [interruptionAutoSubmitRequired, setInterruptionAutoSubmitRequired] = useState(false);
  const [interruptionState, setInterruptionState] = useState(() => normalizeInterruptionState());
  const [submissionError, setSubmissionError] = useState("");
  const [progressReady, setProgressReady] = useState(false);
  const answersRef = useRef({});
  const filesRef = useRef({});
  const touchedAnswersRef = useRef(new Set());
  const violationsRef = useRef([]);
  const startedAtRef = useRef(null);
  const incidentTrackerRef = useRef(createIncidentTracker());
  const violationLimitReachedRef = useRef(false);
  const interruptionLimitExceededRef = useRef(false);
  const interruptionRecoveryRef = useRef({ inFlight: false, handledKeys: new Set(), offlineEventKey: null });
  const submissionSnapshotRef = useRef(null);
  const submitLatestRef = useRef(null);
  const mountedRef = useRef(true);
  const progressMetaRef = useRef({});
  const activeExamRef = useRef(examId);
  const authorizedFilePickerRef = useRef({ active: false, questionId: null });
  const filePickerFullscreenRestoreRef = useRef(false);
  const authorizedFullscreenRecoveryRef = useRef(false);
  const filePickerFinalizeTimerRef = useRef(null);
  activeExamRef.current = examId;
  const videoRef = useRef(null);
  const proctorVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const proctorStreamRef = useRef(null);
  const cursorAlertCooldownRef = useRef(0);
  const faceDetectorRef = useRef(null);
  const faceMonitorRef = useRef(null);
  const faceAlertCooldownRef = useRef(0);
  const lookingDownSinceRef = useRef(null);
  const eyeGazeSinceRef = useRef(null);
  const lookingAwaySinceRef = useRef(null);
  const noFaceSinceRef = useRef(null);
  const gazeCalibrationRef = useRef({ samples: [], baseline: null });
  const gazeHistoryRef = useRef([]);
  const objectMonitorRef = useRef(null);
  const liveObjectMonitorRef = useRef(createLiveObjectMonitor());
  const objectDetectionInFlightRef = useRef(false);
  const objectDetectorRef = useRef(null);
  const orderingDragRef = useRef(null);
  const roboflowConnectionRef = useRef(null);
  const scanCancelledRef = useRef(false);
  const scanInactiveTimerRef = useRef(null);
  const scanCaptureInFlightRef = useRef(false);
  const scanRequestCounterRef = useRef(0);
  const scanDetectorLoadRef = useRef(null);
  const [scanOpen, setScanOpen] = useState(true);
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanState, dispatchScan] = useReducer(scanReducer, undefined, () => createScanState());
  const scanStateRef = useRef(scanState);
  scanStateRef.current = scanState;
  const scanSummary = useMemo(() => summarizeScan(scanState), [scanState]);
  const [selectedScanAngleId, setSelectedScanAngleId] = useState(null);
  const [scanCameraReady, setScanCameraReady] = useState(false);
  const [scanCapturing, setScanCapturing] = useState(false);
  const [scanFindings, setScanFindings] = useState([]);
  const [scanFacingMode, setScanFacingMode] = useState("user");
  const [cameraError, setCameraError] = useState("");
  const [examModeReady, setExamModeReady] = useState(false);
  const [examStarting, setExamStarting] = useState(false);
  const [examLocked, setExamLocked] = useState(false);
  const examLockedRef = useRef(false);
  examLockedRef.current = examLocked;
  const [examLockMessage, setExamLockMessage] = useState("Fullscreen was exited or the exam window lost focus. Return to secure exam mode to continue.");
  const [isMicrophoneBlocked, setIsMicrophoneBlocked] = useState(false);
  const [microphoneBlockReason, setMicrophoneBlockReason] = useState("");
  const [existingAttemptCount, setExistingAttemptCount] = useState(0);
  const [reopenedAttempt, setReopenedAttempt] = useState(null);
  const [violations, setViolations] = useState([]);
  const [savedProgress, setSavedProgress] = useState(null);
  const examSubmittingRef = useRef(false);
  const examSubmittedRef = useRef(false);
  const examModeReadyRef = useRef(false);
  const examStartInFlightRef = useRef(false);
  const examStartGenerationRef = useRef(0);
  const timerExpiredRef = useRef(false);
  const microphoneBlockedRef = useRef(false);
  const microphoneInterruptionRef = useRef(createMicrophoneInterruptionGate());
  const microphoneConfirmTimerRef = useRef(null);
  const microphonePauseStartedAtRef = useRef(null);
  const microphoneTrackCleanupRef = useRef(null);
  const microphoneRecoveryRef = useRef({ inFlight: false, lastAttemptAt: 0 });
  const microphonePermissionDeniedRef = useRef(false);
  const microphoneSilencePausedRef = useRef(false);
  const interruptionStateRequestRef = useRef(0);
  const [faceStatus, setFaceStatus] = useState("Checking face position");
  const [roboflowStatus, setRoboflowStatus] = useState("Roboflow detector off");
  const totalPoints = useMemo(() => questions.reduce((total, question) => total + Number(question.points || 0), 0), [questions]);
  const examSettings = useMemo(() => {
    try {
      return { ...DEFAULT_EXAM_SETTINGS, ...normalizeExamSettings(exam?.exam_settings) };
    } catch {
      return DEFAULT_EXAM_SETTINGS;
    }
  }, [exam]);
  const scanPassed = !examSettings.requireEnvironmentScan || scanStatus === "passed";
  progressMetaRef.current = { ...progressMetaRef.current, scanStatus, timerEndsAt };
  const attemptEligibility = useMemo(() => getExamAttemptEligibility(exam, existingAttemptCount), [exam, existingAttemptCount]);
  const durationMinutes = getDurationMinutes(exam);
  const hasTimer = durationMinutes > 0;
  const attemptsExhausted = attemptEligibility.reason === "Attempts Exhausted" && !reopenedAttempt;
  const roboflowConfigured = Boolean(
    import.meta.env.VITE_ROBOFLOW_API_KEY
    || import.meta.env.VITE_ROBOFLOW_PROXY_URL
    || import.meta.env.VITE_ROBOFLOW_ENV_SCAN_ENDPOINT,
  );
  const liveCameraMonitoringEnabled = examSettings.liveCameraMonitoring;
  const roboflowMonitoringEnabled = liveCameraMonitoringEnabled && roboflowConfigured;
  const proctoringEnabled = liveCameraMonitoringEnabled || examSettings.liveAudioMonitoring;
  const secureModeRequired = proctoringEnabled;
  const examCompatibility = useMemo(() => {
    if (!exam) return { supported: true, required: [], missing: [], message: "" };
    return buildExamCompatibilityResult({
      settings: examSettings,
      questions,
      capabilities: normalizeBrowserCapabilities(window),
    });
  }, [exam, examSettings, questions]);
  const audioMonitoring = useLiveAudioMonitoring({
    enabled: examSettings.liveAudioMonitoring,
    exam,
    student: user,
    canRecordViolation: () => examModeReadyRef.current && !examSubmittingRef.current && !examSubmittedRef.current && !violationLimitReachedRef.current && !interruptionLimitExceededRef.current,
    onViolation: acceptRecordedViolation,
    onSilenceNotice: () => toast.warning("No sound is reaching your microphone. If it is muted in your system or on the device, unmute it. The exam will pause in 15 seconds.", { id: "microphone-silence" }),
    onSilencePause: handleMicrophoneSilencePause,
    onSilenceResume: resumeFromMicrophoneSilence,
  });

  // A silence pause lifts only once the audio bar reaches SILENCE_RESUME_LEVEL.
  useEffect(() => {
    if (isMicrophoneBlocked && microphoneSilencePausedRef.current && audioMonitoring.audioLevel >= SILENCE_RESUME_LEVEL) resumeFromMicrophoneSilence();
  // resumeFromMicrophoneSilence only reads refs and state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMonitoring.audioLevel, isMicrophoneBlocked]);

  useEffect(() => {
    if (!hasSupabaseConfig || !examId || !user?.id) return;
    let cancelled = false;
    setProgressReady(false);
    setAutoSubmitRequired(false);
    setInterruptionAutoSubmitRequired(false);
    setInterruptionState(normalizeInterruptionState());
    setSubmissionError("");
    setReopenedAttempt(null);
    setExamModeReady(false);
    examModeReadyRef.current = false;
    examSubmittingRef.current = false;
    examSubmittedRef.current = false;
    violationLimitReachedRef.current = false;
    interruptionLimitExceededRef.current = false;
    interruptionRecoveryRef.current = { inFlight: false, handledKeys: new Set(), offlineEventKey: null };
    timerExpiredRef.current = false;
    submissionSnapshotRef.current = null;
    incidentTrackerRef.current = createIncidentTracker();
    violationsRef.current = [];
    filesRef.current = {};
    setFiles({});

    async function loadExam() {
      let examRow = null;
      let examError = null;
      const examResult = await supabase
        .from("exams")
        .select("id, title, exam_title, description, duration, time_limit, exam_type, course_id, professor_id, created_by, status, exam_settings, assignment_mode, courses(course_name, course_code, section)")
        .eq("id", examId)
        .maybeSingle();

      if (examResult.error?.message?.includes("exam_settings")) {
        examRow = null;
        examError = new Error("Supabase is missing the exam_settings column. Exam security settings cannot be loaded.");
      } else {
        examRow = examResult.data;
        examError = examResult.error;
      }

      const { data: questionRows, error: questionsError } = await supabase
        .rpc("get_student_exam_questions", { p_exam_id: examId });

      if (examError) {
        toast.error(examError.message);
        return;
      }
      if (questionsError) {
        toast.error(questionsError.message);
        return;
      }

      const { data: exceptionRows } = await supabase
        .from("exam_student_access_exceptions")
        .select("allow_after_deadline")
        .eq("exam_id", examId)
        .eq("student_id", user.id)
        .limit(1);
      if (exceptionRows?.some((row) => row.allow_after_deadline)) {
        examRow = {
          ...examRow,
          exam_settings: {
            ...(examRow.exam_settings || {}),
            deadline: null,
          },
        };
      }

      const { count, error: attemptsError } = await supabase
        .from("exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("student_id", user.id);

      if (attemptsError) {
        toast.error(attemptsError.message);
        return;
      }

      const { data: reopenedRows, error: reopenedError } = await supabase
        .from("exam_attempts")
        .select("id, status, started_at, submission_session_started_at, exam_attempt_answers(question_id, answer, file_url)")
        .eq("exam_id", examId)
        .eq("student_id", user.id)
        .eq("status", "Reopened")
        .limit(1);
      if (reopenedError) {
        toast.error(reopenedError.message);
        return;
      }
      const reopened = reopenedRows?.[0] || null;

      const saved = reopened ? null : readSavedExamProgress(user.id, examId);
      const { data: startSession, error: startSessionError } = await supabase
        .from("exam_start_sessions")
        .select("interruption_count, interruption_limit")
        .eq("exam_id", examId)
        .eq("student_id", user.id)
        .maybeSingle();
      if (startSessionError) {
        toast.error(`Unable to load interruption state: ${startSessionError.message}`);
        return;
      }
      setInterruptionState(normalizeInterruptionState(startSession || {}));
      const settings = normalizeExamSettings(examRow?.exam_settings);
      const prepared = prepareQuestionsForAttempt(questionRows || [], settings, saved?.questionOrder, user.id, examId);
      if (cancelled) return;
      setExam(examRow);
      setExistingAttemptCount(count || 0);
      setQuestions(prepared.questions);
      const defaultAnswers = prepared.questions.reduce((items, question) => {
        const config = getQuestionConfig(question);
        if (question.question_type === "Ordering / Sequencing") items[question.id] = [...(config.orderItems || getCorrectAnswers(question))].sort(() => Math.random() - 0.5);
        if (question.question_type === "Enumeration") items[question.id] = ["", "", ""];
        if (question.question_type === "Matching Type") items[question.id] = {};
        if (question.question_type === "Multiple Select" || question.question_type === "Drag and Drop") items[question.id] = [];
        return items;
      }, {});
      const restoredAnswers = { ...defaultAnswers, ...(saved?.answers || {}) };
      if (reopened?.exam_attempt_answers?.length) {
        reopened.exam_attempt_answers.forEach((answer) => {
          restoredAnswers[answer.question_id] = answer.answer;
          if (answer.file_url && answer.answer && typeof answer.answer === "object") {
            restoredAnswers[answer.question_id] = { ...answer.answer, path: answer.file_url };
          }
        });
      }
      answersRef.current = restoredAnswers;
      setAnswers(restoredAnswers);
      if (reopened) {
        clearSavedExamProgress(user.id, examId);
        setReopenedAttempt(reopened);
      }
      touchedAnswersRef.current = new Set(saved?.touchedAnswers || Object.keys(saved?.answers || {}).filter((id) => {
        const question = (questionRows || []).find((item) => String(item.id) === id);
        return question?.question_type !== "Ordering / Sequencing";
      }));
      startedAtRef.current = reopened ? null : saved?.startedAt || null;
      let restoredViolations = saved?.startedAt ? saved.violations || [] : [];
      if (saved?.startedAt && !(count > 0)) {
        const { data: recorded, error: violationError } = await supabase.from("violations")
          .select("id, violation_type, description, severity, created_at")
          .eq("student_id", user.id).eq("exam_id", examId).gte("created_at", saved.startedAt);
        if (violationError) {
          toast.error(`Unable to restore exam violations: ${violationError.message}. Refresh to retry.`);
          return;
        }
        if (cancelled) return;
        restoredViolations = mergeAttemptViolations([...restoredViolations, ...(recorded || []).map((row) => ({
          id: row.id, type: row.violation_type, message: row.description || row.violation_type,
          severity: row.severity, timestamp: row.created_at,
        }))], saved.startedAt);
      }
      violationsRef.current = restoredViolations;
      setViolations(restoredViolations);
      if (!(count > 0) && restoredViolations.length >= EXAM_VIOLATION_LIMIT) {
        violationLimitReachedRef.current = true;
        setAutoSubmitRequired(true);
      }
      setSavedProgress(reopened ? null : saved);
      progressMetaRef.current = { ...progressMetaRef.current, questionOrder: prepared.order };
      setStartedAt(reopened ? null : saved?.startedAt || null);
      setTimerEndsAt(reopened ? null : saved?.timerEndsAt || null);
      if (saved?.scanStatus === "passed") {
        setScanStatus("passed");
        setScanOpen(false);
      }
      setProgressReady(true);
    }

    loadExam();
    return () => { cancelled = true; };
  }, [examId, user?.id]);

  useEffect(() => {
    examModeReadyRef.current = examModeReady;
  }, [examModeReady]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      examModeReadyRef.current = false;
      scanCancelledRef.current = true;
      authorizedFilePickerRef.current = { active: false, questionId: null };
      authorizedFullscreenRecoveryRef.current = false;
      if (filePickerFinalizeTimerRef.current) window.clearTimeout(filePickerFinalizeTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopProctoring();
      void exitFullscreen();
    };
  // Cleanup must run once on page exit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!exam || examSettings.requireEnvironmentScan) return;
    setScanStatus("passed");
    setScanOpen(false);
    if (!secureModeRequired) {
      setExamLocked(false);
    }
  }, [exam, examSettings.requireEnvironmentScan, secureModeRequired]);

  useEffect(() => {
    if (!examModeReady || examSubmittedRef.current || violationLimitReachedRef.current || interruptionLimitExceededRef.current || !user?.id || !examId) return;
    writeSavedExamProgress(user.id, examId, {
      answers,
      violations,
      scanStatus,
      startedAt,
      timerEndsAt,
      questionOrder: progressMetaRef.current.questionOrder,
      touchedAnswers: [...touchedAnswersRef.current],
      savedAt: new Date().toISOString(),
    });
    setSavedProgress({ answers, violations, scanStatus, startedAt, timerEndsAt, questionOrder: progressMetaRef.current.questionOrder, savedAt: new Date().toISOString() });
  }, [answers, examId, examModeReady, scanStatus, startedAt, timerEndsAt, user?.id, violations]);

  // Detector/timer callbacks may outlive a render; submission always reads current refs.
  submitLatestRef.current = handleSubmit;
  useEffect(() => {
    if (progressReady && autoSubmitRequired && !attemptsExhausted) void submitLatestRef.current("violation_limit");
  }, [progressReady, autoSubmitRequired, attemptsExhausted]);

  useEffect(() => {
    if (progressReady && interruptionAutoSubmitRequired && !attemptsExhausted) void submitLatestRef.current("interruption_limit");
  }, [progressReady, interruptionAutoSubmitRequired, attemptsExhausted]);

  useEffect(() => {
    if (!interruptionAutoSubmitRequired || examSubmittedRef.current) return undefined;
    function retryInterruptionSubmit() {
      if (!examSubmittingRef.current && !examSubmittedRef.current) void submitLatestRef.current("interruption_limit");
    }
    window.addEventListener("online", retryInterruptionSubmit);
    return () => window.removeEventListener("online", retryInterruptionSubmit);
  }, [interruptionAutoSubmitRequired]);

  useEffect(() => {
    if (!examModeReady || examSubmittedRef.current) return undefined;

    window.history.pushState({ examLocked: true }, "", window.location.href);

    function handlePopState() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      window.history.pushState({ examLocked: true }, "", window.location.href);
      toast.warning("Finish or submit the exam before returning to the dashboard.");
    }

    function handleBeforeUnload(event) {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [examModeReady]);

  useEffect(() => {
    if (!examModeReady || !exam?.id || examSubmittedRef.current) return undefined;

    function handleOffline() {
      if (examSubmittingRef.current || examSubmittedRef.current || authorizedFilePickerRef.current.active) return;
      if (!interruptionRecoveryRef.current.offlineEventKey) {
        interruptionRecoveryRef.current.offlineEventKey = buildRecoveryEventKey("offline", startedAtRef.current, new Date().toISOString());
        setExamLocked(true);
        setExamLockMessage("Connection lost. Your exam is paused until recovery is confirmed.");
        try { saveCurrentProgress(); } catch (error) { window.console.warn("Unable to save progress before offline recovery.", error); }
      }
    }

    function handleOnline() {
      const eventKey = interruptionRecoveryRef.current.offlineEventKey;
      if (!eventKey || examSubmittingRef.current || examSubmittedRef.current) return;
      interruptionRecoveryRef.current.offlineEventKey = null;
      void recordInterruptionRecovery("offline", eventKey, { lockOnFailure: true }).then((recovery) => {
        if (!recovery?.shouldAutoSubmit && recovery?.resumeAllowed) setExamLocked(false);
      }).catch(() => {
        interruptionRecoveryRef.current.offlineEventKey = eventKey;
      });
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    if (window.navigator && window.navigator.onLine === false) handleOffline();
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  // The handlers intentionally read current refs for the active session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeReady, exam?.id]);

  useEffect(() => {
    if (!["scanning", "analyzing"].includes(scanStatus)) return undefined;

    function clearInactiveTimer() {
      if (scanInactiveTimerRef.current) {
        window.clearTimeout(scanInactiveTimerRef.current);
        scanInactiveTimerRef.current = null;
      }
    }

    function resetInterruptedScan() {
      if (scanCancelledRef.current) return;
      clearInactiveTimer();
      scanInactiveTimerRef.current = window.setTimeout(() => {
        if (scanCancelledRef.current) return;
        resetEnvironmentScan("Please keep this browser tab active while scanning.");
      }, TAB_INACTIVE_GRACE_MS);
    }

    function handleVisibilityChange() {
      if (window.document.hidden) resetInterruptedScan();
      else clearInactiveTimer();
    }

    window.addEventListener("blur", resetInterruptedScan);
    window.addEventListener("focus", clearInactiveTimer);
    window.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInactiveTimer();
      window.removeEventListener("blur", resetInterruptedScan);
      window.removeEventListener("focus", clearInactiveTimer);
      window.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  // resetEnvironmentScan intentionally reads current refs/state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanStatus]);

  // The scan passes only when all five angles are captured and approved; exam entry still
  // goes through fullscreen, device checks and authorize_exam_start.
  useEffect(() => {
    if (!(scanSummary.canEnterExam && scanStatus === "scanning")) return;
    setScanFindings([]);
    setScanStatus("passed");
    stopEnvironmentCamera();
    toast.success("Environment scan passed. You may now take the exam.");
  }, [scanSummary.canEnterExam, scanStatus]);

  useEffect(() => {
    if (examModeReady && proctorStreamRef.current && proctorVideoRef.current) {
      proctorVideoRef.current.srcObject = proctorStreamRef.current;
    }
  }, [examModeReady]);

  useEffect(() => {
    if (!scanPassed || scanOpen || !examModeReady) return undefined;

    function recordGuardViolation(type, message, severity = "Medium") {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      recordManualViolation(type, message, severity);
      toast.error(message);
    }

    function blockEvent(event, message = "Copy, paste, and external actions are blocked during the exam.") {
      if ((event.type === "dragstart" || event.type === "drop") && event.target?.closest?.(".student-order-row")) return;
      event.preventDefault();
      event.stopPropagation();
      recordGuardViolation("COPY_ATTEMPT", message, "Medium");
    }

    function handleKeyDown(event) {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      const blockedCombo = event.ctrlKey || event.metaKey;
      const blockedKeys = ["c", "v", "x", "p", "s", "a", "u"];

      if (event.key === "PrintScreen") {
        blockEvent(event, "Print screen attempt detected.");
        return;
      }

      if (event.key === "F12" || (blockedCombo && event.shiftKey && ["i", "j", "c"].includes(key))) {
        blockEvent(event, "Developer tools are blocked during the exam.");
        return;
      }

      if (blockedCombo && blockedKeys.includes(key)) {
        blockEvent(event);
      }
    }

    function handleFullscreenChange() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      if (!getFullscreenElement()) {
        if (authorizedFilePickerRef.current.active) {
          filePickerFullscreenRestoreRef.current = true;
          return;
        }
        authorizedFullscreenRecoveryRef.current = false;
        setExamLockMessage("Fullscreen was exited. Return to secure exam mode to continue.");
        setExamLocked(true);
        recordGuardViolation("FULLSCREEN_EXIT", "Fullscreen mode was exited. Return to fullscreen to continue.", "High");
      } else incidentTrackerRef.current.clear("FULLSCREEN_EXIT");
    }

    function handleVisibilityChange() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      if (window.document.hidden) {
        if (authorizedFilePickerRef.current.active) return;
        setExamLocked(true);
        recordGuardViolation("TAB_SWITCH", "Tab switch or hidden exam tab detected.", "High");
      } else if (window.document.hasFocus()) incidentTrackerRef.current.clear("TAB_SWITCH");
    }

    function clearTabIncident() {
      if (authorizedFilePickerRef.current.active) {
        scheduleAuthorizedFilePickerFinalize();
        return;
      }
      if (!window.document.hidden && window.document.hasFocus()) incidentTrackerRef.current.clear("TAB_SWITCH");
    }

    function handleWindowBlur() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      if (authorizedFilePickerRef.current.active) return;
      authorizedFullscreenRecoveryRef.current = false;
      setExamLockMessage("The exam window lost focus. Return to secure exam mode to continue.");
      setExamLocked(true);
      recordGuardViolation("TAB_SWITCH", "Exam window lost focus.", "Medium");
    }

    function handleMouseLeave() {
      if (Date.now() - cursorAlertCooldownRef.current > 4000) {
        cursorAlertCooldownRef.current = Date.now();
        recordGuardViolation("TAB_SWITCH", "Cursor left the exam screen.", "Medium");
      }
    }

    const blockedEvents = ["copy", "cut", "paste", "contextmenu", "dragstart", "drop"];
    blockedEvents.forEach((eventName) => window.document.addEventListener(eventName, blockEvent, true));
    window.document.addEventListener("keydown", handleKeyDown, true);
    const fullscreenEvents = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    fullscreenEvents.forEach((eventName) => window.document.addEventListener(eventName, handleFullscreenChange));
    // Change events can be missed (or fullscreen lost before these listeners attach), so an
    // unlocked exam outside fullscreen is also caught by polling.
    const fullscreenCheck = window.setInterval(() => {
      if (!examLockedRef.current && !getFullscreenElement()) handleFullscreenChange();
    }, 1000);
    window.document.addEventListener("visibilitychange", handleVisibilityChange);
    window.document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", clearTabIncident);
    window.document.addEventListener("mouseenter", clearTabIncident);

    return () => {
      blockedEvents.forEach((eventName) => window.document.removeEventListener(eventName, blockEvent, true));
      window.document.removeEventListener("keydown", handleKeyDown, true);
      fullscreenEvents.forEach((eventName) => window.document.removeEventListener(eventName, handleFullscreenChange));
      window.clearInterval(fullscreenCheck);
      window.document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", clearTabIncident);
      window.document.removeEventListener("mouseenter", clearTabIncident);
    };
  // The guard listeners should only be rebound when secure exam mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeReady, scanOpen, scanPassed]);

  useEffect(() => {
    if (!examModeReady || !hasTimer || !timerEndsAt || isMicrophoneBlocked || examSubmittedRef.current) return undefined;

    function tick() {
      const nextRemaining = new Date(timerEndsAt).getTime() - Date.now();
      setRemainingMs(Math.max(0, nextRemaining));
      if (nextRemaining <= 0 && !timerExpiredRef.current && !examSubmittingRef.current && !examSubmittedRef.current) {
        timerExpiredRef.current = true;
        toast.error("Time is up. Submitting your exam now.");
        void submitLatestRef.current("timer");
      }
    }

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  // Timer should follow only the active deadline and exam mode.
  }, [examModeReady, hasTimer, isMicrophoneBlocked, timerEndsAt]);

  useEffect(() => {
    if (!examModeReady || !examSettings.liveAudioMonitoring || examSubmittedRef.current) return undefined;

    function checkMicrophone() {
      const track = proctorStreamRef.current?.getAudioTracks?.()[0];
      const issue = classifyMicrophoneState({ track });
      if (issue) {
        handleMicrophoneIssue(issue.reason, issue.type);
        if (issue.type === "MICROPHONE_UNAVAILABLE" || issue.type === "MICROPHONE_DISCONNECTED") void recoverMicrophone();
        else if (!track.enabled) track.enabled = true;
        return;
      }
      confirmMicrophoneInterruption();
      if (microphoneBlockedRef.current && !microphonePermissionDeniedRef.current && !microphoneSilencePausedRef.current) {
        audioMonitoring.start(proctorStreamRef.current);
        restoreMicrophoneAccess();
      }
    }

    function handleDeviceChange() {
      checkMicrophone();
      if (microphoneBlockedRef.current && !microphoneSilencePausedRef.current) void recoverMicrophone();
    }

    let permissionStatus;
    let previousPermissionState = null;
    function handlePermissionChange() {
      const revoked = isMicrophonePermissionRevoked(previousPermissionState, permissionStatus?.state);
      previousPermissionState = permissionStatus?.state ?? previousPermissionState;
      if (revoked) {
        microphonePermissionDeniedRef.current = true;
        handleMicrophoneIssue("Microphone permission was lost.", "MICROPHONE_ACCESS_LOST");
      } else if (permissionStatus?.state === "granted" && microphonePermissionDeniedRef.current) {
        microphonePermissionDeniedRef.current = false;
        void recoverMicrophone();
      }
    }

    const interval = window.setInterval(() => {
      checkMicrophone();
      confirmMicrophoneInterruption();
      if (microphoneBlockedRef.current && !microphoneSilencePausedRef.current) void recoverMicrophone();
    }, 2000);
    window.navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    void window.navigator.permissions?.query?.({ name: "microphone" }).then((status) => {
      permissionStatus = status;
      status.addEventListener?.("change", handlePermissionChange);
      handlePermissionChange();
    }).catch(() => {});
    checkMicrophone();

    return () => {
      window.clearInterval(interval);
      window.navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      permissionStatus?.removeEventListener?.("change", handlePermissionChange);
    };
  // Microphone guard owns one polling interval for the active exam only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeReady, examSettings.liveAudioMonitoring]);

  useEffect(() => {
    if (!isMicrophoneBlocked || autoSubmitRequired) return undefined;
    const blockInteraction = (event) => {
      if (event.target?.closest?.(".student-microphone-lock-overlay")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = ["beforeinput", "click", "keydown", "pointerdown", "submit"];
    events.forEach((eventName) => window.document.addEventListener(eventName, blockInteraction, true));
    return () => events.forEach((eventName) => window.document.removeEventListener(eventName, blockInteraction, true));
  }, [isMicrophoneBlocked, autoSubmitRequired]);

  function updateAnswers(update) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    answersRef.current = update(answersRef.current);
    setAnswers(answersRef.current);
  }

  function setFileAnswer(questionId, file) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    filesRef.current = { ...filesRef.current, [questionId]: file };
    setFiles(filesRef.current);
  }

  function beginAuthorizedFilePicker(questionId) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    authorizedFilePickerRef.current = { active: true, questionId };
    filePickerFullscreenRestoreRef.current = false;
    if (filePickerFinalizeTimerRef.current) {
      window.clearTimeout(filePickerFinalizeTimerRef.current);
      filePickerFinalizeTimerRef.current = null;
    }
  }

  function finalizeAuthorizedFilePicker() {
    if (!authorizedFilePickerRef.current.active) return;
    authorizedFilePickerRef.current = { active: false, questionId: null };
    if (filePickerFinalizeTimerRef.current) {
      window.clearTimeout(filePickerFinalizeTimerRef.current);
      filePickerFinalizeTimerRef.current = null;
    }
    if (!window.document.hidden && window.document.hasFocus()) incidentTrackerRef.current.clear("TAB_SWITCH");
    if (filePickerFullscreenRestoreRef.current) {
      filePickerFullscreenRestoreRef.current = false;
      if (!getFullscreenElement() && examModeReadyRef.current && !examSubmittingRef.current && !examSubmittedRef.current) {
        authorizedFullscreenRecoveryRef.current = true;
        setExamLockMessage("The file picker temporarily exited fullscreen. Return to fullscreen to continue your exam.");
        setExamLocked(true);
      }
    }
  }

  function scheduleAuthorizedFilePickerFinalize() {
    if (filePickerFinalizeTimerRef.current) window.clearTimeout(filePickerFinalizeTimerRef.current);
    filePickerFinalizeTimerRef.current = window.setTimeout(() => {
      filePickerFinalizeTimerRef.current = null;
      finalizeAuthorizedFilePicker();
    }, FILE_PICKER_SETTLE_MS);
  }

  function handleFilePickerChange(questionId, file) {
    try {
      if (file) setFileAnswer(questionId, file);
    } finally {
      scheduleAuthorizedFilePickerFinalize();
    }
  }

  function setAnswer(questionId, value) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleMultiAnswer(questionId, key) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => {
      const selected = current[questionId] || [];
      return {
        ...current,
        [questionId]: selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key],
      };
    });
  }

  function toggleDragDropAnswer(questionId, choiceId) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => {
      const selected = current[questionId] || [];
      return {
        ...current,
        [questionId]: selected.includes(choiceId) ? selected.filter((item) => item !== choiceId) : [...selected, choiceId],
      };
    });
  }

  function setEnumerationAnswer(questionId, index, value) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => ({
      ...current,
      [questionId]: (current[questionId] || ["", "", ""]).map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  }

  function setMatchingAnswer(questionId, left, right) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => {
      const nextMatches = Object.entries(current[questionId] || {}).reduce((items, [key, value]) => {
        if (value !== right || key === left) items[key] = value;
        return items;
      }, {});
      nextMatches[left] = right;
      return { ...current, [questionId]: nextMatches };
    });
  }

  function removeMatchingAnswer(questionId, left) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => {
      const nextMatches = { ...(current[questionId] || {}) };
      delete nextMatches[left];
      return { ...current, [questionId]: nextMatches };
    });
    setSelectedMatchingLeft((current) => ({ ...current, [questionId]: "" }));
  }

  function selectMatchingLeft(questionId, left) {
    setSelectedMatchingLeft((current) => ({
      ...current,
      [questionId]: current[questionId] === left ? "" : left,
    }));
  }

  function connectMatchingAnswer(questionId, right) {
    const left = selectedMatchingLeft[questionId];
    if (!left) return;
    setMatchingAnswer(questionId, left, right);
    setSelectedMatchingLeft((current) => ({ ...current, [questionId]: "" }));
  }

  function moveOrderingAnswer(questionId, fromIndex, toIndex) {
    if (examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current) return;
    touchedAnswersRef.current.add(questionId);
    updateAnswers((current) => ({
      ...current,
      [questionId]: moveItemToIndex(current[questionId] || [], fromIndex, toIndex),
    }));
  }

  function startOrderingDrag(event, questionId, itemIndex) {
    orderingDragRef.current = { questionId, itemIndex };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.classList.add("dragging");
  }

  function moveOrderingDrag(event) {
    const drag = orderingDragRef.current;
    if (!drag) return;
    const targetRow = window.document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".student-order-row");
    if (!targetRow || targetRow.dataset.questionId !== String(drag.questionId)) return;
    const targetIndex = Number(targetRow.dataset.index);
    if (!Number.isFinite(targetIndex) || targetIndex === drag.itemIndex) return;
    moveOrderingAnswer(drag.questionId, drag.itemIndex, targetIndex);
    orderingDragRef.current = { ...drag, itemIndex: targetIndex };
  }

  function endOrderingDrag(event) {
    orderingDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    window.document.querySelectorAll(".student-order-row.dragging").forEach((row) => row.classList.remove("dragging"));
  }

  async function uploadFile(questionId, file) {
    if (!file) return null;
    if (file.size > FILE_UPLOAD_LIMIT_BYTES) throw new Error("File must be 10MB or smaller.");
    if (!FILE_UPLOAD_MIME_TYPES.has(file.type)) throw new Error("Only PDF, DOCX, DOC, JPG, and PNG files are allowed.");

    const path = `${user.id}/${examId}/${questionId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("exam-submissions").upload(path, file, { upsert: false });
    if (error) {
      if (error.message?.toLowerCase().includes("bucket not found")) {
        throw new Error("Storage bucket exam-submissions is missing. Run the storage bucket SQL in Supabase.");
      }
      throw error;
    }
    return path;
  }

  function resetEnvironmentScan(message) {
    stopEnvironmentCamera();
    dispatchScan({ type: "reset" });
    setSelectedScanAngleId(null);
    setScanStatus("failed");
    setScanFindings([{ label: message, instruction: message }]);
  }

  async function startEnvironmentScan() {
    if (scanStatus === "scanning") return;
    setCameraError("");
    setScanFindings([]);
    dispatchScan({ type: "reset" });
    setSelectedScanAngleId(null);
    setScanStatus("scanning");
    scanCancelledRef.current = false;

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        video: { facingMode: scanFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (!scanCancelledRef.current) resetEnvironmentScan("Camera disconnected. Please perform a new environment scan.");
        };
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      await waitForVideoReady();
      if (scanCancelledRef.current) return;
      setScanCameraReady(true);
      // Warm up the local detector so the first angle check does not wait for the model download.
      void loadScanObjectDetector().catch((error) => window.console.warn("[EnvironmentScan] Local detector unavailable.", error));
    } catch (error) {
      window.console.error("[EnvironmentScan]", error);
      setScanStatus("idle");
      setCameraError(getEnvironmentScanError(error));
      stopEnvironmentCamera();
    }
  }

  function retakeEnvironmentScan() {
    stopEnvironmentCamera();
    dispatchScan({ type: "reset" });
    setSelectedScanAngleId(null);
    setCameraError("");
    setScanFindings([]);
    setScanStatus("idle");
  }

  function switchEnvironmentCamera() {
    if (scanStatus === "scanning" || scanStatus === "analyzing") return;
    setScanFacingMode((current) => current === "user" ? "environment" : "user");
    setCameraError("");
  }

  function stopEnvironmentCamera() {
    scanCancelledRef.current = true;
    setScanCameraReady(false);
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (scanInactiveTimerRef.current) {
      window.clearTimeout(scanInactiveTimerRef.current);
      scanInactiveTimerRef.current = null;
    }
  }

  function waitForVideoReady() {
    const video = videoRef.current;
    if (!video) return Promise.reject(new Error("Camera preview is not available."));
    if (video.videoWidth) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Camera took too long to start.")), 6000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        video.play();
        resolve();
      };
    });
  }

  function captureCurrentFrame({ silent = false } = {}) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      if (!silent) toast.error("Camera is still loading. Try again in a moment.");
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      image: canvas.toDataURL("image/jpeg", 0.82),
      signature: getFrameSignature(context, canvas.width, canvas.height),
      timestamp: Date.now(),
    };
  }

  async function captureCurrentFrameWithRetry() {
    for (let attempt = 0; attempt < MAX_CAPTURE_RETRIES; attempt += 1) {
      const frame = captureCurrentFrame({ silent: true });
      if (frame?.image) return frame;
      await wait(120);
    }
    throw new Error("Image capture failed. Please try again.");
  }

  function getScanAngleTitle(angleId) {
    return SCAN_ANGLES.find((angle) => angle.id === angleId)?.title || "previous angle";
  }

  // Captures a short burst for one angle. Each angle keeps its own capture, so retaking one
  // angle never touches the others; stale results are dropped by the scan reducer's ids.
  async function captureScanAngle(angleId) {
    if (scanCaptureInFlightRef.current || scanStatus !== "scanning" || !scanCameraReady) return;
    scanCaptureInFlightRef.current = true;
    setScanCapturing(true);
    scanRequestCounterRef.current += 1;
    const captureId = `${scanStateRef.current.sessionId}:${angleId}:capture:${scanRequestCounterRef.current}`;
    dispatchScan({ type: "capture_started", angleId, captureId });

    try {
      const shots = [];
      for (let index = 0; index < SCAN_FRAMES_PER_ANGLE; index += 1) {
        if (index) await wait(SCAN_BURST_INTERVAL_MS);
        if (scanCancelledRef.current) return;
        shots.push(await captureCurrentFrameWithRetry());
      }

      const quality = assessCaptureQuality(shots.map((shot) => shot.signature));
      if (!quality.ok) {
        dispatchScan({ type: "capture_failed", angleId, captureId, reason: quality.reason });
        return;
      }

      const signature = shots[Math.floor(shots.length / 2)].signature;
      const capturedSignatures = Object.fromEntries(Object.values(scanStateRef.current.angles)
        .filter((angle) => isAngleCaptured(angle))
        .map((angle) => [angle.id, angle.signature]));
      const duplicateOf = findDuplicateAngle(angleId, signature, capturedSignatures);
      if (duplicateOf) {
        dispatchScan({
          type: "capture_failed",
          angleId,
          captureId,
          reason: `This looks the same as the ${getScanAngleTitle(duplicateOf)} capture. Turn the camera to show the ${getScanAngleTitle(angleId).toLowerCase()}, then capture again.`,
        });
        return;
      }

      const frames = shots.map((shot) => ({ image: shot.image, timestamp: shot.timestamp, angle: angleId }));
      dispatchScan({ type: "capture_succeeded", angleId, captureId, frames, signature });
      setSelectedScanAngleId(null);
      void runScanAngleAnalysis(angleId, frames);
    } catch (error) {
      window.console.error("[EnvironmentScan]", error);
      dispatchScan({ type: "capture_failed", angleId, captureId, reason: getEnvironmentScanError(error) });
    } finally {
      scanCaptureInFlightRef.current = false;
      setScanCapturing(false);
    }
  }

  async function runScanAngleAnalysis(angleId, frames) {
    scanRequestCounterRef.current += 1;
    const requestId = `${scanStateRef.current.sessionId}:${angleId}:analysis:${scanRequestCounterRef.current}`;
    dispatchScan({ type: "analysis_started", angleId, requestId });
    const result = await analyzeAngleCapture({
      angleId,
      frames,
      detectors: [detectScanFramesWithRoboflow, detectScanFramesWithCocoSsd],
      fallbackDetectors: [detectScanFramesWithScanEndpoint],
      timeoutMs: ENV_SCAN_ANALYSIS_TIMEOUT_MS,
    });
    if (result.outcome === SCAN_OUTCOME.TECHNICAL) window.console.warn("[EnvironmentScan] Angle check failed.", angleId, result.reason);
    dispatchScan({ type: "analysis_resolved", angleId, requestId, outcome: result.outcome, findings: result.findings, reason: result.reason });
  }

  function retryScanAngleAnalysis(angleId) {
    const angle = scanStateRef.current.angles[angleId];
    if (angle?.status !== ANGLE_STATUS.ERROR || !angle.frames.length) return;
    void runScanAngleAnalysis(angleId, angle.frames);
  }

  function retakeScanAngle(angleId) {
    dispatchScan({ type: "retake", angleId });
    setSelectedScanAngleId(angleId);
  }

  async function detectScanFramesWithRoboflow(frames) {
    const endpoint = getRoboflowImageScanEndpoint();
    const images = frames.map((frame) => dataUrlToPayload(frame.image));

    if (!endpoint) {
      if (!import.meta.env.VITE_ROBOFLOW_API_KEY) return null;
      const results = await Promise.all(images.map((image) => runDirectRoboflowImageDetection(image, SCAN_REQUEST_CONFIDENCE)));
      return { frames: results.map((result) => ({ predictions: result?.predictions, image: result?.image })) };
    }

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId,
        studentId: user?.id,
        frames: [{ angle: frames[0]?.angle, images }],
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Roboflow analysis server error (${response.status}).`);
    return result;
  }

  function loadScanObjectDetector() {
    if (objectDetectorRef.current) return Promise.resolve(objectDetectorRef.current);
    scanDetectorLoadRef.current ||= loadCocoSsd()
      .then((cocoSsd) => cocoSsd.load())
      .then((model) => {
        objectDetectorRef.current ||= model;
        return objectDetectorRef.current;
      })
      .finally(() => {
        scanDetectorLoadRef.current = null;
      });
    return scanDetectorLoadRef.current;
  }

  async function detectScanFramesWithCocoSsd(frames) {
    const detector = await loadScanObjectDetector();
    const results = [];
    for (const frame of frames) {
      const image = await loadScanImage(frame.image);
      const predictions = await detector.detect(image);
      results.push({ predictions, image: { width: image.naturalWidth, height: image.naturalHeight } });
    }
    return { frames: results };
  }

  // Used only when neither Roboflow nor the local detector produced a result.
  async function detectScanFramesWithScanEndpoint(frames) {
    const endpoint = getUsableScanEndpoint(import.meta.env.VITE_ENV_SCAN_ENDPOINT);
    if (!endpoint || !hasSupabaseConfig) return null;

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        examId,
        studentId: user?.id,
        frames: [{ angle: frames[0]?.angle, images: frames.map((frame) => dataUrlToPayload(frame.image)) }],
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Analysis server error (${response.status}).`);
    return result;
  }

  async function runDirectRoboflowImageDetection(image, confidence = ROBOFLOW_OBJECT_CONFIDENCE) {
    const apiKey = import.meta.env.VITE_ROBOFLOW_API_KEY;
    if (!apiKey || !ROBOFLOW_MODEL_ID || !ROBOFLOW_MODEL_VERSION) return null;

    const endpoint = `${ROBOFLOW_API_BASE.replace(/\/$/, "")}/${ROBOFLOW_MODEL_ID}/${ROBOFLOW_MODEL_VERSION}`;
    const url = new window.URL(endpoint);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("confidence", String(Math.round(confidence * 100)));

    const response = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: image,
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(message || `Roboflow model error (${response.status}).`);
    }
    return response.json();
  }

  function loadScanImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to read scan frame."));
      image.src = dataUrl;
    });
  }

  function recordManualViolation(type, message, severity = "Medium") {
    if (!examModeReadyRef.current || examSubmittingRef.current || examSubmittedRef.current || violationLimitReachedRef.current || interruptionLimitExceededRef.current) return;
    if (!incidentTrackerRef.current.claim(type)) return;
    const timestamp = new Date().toISOString();
    if (hasSupabaseConfig && user?.id && exam?.id) {
      void persistViolation({ type, message, severity, timestamp });
    }
  }

  function saveCurrentProgress() {
    const progress = {
      answers: answersRef.current, violations: violationsRef.current, ...progressMetaRef.current,
      startedAt: startedAtRef.current, touchedAnswers: [...touchedAnswersRef.current],
      savedAt: new Date().toISOString(),
    };
    writeSavedExamProgress(user.id, examId, progress);
    return progress;
  }

  async function refreshAuthorizedInterruptionState(requestId) {
    const { data, error } = await supabase
      .from("exam_start_sessions")
      .select("interruption_count, interruption_limit")
      .eq("exam_id", examId)
      .eq("student_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (mountedRef.current && interruptionStateRequestRef.current === requestId) {
      setInterruptionState(normalizeInterruptionState(data || {}));
    }
  }

  async function recordInterruptionRecovery(_reason, eventKey, options = {}) {
    if (!hasSupabaseConfig || !user?.id || !exam?.id || examSubmittedRef.current) return normalizeInterruptionState(interruptionState);
    const key = String(eventKey || "").slice(0, 120);
    if (!key || interruptionRecoveryRef.current.inFlight) return normalizeInterruptionState(interruptionState);
    if (interruptionRecoveryRef.current.handledKeys.has(key)) return normalizeInterruptionState(interruptionState);
    interruptionRecoveryRef.current.inFlight = true;
    try {
      const { data, error } = await supabase.rpc("record_exam_interruption_recovery", {
        p_exam_id: exam.id,
        p_recovery_event_key: key,
      });
      if (error) throw error;
      const nextState = normalizeInterruptionState(data || {});
      interruptionRecoveryRef.current.handledKeys.add(key);
      setInterruptionState(nextState);
      if (nextState.shouldAutoSubmit || !nextState.resumeAllowed) {
        interruptionLimitExceededRef.current = true;
        setInterruptionAutoSubmitRequired(true);
        submissionSnapshotRef.current = { answers: { ...answersRef.current }, files: { ...filesRef.current }, touched: new Set(touchedAnswersRef.current) };
        examModeReadyRef.current = false;
        setExamModeReady(false);
        setExamLocked(true);
        setExamLockMessage("Recoverable interruption limit exceeded. Your exam is locked while submission is finalized.");
        stopProctoring();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        void submitLatestRef.current("interruption_limit");
      } else if (!options.silent) {
        toast.success(`Exam resumed. Interruption ${nextState.count} of ${nextState.limit}.`);
        if (nextState.count >= nextState.limit) toast.warning(interruptionWarning(nextState));
      }
      return nextState;
    } catch (error) {
      toast.error(`Unable to confirm exam recovery: ${error.message}`);
      if (options.lockOnFailure) {
        setExamLocked(true);
        setExamLockMessage("Exam recovery is pending. Reconnect and retry before continuing.");
      }
      throw error;
    } finally {
      interruptionRecoveryRef.current.inFlight = false;
    }
  }

  function acceptRecordedViolation(violation) {
    if (!mountedRef.current || examSubmittedRef.current || interruptionLimitExceededRef.current || !startedAtRef.current || (violation.examId && violation.examId !== activeExamRef.current)) return;
    const next = mergeAttemptViolations([...violationsRef.current, violation], startedAtRef.current);
    if (next.length === violationsRef.current.length) return;
    violationsRef.current = next;
    setViolations(next);
    if (next.length >= EXAM_VIOLATION_LIMIT && !violationLimitReachedRef.current) {
      violationLimitReachedRef.current = true;
      // Lock and freeze before any asynchronous saving or subsequent detector callback.
      submissionSnapshotRef.current = { answers: { ...answersRef.current }, files: { ...filesRef.current }, touched: new Set(touchedAnswersRef.current) };
      examModeReadyRef.current = false;
      setExamModeReady(false);
      setAutoSubmitRequired(true);
      stopProctoring();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    }
    try { saveCurrentProgress(); } catch (error) { toast.error(`Progress backup failed: ${error.message}`); }
    if (next.length < EXAM_VIOLATION_LIMIT) toast.warning(violationWarning(next.length));
    else void submitLatestRef.current("violation_limit");
    return violationLimitReachedRef.current;
  }

  function captureProctorSnapshot() {
    const video = proctorVideoRef.current;
    if (!video?.videoWidth) return Promise.resolve(null);

    const canvas = window.document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
    });
  }

  async function uploadProctorSnapshot(type, timestamp) {
    if (!examSettings.captureSnapshots) return null;
    if (!SNAPSHOT_VIOLATION_TYPES.has(type)) return null;
    const snapshot = await captureProctorSnapshot();
    if (!snapshot) return null;

    const safeTimestamp = timestamp.replace(/[:.]/g, "-");
    const path = `${user.id}/${exam.id}/${safeTimestamp}-${type}.jpg`;
    const { error } = await supabase.storage.from("proctor-snapshots").upload(path, snapshot, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  async function persistViolation({ type, message, severity, timestamp }) {
    // Capture evidence before submission can stop the camera; upload need not delay counting.
    const screenshotPromise = uploadProctorSnapshot(type, timestamp).catch((error) => {
      toast.error(`Snapshot was not saved: ${error.message}`);
      return null;
    });
    try {
      const payload = {
        student_id: user.id,
        exam_id: exam.id,
        professor_id: exam.professor_id || exam.created_by || null,
        course_id: exam.course_id || null,
        violation_type: type,
        description: message || type,
        severity,
        created_at: timestamp,
      };
      let { data, error } = await supabase.from("violations").insert(payload).select("id").single();
      if (
        error?.message?.includes("professor_id")
        || error?.message?.includes("course_id")
        || error?.message?.includes("description")
      ) {
        const fallback = await supabase.from("violations").insert({
          student_id: user.id,
          exam_id: exam.id,
          violation_type: type,
          severity,
          created_at: timestamp,
        }).select("id").single();
        error = fallback.error;
        data = fallback.data;
      }
      if (error) throw error;
      acceptRecordedViolation({ id: data.id, examId: exam.id, type, message, severity, timestamp });
      const screenshotPath = await screenshotPromise;
      if (screenshotPath) {
        const { error: evidenceError } = await supabase.from("violations").update({ screenshot_url: screenshotPath })
          .eq("id", data.id).eq("student_id", user.id);
        if (evidenceError) toast.error(`Snapshot metadata was not saved: ${evidenceError.message}`);
      }
    } catch (error) {
      incidentTrackerRef.current.clear(type);
      toast.error(`Monitoring alert was not saved: ${error.message}`);
    }
  }

  function detachMicrophoneTrackListeners() {
    microphoneTrackCleanupRef.current?.();
    microphoneTrackCleanupRef.current = null;
  }

  function restoreMicrophoneAccess() {
    if (!microphoneBlockedRef.current) return;
    microphoneInterruptionRef.current.restore();
    if (microphoneConfirmTimerRef.current) {
      window.clearTimeout(microphoneConfirmTimerRef.current);
      microphoneConfirmTimerRef.current = null;
    }
    for (const type of ["MICROPHONE_UNAVAILABLE", "MICROPHONE_DISCONNECTED", "MICROPHONE_MUTED", "MICROPHONE_ACCESS_LOST"]) incidentTrackerRef.current.clear(type);
    microphonePermissionDeniedRef.current = false;
    // A silence pause stays until the audio level reaches SILENCE_RESUME_LEVEL.
    if (microphoneSilencePausedRef.current) return;
    const pausedAt = microphonePauseStartedAtRef.current;
    microphonePauseStartedAtRef.current = null;
    if (pausedAt && hasTimer) {
      const pausedFor = Math.max(0, Date.now() - pausedAt);
      setTimerEndsAt((current) => current
        ? new Date(new Date(current).getTime() + pausedFor).toISOString()
        : current);
    }
    microphoneBlockedRef.current = false;
    setIsMicrophoneBlocked(false);
    setMicrophoneBlockReason("");
  }

  function pauseForMicrophone(reason) {
    if (!microphoneBlockedRef.current) {
      microphoneBlockedRef.current = true;
      microphonePauseStartedAtRef.current = Date.now();
      if (timerEndsAt) setRemainingMs(Math.max(0, new Date(timerEndsAt).getTime() - Date.now()));
      setIsMicrophoneBlocked(true);
    }
    setMicrophoneBlockReason(reason);
  }

  // 30 s of exact digital silence pauses the exam without a violation (see microphoneSignal.js).
  function handleMicrophoneSilencePause() {
    if (!examModeReadyRef.current || !examSettings.liveAudioMonitoring || examSubmittingRef.current || examSubmittedRef.current) return;
    microphoneSilencePausedRef.current = true;
    pauseForMicrophone("No sound has reached your microphone for 30 seconds. Unmute it, then speak until the audio level reaches at least 1% to continue.");
  }

  function resumeFromMicrophoneSilence() {
    if (!microphoneSilencePausedRef.current) return;
    microphoneSilencePausedRef.current = false;
    if (microphoneInterruptionRef.current.isActive()) return;
    restoreMicrophoneAccess();
  }

  // Pauses immediately; the interruption becomes one violation only if it lasts
  // MICROPHONE_VIOLATION_CONFIRM_MS, so a momentary mute or glitch is never counted.
  function handleMicrophoneIssue(reason, type = "MICROPHONE_UNAVAILABLE") {
    if (!examModeReadyRef.current || !examSettings.liveAudioMonitoring || examSubmittingRef.current || examSubmittedRef.current) return;
    if (microphoneInterruptionRef.current.report({ type, reason }, Date.now())) {
      microphoneConfirmTimerRef.current = window.setTimeout(confirmMicrophoneInterruption, MICROPHONE_VIOLATION_CONFIRM_MS);
    }
    pauseForMicrophone(reason);
  }

  function confirmMicrophoneInterruption() {
    if (!microphoneBlockedRef.current) return;
    const due = microphoneInterruptionRef.current.due(Date.now());
    if (due) recordManualViolation(due.type, due.reason, "High");
  }

  function attachMicrophoneTrackListeners(track) {
    detachMicrophoneTrackListeners();
    if (!track) return;

    const handleMute = () => handleMicrophoneIssue("The microphone track was muted by the browser or audio device.", "MICROPHONE_MUTED");
    const handleUnmute = () => {
      if (!microphoneSilencePausedRef.current && track.readyState === "live" && track.enabled && !track.muted) {
        audioMonitoring.start(proctorStreamRef.current);
        restoreMicrophoneAccess();
      }
    };
    const handleEnded = () => handleMicrophoneIssue("The microphone stopped or was disconnected.", "MICROPHONE_DISCONNECTED");
    track.addEventListener("mute", handleMute);
    track.addEventListener("unmute", handleUnmute);
    track.addEventListener("ended", handleEnded);
    microphoneTrackCleanupRef.current = () => {
      track.removeEventListener("mute", handleMute);
      track.removeEventListener("unmute", handleUnmute);
      track.removeEventListener("ended", handleEnded);
    };
  }

  async function recoverMicrophone() {
    const recovery = microphoneRecoveryRef.current;
    if (recovery.inFlight || Date.now() - recovery.lastAttemptAt < 7000 || !examModeReadyRef.current) return;
    recovery.inFlight = true;
    recovery.lastAttemptAt = Date.now();
    try {
      const replacementStream = await window.navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      const replacementTrack = replacementStream.getAudioTracks()[0];
      if (!replacementTrack || replacementTrack.readyState !== "live" || replacementTrack.muted || !replacementTrack.enabled) {
        replacementStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const stream = proctorStreamRef.current;
      if (!stream) {
        replacementTrack.stop();
        return;
      }
      detachMicrophoneTrackListeners();
      stream.getAudioTracks().forEach((track) => {
        stream.removeTrack(track);
        track.stop();
      });
      stream.addTrack(replacementTrack);
      attachMicrophoneTrackListeners(replacementTrack);
      audioMonitoring.start(stream);
      restoreMicrophoneAccess();
    } catch (error) {
      const permissionLost = /notallowed|permission|denied|security/i.test(error?.name || error?.message || "");
      handleMicrophoneIssue(
        permissionLost ? "Microphone permission was denied or lost." : "No available microphone input could be opened.",
        permissionLost ? "MICROPHONE_ACCESS_LOST" : "MICROPHONE_UNAVAILABLE",
      );
    } finally {
      recovery.inFlight = false;
    }
  }

  function stopProctoring() {
    detachMicrophoneTrackListeners();
    roboflowConnectionRef.current?.cleanup?.();
    roboflowConnectionRef.current = null;
    proctorStreamRef.current?.getTracks().forEach((track) => track.stop());
    proctorStreamRef.current = null;
    if (proctorVideoRef.current) proctorVideoRef.current.srcObject = null;
    audioMonitoring.stop();
    if (faceMonitorRef.current) {
      window.clearInterval(faceMonitorRef.current);
      faceMonitorRef.current = null;
    }
    faceDetectorRef.current?.close?.();
    faceDetectorRef.current = null;
    lookingAwaySinceRef.current = null;
    lookingDownSinceRef.current = null;
    eyeGazeSinceRef.current = null;
    noFaceSinceRef.current = null;
    gazeCalibrationRef.current = { samples: [], baseline: null };
    gazeHistoryRef.current = [];
    if (objectMonitorRef.current) {
      window.clearInterval(objectMonitorRef.current);
      objectMonitorRef.current = null;
    }
    liveObjectMonitorRef.current = createLiveObjectMonitor();
    objectDetectorRef.current = null;
    setRoboflowStatus("Roboflow detector off");
    setFaceStatus("Checking face position");
  }

  function recordFaceViolation(type, message, severity = "Medium") {
    if (Date.now() - faceAlertCooldownRef.current < 8000) return;
    faceAlertCooldownRef.current = Date.now();
    recordManualViolation(type, message, severity);
  }

  function processFaceState({ centerX, faceRatio, faceCount = 1, lookingDown = false, eyeLookingDown = false, eyeLookingAway = false, eyeDirection = "", gazeCalibrating = false, gazeCalibrationProgress = 0 }) {
    if (faceCount > 0) incidentTrackerRef.current.clear("NO_FACE");
    if (faceCount <= 1) incidentTrackerRef.current.clear("MULTIPLE_FACE");
    if (faceCount === 1 && !gazeCalibrating && !lookingDown && !eyeLookingDown && !eyeLookingAway && centerX >= 0.34 && centerX <= 0.66 && faceRatio >= 0.16) incidentTrackerRef.current.clear("LOOKING_AWAY");
    if (!faceCount) {
      setFaceStatus("No face detected");
      lookingAwaySinceRef.current = null;
      lookingDownSinceRef.current = null;
      eyeGazeSinceRef.current = null;
      gazeHistoryRef.current = [];
      noFaceSinceRef.current ??= Date.now();
      if (Date.now() - noFaceSinceRef.current >= LOOKING_AWAY_LIMIT_MS) {
        recordFaceViolation("NO_FACE", "No face detected for 5 seconds.", "High");
      }
      return;
    }

    noFaceSinceRef.current = null;

    if (faceCount > 1) {
      setFaceStatus("Multiple faces detected");
      lookingAwaySinceRef.current = null;
      lookingDownSinceRef.current = null;
      eyeGazeSinceRef.current = null;
      gazeHistoryRef.current = [];
      recordFaceViolation("MULTIPLE_FACE", "Multiple faces detected in the camera.", "High");
      return;
    }

    if (gazeCalibrating) {
      setFaceStatus(`Calibrating eye focus ${gazeCalibrationProgress}/${GAZE_CALIBRATION_SAMPLES}`);
      lookingAwaySinceRef.current = null;
      lookingDownSinceRef.current = null;
      eyeGazeSinceRef.current = null;
      return;
    }

    if (eyeLookingDown || eyeLookingAway) {
      const direction = eyeLookingDown ? "looking down" : eyeDirection;
      setFaceStatus(`Eyes ${direction}`);
      lookingAwaySinceRef.current = null;
      lookingDownSinceRef.current = null;
      eyeGazeSinceRef.current ??= Date.now();
      if (Date.now() - eyeGazeSinceRef.current >= EYE_GAZE_LIMIT_MS) {
        recordFaceViolation("LOOKING_AWAY", `Eye gaze ${direction} detected for 3 seconds.`, "High");
      }
      return;
    }

    eyeGazeSinceRef.current = null;

    if (lookingDown) {
      setFaceStatus("Looking down");
      lookingAwaySinceRef.current = null;
      lookingDownSinceRef.current ??= Date.now();
      if (Date.now() - lookingDownSinceRef.current >= LOOKING_DOWN_LIMIT_MS) {
        recordFaceViolation("LOOKING_AWAY", "Looking down detected for 3 seconds. Possible phone use.", "High");
      }
      return;
    }

    lookingDownSinceRef.current = null;

    const lookingAway = eyeLookingAway || centerX < 0.34 || centerX > 0.66 || faceRatio < 0.16;
    if (lookingAway) {
      const status = centerX < 0.5 ? "Looking left" : "Looking right";
      setFaceStatus(status);
      lookingAwaySinceRef.current ??= Date.now();
      if (Date.now() - lookingAwaySinceRef.current >= LOOKING_AWAY_LIMIT_MS) {
        const message = eyeLookingAway
          ? `Student eye gaze appears ${eyeDirection.toLowerCase()} for 5 seconds.`
          : "Student appears to be looking away for 5 seconds.";
        recordFaceViolation("LOOKING_AWAY", message, "Medium");
      }
      return;
    }

    lookingAwaySinceRef.current = null;
    eyeGazeSinceRef.current = null;
    gazeHistoryRef.current = [];
    setFaceStatus("Face centered");
  }

  function getBasicFaceEstimate(video) {
    const canvas = window.document.createElement("canvas");
    canvas.width = BASIC_FACE_SAMPLE_WIDTH;
    canvas.height = BASIC_FACE_SAMPLE_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let skinPixels = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minX = canvas.width;
    let maxX = 0;

    for (let index = 0; index < data.length; index += 16) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const pixelIndex = index / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);
      const cr = 128 + (0.5 * red) - (0.418688 * green) - (0.081312 * blue);
      const cb = 128 - (0.168736 * red) - (0.331264 * green) + (0.5 * blue);
      const likelySkin = y < canvas.height * 0.82 && red > 45 && green > 30 && blue > 18 && red > blue && cr > 132 && cr < 185 && cb > 75 && cb < 145;

      if (likelySkin) {
        skinPixels += 1;
        weightedX += x;
        weightedY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }

    const sampleCount = data.length / 16;
    const skinRatio = skinPixels / sampleCount;
    if (skinRatio < 0.018) return { faceCount: 0, centerX: 0.5, faceRatio: 0 };
    return {
      faceCount: 1,
      centerX: weightedX / skinPixels / canvas.width,
      lookingDown: (weightedY / skinPixels / canvas.height) > 0.5,
      faceRatio: (maxX - minX) / canvas.width,
    };
  }

  function getBlendshapeScore(categories, name) {
    return Number(categories.find((category) => category.categoryName === name)?.score || 0);
  }

  function getConfirmedGazeDirection(nextDirection) {
    gazeHistoryRef.current = [...gazeHistoryRef.current, nextDirection].slice(-GAZE_HISTORY_SAMPLES);
    const gazeCounts = gazeHistoryRef.current.reduce((counts, direction) => {
      if (!direction) return counts;
      return { ...counts, [direction]: (counts[direction] || 0) + 1 };
    }, {});
    const confirmedDirection = Object.entries(gazeCounts).find(([, count]) => count >= GAZE_REQUIRED_AWAY_SAMPLES)?.[0] || "";
    if (!confirmedDirection && !nextDirection) gazeHistoryRef.current = [];
    return confirmedDirection;
  }

  function getEyeGazeState(faceLandmarks, blendshapes = []) {
    const leftIris = faceLandmarks.slice(468, 473);
    const rightIris = faceLandmarks.slice(473, 478);
    if (leftIris.length < 5 || rightIris.length < 5) {
      return { eyeLookingAway: false, eyeDirection: "" };
    }

    function average(points, key) {
      return points.reduce((sum, point) => sum + point[key], 0) / points.length;
    }

    function getEyeRatio({ outer, inner, upper, lower, iris }) {
      const minX = Math.min(outer.x, inner.x);
      const maxX = Math.max(outer.x, inner.x);
      const minY = Math.min(upper.y, lower.y);
      const maxY = Math.max(upper.y, lower.y);
      return {
        x: (average(iris, "x") - minX) / Math.max(0.001, maxX - minX),
        y: (average(iris, "y") - minY) / Math.max(0.001, maxY - minY),
      };
    }

    const leftEye = getEyeRatio({
      outer: faceLandmarks[33],
      inner: faceLandmarks[133],
      upper: faceLandmarks[159],
      lower: faceLandmarks[145],
      iris: leftIris,
    });
    const rightEye = getEyeRatio({
      outer: faceLandmarks[362],
      inner: faceLandmarks[263],
      upper: faceLandmarks[386],
      lower: faceLandmarks[374],
      iris: rightIris,
    });

    const averageX = (leftEye.x + rightEye.x) / 2;
    const averageY = (leftEye.y + rightEye.y) / 2;
    const calibration = gazeCalibrationRef.current;

    if (!calibration.baseline) {
      const stableSample = averageX > 0.25 && averageX < 0.75 && averageY > 0.2 && averageY < 0.72;
      if (stableSample) {
        calibration.samples = [...calibration.samples, { x: averageX, y: averageY }].slice(-GAZE_CALIBRATION_SAMPLES);
      }
      if (calibration.samples.length >= GAZE_CALIBRATION_SAMPLES) {
        calibration.baseline = {
          x: calibration.samples.reduce((sum, sample) => sum + sample.x, 0) / calibration.samples.length,
          y: calibration.samples.reduce((sum, sample) => sum + sample.y, 0) / calibration.samples.length,
        };
      }
      return { eyeLookingAway: false, eyeDirection: "", gazeCalibrating: true, gazeCalibrationProgress: calibration.samples.length };
    }

    const baseline = calibration.baseline;
    const horizontalDelta = averageX - baseline.x;
    const verticalDelta = averageY - baseline.y;
    const blendshapeDown = (getBlendshapeScore(blendshapes, "eyeLookDownLeft") + getBlendshapeScore(blendshapes, "eyeLookDownRight")) / 2;
    const blendshapeLeft = (getBlendshapeScore(blendshapes, "eyeLookOutLeft") + getBlendshapeScore(blendshapes, "eyeLookInRight")) / 2;
    const blendshapeRight = (getBlendshapeScore(blendshapes, "eyeLookInLeft") + getBlendshapeScore(blendshapes, "eyeLookOutRight")) / 2;

    let nextDirection = "";
    if (verticalDelta > GAZE_DOWN_THRESHOLD || averageY > 0.76 || blendshapeDown > GAZE_BLENDSHAPE_THRESHOLD) {
      nextDirection = "looking down";
    } else if (horizontalDelta < -GAZE_HORIZONTAL_THRESHOLD || averageX < 0.22 || blendshapeLeft > GAZE_BLENDSHAPE_THRESHOLD) {
      nextDirection = "looking left";
    } else if (horizontalDelta > GAZE_HORIZONTAL_THRESHOLD || averageX > 0.78 || blendshapeRight > GAZE_BLENDSHAPE_THRESHOLD) {
      nextDirection = "looking right";
    }

    const confirmedDirection = getConfirmedGazeDirection(nextDirection);
    return {
      eyeLookingAway: Boolean(confirmedDirection && confirmedDirection !== "looking down"),
      eyeLookingDown: confirmedDirection === "looking down",
      eyeDirection: confirmedDirection,
    };
  }

  function getMediaPipeFaceState(faceLandmarks, video, blendshapes = []) {
    const xs = faceLandmarks.map((point) => point.x);
    const ys = faceLandmarks.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const nose = faceLandmarks[1];
    const leftEye = faceLandmarks[33];
    const rightEye = faceLandmarks[263];
    const chin = faceLandmarks[152];
    const eyeLineY = leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : minY + ((maxY - minY) * 0.35);
    const chinY = chin?.y || maxY;
    const noseDownRatio = nose ? (nose.y - eyeLineY) / Math.max(0.01, chinY - eyeLineY) : 0;
    const noseOffset = nose ? (nose.x - ((minX + maxX) / 2)) / Math.max(0.01, maxX - minX) : 0;
    const gaze = getEyeGazeState(faceLandmarks, blendshapes);

    return {
      faceCount: 1,
      centerX: Math.min(1, Math.max(0, ((minX + maxX) / 2) + noseOffset * 0.55)),
      faceRatio: ((maxX - minX) * video.videoWidth) / video.videoWidth,
      lookingDown: noseDownRatio > 0.48,
      ...gaze,
    };
  }

  async function createMediaPipeFaceLandmarker() {
    const { FaceLandmarker, FilesetResolver } = await loadMediaPipe();
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 3,
      outputFaceBlendshapes: true,
    });
  }

  async function startFaceMonitoring() {
    try {
      faceDetectorRef.current = await createMediaPipeFaceLandmarker();
      if (!mountedRef.current || violationLimitReachedRef.current || examSubmittedRef.current || !proctorStreamRef.current) {
        faceDetectorRef.current?.close?.();
        faceDetectorRef.current = null;
        return;
      }
      setFaceStatus("MediaPipe face AI active");
      faceMonitorRef.current = window.setInterval(() => {
        const video = proctorVideoRef.current;
        if (!video?.videoWidth || !faceDetectorRef.current) return;
        const result = faceDetectorRef.current.detectForVideo(video, window.performance.now());
        const faces = result.faceLandmarks || [];
        if (!faces.length) {
          processFaceState({ faceCount: 0, centerX: 0.5, faceRatio: 0 });
          return;
        }
        if (faces.length > 1) {
          processFaceState({ faceCount: faces.length, centerX: 0.5, faceRatio: 1 });
          return;
        }
        processFaceState(getMediaPipeFaceState(faces[0], video, result.faceBlendshapes?.[0]?.categories || []));
      }, 1000);
      return;
    } catch {
      if (!mountedRef.current || violationLimitReachedRef.current || examSubmittedRef.current || !proctorStreamRef.current) return;
      setFaceStatus("Basic face tracking active");
      faceMonitorRef.current = window.setInterval(() => {
        const video = proctorVideoRef.current;
        if (!video?.videoWidth) return;
        processFaceState(getBasicFaceEstimate(video));
      }, 1000);
    }
  }

  async function detectWithEndpoint(video) {
    const endpoint = import.meta.env.VITE_PROCTOR_OBJECT_ENDPOINT;
    if (!endpoint) return null;

    const canvas = window.document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.78);

    const response = await window.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrlToPayload(image), examId, studentId: user?.id }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Object detector error (${response.status}).`);
    return parseDetectorResponse({ predictions: result?.predictions ?? result?.objects }).frames[0].predictions;
  }

  function getRoboflowImageScanEndpoint() {
    const proxyUrl = import.meta.env.VITE_ROBOFLOW_PROXY_URL;
    const proxyBase = proxyUrl?.replace(/\/api\/init-webrtc\/?$/, "").replace(/\/$/, "");
    return getUsableScanEndpoint(import.meta.env.VITE_ROBOFLOW_ENV_SCAN_ENDPOINT || (proxyBase ? `${proxyBase}/api/environment-scan` : ""));
  }

  async function detectWithRoboflowImage(video) {
    const endpoint = getRoboflowImageScanEndpoint();

    const canvas = window.document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = dataUrlToPayload(canvas.toDataURL("image/jpeg", 0.78));

    if (!endpoint) {
      const result = await runDirectRoboflowImageDetection(image, SCAN_REQUEST_CONFIDENCE);
      return result ? parseDetectorResponse(result).frames[0].predictions : null;
    }

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId,
        studentId: user?.id,
        frames: [{ angle: "live camera", images: [image] }],
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `Roboflow analysis server error (${response.status}).`);
    return parseDetectorResponse(result).frames.flatMap((frame) => frame.predictions);
  }

  async function detectWithCocoSsd(video) {
    if (!objectDetectorRef.current) {
      const cocoSsd = await loadCocoSsd();
      objectDetectorRef.current = await cocoSsd.load();
    }
    const predictions = await objectDetectorRef.current.detect(video);
    return predictions.map((item) => ({ ...item, imageWidth: video.videoWidth, imageHeight: video.videoHeight }));
  }

  function getRoboflowConfig() {
    const proxyUrl = import.meta.env.VITE_ROBOFLOW_PROXY_URL;
    const workspaceName = import.meta.env.VITE_ROBOFLOW_WORKSPACE;
    const workflowId = import.meta.env.VITE_ROBOFLOW_WORKFLOW_ID;
    if (!proxyUrl || !workspaceName || !workflowId) return null;

    const splitOutputs = (value, fallback) => String(value === undefined ? fallback : value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      proxyUrl: proxyUrl.replace(/\/api\/init-webrtc\/?$/, ""),
      workspaceName,
      workflowId,
      streamOutputNames: splitOutputs(import.meta.env.VITE_ROBOFLOW_STREAM_OUTPUTS, ""),
      dataOutputNames: splitOutputs(import.meta.env.VITE_ROBOFLOW_DATA_OUTPUTS, ""),
      requestedPlan: import.meta.env.VITE_ROBOFLOW_PLAN || "webrtc-gpu-medium",
      requestedRegion: import.meta.env.VITE_ROBOFLOW_REGION || "us",
    };
  }

  function collectRoboflowPredictions(value, items = []) {
    if (!value) return items;
    if (Array.isArray(value)) {
      value.forEach((item) => collectRoboflowPredictions(item, items));
      return items;
    }
    if (typeof value !== "object") return items;

    const label = normalizeDetectionLabel(value.class || value.label || value.name || value.class_name);
    const confidence = Number(value.confidence ?? value.score ?? value.probability ?? 0);
    if (label && confidence) {
      items.push({ label, confidence });
    }

    Object.entries(value).forEach(([key, nested]) => {
      if (key === "image" || key === "output_image" || key === "annotated_image") return;
      collectRoboflowPredictions(nested, items);
    });
    return items;
  }

  // Confirmed events record one violation each; uncertain detections only warn; a continuous event
  // stays latched until the monitor sees it clear, so it cannot count toward the limit twice.
  function applyLiveObjectActions(actions) {
    actions.forEach((action) => {
      if (action.type === "violation") recordManualViolation(action.violationType, action.message, "High");
      else if (action.type === "uncertain") toast.warning(action.message, { id: `live-object-${action.category}` });
      else if (action.type === "cleared" && !liveObjectMonitorRef.current.activeTypes().has(action.violationType)) {
        incidentTrackerRef.current.clear(action.violationType);
      }
    });
  }

  function handleRoboflowData(data) {
    applyLiveObjectActions(liveObjectMonitorRef.current.observe({ ok: true, predictions: collectRoboflowPredictions(data) }));
  }

  async function startRoboflowMonitoring(stream) {
    const config = getRoboflowConfig();
    if (!config) {
      setRoboflowStatus(import.meta.env.VITE_ROBOFLOW_API_KEY || getRoboflowImageScanEndpoint() ? "Roboflow image detector active" : "Roboflow detector off");
      return;
    }

    try {
      setRoboflowStatus("Connecting Roboflow detector");
      const { connectors, webrtc } = await loadRoboflow();
      const connector = connectors.withProxyUrl(config.proxyUrl);
      roboflowConnectionRef.current = await webrtc.useStream({
        source: stream,
        connector,
        wrtcParams: {
          workspaceName: config.workspaceName,
          workflowId: config.workflowId,
          streamOutputNames: config.streamOutputNames,
          dataOutputNames: config.dataOutputNames,
          requestedPlan: config.requestedPlan,
          requestedRegion: config.requestedRegion,
          realtimeProcessing: true,
        },
        onData: handleRoboflowData,
      });
      if (!mountedRef.current || violationLimitReachedRef.current || examSubmittedRef.current || !proctorStreamRef.current) {
        roboflowConnectionRef.current?.cleanup?.();
        roboflowConnectionRef.current = null;
        return;
      }
      setRoboflowStatus("Roboflow detector active");
    } catch (error) {
      window.console.error("[RoboflowLive]", error);
      setRoboflowStatus(import.meta.env.VITE_ROBOFLOW_API_KEY || getRoboflowImageScanEndpoint() ? "Roboflow image detector active" : "Roboflow detector unavailable");
    }
  }

  async function detectProctorObjects() {
    const video = proctorVideoRef.current;
    if (!video?.videoWidth || objectDetectionInFlightRef.current) return;
    objectDetectionInFlightRef.current = true;

    try {
      // Every available detector contributes to one sample; if all of them fail the sample is a
      // technical failure, which never confirms, extends or clears a detection.
      const predictions = [];
      let succeeded = false;
      for (const detector of [detectWithRoboflowImage, detectWithEndpoint, detectWithCocoSsd]) {
        try {
          const result = await detector(video);
          if (result) {
            predictions.push(...result);
            succeeded = true;
          }
        } catch (error) {
          window.console.warn("[ObjectDetection] Detector unavailable.", error);
        }
      }
      applyLiveObjectActions(liveObjectMonitorRef.current.observe({ ok: succeeded, predictions }));
    } catch {
      // Keep exam proctoring active even if the optional object detector is unreachable.
    } finally {
      objectDetectionInFlightRef.current = false;
    }
  }

  function startObjectMonitoring() {
    void detectProctorObjects();
    objectMonitorRef.current = window.setInterval(() => {
      void detectProctorObjects();
    }, OBJECT_SCAN_INTERVAL_MS);
  }

  const requiredDevicesLabel = liveCameraMonitoringEnabled && examSettings.liveAudioMonitoring
    ? "Camera and microphone"
    : liveCameraMonitoringEnabled ? "Camera" : "Microphone";

  // Opens and validates the required devices only. Monitoring starts in activateProctoring after authorization.
  async function acquireProctorStream() {
    if (!liveCameraMonitoringEnabled && !examSettings.liveAudioMonitoring) return null;

    const stream = await window.navigator.mediaDevices.getUserMedia({
      video: liveCameraMonitoringEnabled ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } } : false,
      audio: examSettings.liveAudioMonitoring ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      } : false,
    });
    const required = [
      ...(liveCameraMonitoringEnabled ? [["Camera", stream.getVideoTracks()[0]]] : []),
      ...(examSettings.liveAudioMonitoring ? [["Microphone", stream.getAudioTracks()[0]]] : []),
    ];
    const unusable = required.find(([, track]) => !track || track.readyState !== "live" || !track.enabled || track.muted);
    if (unusable) {
      stream.getTracks().forEach((track) => track.stop());
      const error = new Error(`${unusable[0]} device is not available.`);
      error.name = "NotFoundError";
      throw error;
    }
    return stream;
  }

  function describeMediaStartError(error) {
    const text = `${error?.name || ""} ${error?.message || ""}`;
    if (/NotAllowed|Security|permission|denied/i.test(text)) {
      return `${requiredDevicesLabel} permission is required for this exam. Allow access and try again.`;
    }
    if (/NotReadable|TrackStart|AbortError/i.test(text)) {
      return `${requiredDevicesLabel} could not be opened. Close other apps using it and try again.`;
    }
    return `No usable ${requiredDevicesLabel.toLowerCase()} was found. Connect a device and try again.`;
  }

  function activateProctoring(stream) {
    if (!stream) {
      stopProctoring();
      setFaceStatus("Live camera monitoring disabled");
      setRoboflowStatus("Roboflow detector off");
      return;
    }
    stopProctoring();
    proctorStreamRef.current = stream;
    if (examSettings.liveAudioMonitoring) {
      attachMicrophoneTrackListeners(stream.getAudioTracks()[0]);
    }
    if (liveCameraMonitoringEnabled) {
      if (proctorVideoRef.current) proctorVideoRef.current.srcObject = stream;
      void startFaceMonitoring();
      startObjectMonitoring();
      if (roboflowMonitoringEnabled) void startRoboflowMonitoring(stream);
      else setRoboflowStatus("Roboflow detector off");
    } else {
      setFaceStatus("Live camera monitoring disabled");
      setRoboflowStatus("Roboflow detector off");
    }

    if (examSettings.liveAudioMonitoring) {
      audioMonitoring.start(stream);
    }
  }

  async function requestExamLock() {
    if (!getFullscreenElement()) {
      await requestFullscreen();
      await waitForFullscreen();
    }
  }

  async function leavePreStartFullscreen() {
    try {
      await exitFullscreen();
    } catch {
      // The student stays on the introduction screen either way.
    }
  }

  async function enterExamMode() {
    if (examStartInFlightRef.current) return;
    if (!progressReady || violationLimitReachedRef.current || interruptionLimitExceededRef.current || examSubmittingRef.current || examSubmittedRef.current) return;
    if (!examCompatibility.supported) {
      toast.error("This browser cannot meet the requirements for this exam.");
      return;
    }
    examStartInFlightRef.current = true;
    examStartGenerationRef.current += 1;
    setExamStarting(true);
    try {
      await startAuthorizedExamMode(examStartGenerationRef.current);
    } finally {
      examStartInFlightRef.current = false;
      if (mountedRef.current) setExamStarting(false);
    }
  }

  async function startAuthorizedExamMode(generation) {
    // Fullscreen is requested first, inside the Start click's user activation, so a refused
    // request never authorizes a server start, starts the timer, or locks the exam content.
    let abandoned = false;
    try {
      // Some embedded browsers never settle the fullscreen promise; treat that as a refusal.
      const lock = requestExamLock();
      // A fullscreen grant that arrives after the timeout must not leave the intro screen in fullscreen.
      lock.then(() => {
        if (abandoned && !examStartInFlightRef.current && !examModeReadyRef.current) void leavePreStartFullscreen();
      }, () => {});
      await Promise.race([
        lock,
        wait(FULLSCREEN_START_TIMEOUT_MS).then(() => {
          if (!getFullscreenElement()) throw new Error("Fullscreen request timed out.");
        }),
      ]);
      if (!getFullscreenElement()) throw new Error("Fullscreen did not start.");
    } catch {
      abandoned = true;
      toast.error("Fullscreen is required before taking the exam. Allow fullscreen mode and try again.");
      return;
    }
    const isCurrentStart = () => mountedRef.current && examStartGenerationRef.current === generation;
    if (!isCurrentStart()) {
      await leavePreStartFullscreen();
      return;
    }

    // Required devices are opened and validated before the server start is authorized,
    // so a denied or missing camera/microphone never creates a start session.
    let stream = null;
    const releaseStream = () => stream?.getTracks().forEach((track) => track.stop());
    if (secureModeRequired) {
      try {
        stream = await acquireProctorStream();
      } catch (mediaError) {
        await leavePreStartFullscreen();
        if (isCurrentStart()) toast.error(describeMediaStartError(mediaError));
        return;
      }
    }
    if (!isCurrentStart()) {
      releaseStream();
      await leavePreStartFullscreen();
      return;
    }
    if (!getFullscreenElement()) {
      releaseStream();
      toast.error("Fullscreen was closed while devices were being checked. Click Start Exam to try again.");
      return;
    }

    const interruptionStateRequestId = interruptionStateRequestRef.current + 1;
    interruptionStateRequestRef.current = interruptionStateRequestId;
    if (hasSupabaseConfig) {
      const { data: serverStart, error } = await supabase.rpc("authorize_exam_start", { p_exam_id: examId });
      if (error) {
        releaseStream();
        await leavePreStartFullscreen();
        toast.error(error.message);
        return;
      }
      if (!startedAtRef.current) startedAtRef.current = serverStart;
      try {
        await refreshAuthorizedInterruptionState(interruptionStateRequestId);
      } catch (stateError) {
        releaseStream();
        await leavePreStartFullscreen();
        toast.error(`Unable to refresh interruption state: ${stateError.message}`);
        return;
      }
    }
    if (!isCurrentStart()) {
      releaseStream();
      return;
    }
    function startTimerIfNeeded() {
      const start = startedAtRef.current || new Date().toISOString();
      startedAtRef.current = start;
      setStartedAt(start);
      if (hasTimer && !timerEndsAt) {
        const durationEnd = new Date(start).getTime() + durationMinutes * 60 * 1000;
        const deadline = exam?.exam_settings?.deadline ? new Date(exam.exam_settings.deadline).getTime() : null;
        const boundedEnd = deadline && Number.isFinite(deadline) ? Math.min(durationEnd, deadline) : durationEnd;
        setTimerEndsAt(new Date(boundedEnd).toISOString());
      }
      if (!hasTimer) setRemainingMs(null);
    }

    try {
      if (secureModeRequired) {
        activateProctoring(stream);
      } else {
        stopProctoring();
      }
      startTimerIfNeeded();
      // Fullscreen can be left while the server start is in flight; the exam then opens locked
      // until fullscreen returns, so it is never answerable outside fullscreen.
      const fullscreenLost = !getFullscreenElement();
      if (fullscreenLost) setExamLockMessage("Fullscreen is required. Return to fullscreen to start answering.");
      setExamLocked(fullscreenLost);
      examModeReadyRef.current = true;
      setExamModeReady(true);
      setScanOpen(false);
      saveCurrentProgress();
      toast.success(secureModeRequired ? "Secure exam mode started" : "Exam started in fullscreen");
    } catch {
      stopProctoring();
      examModeReadyRef.current = false;
      setExamModeReady(false);
      setExamLocked(false);
      toast.error("Secure exam mode could not start. Check camera and microphone access and try again.");
    }
  }

  async function resumeExamMode() {
    if (savedProgress?.scanStatus === "passed") {
      setScanStatus("passed");
      setScanOpen(false);
    }
    try {
      if (savedProgress?.startedAt) {
        const eventKey = buildRecoveryEventKey("saved-progress", savedProgress.startedAt, savedProgress.savedAt);
        const recovery = await recordInterruptionRecovery("saved-progress", eventKey, { lockOnFailure: true });
        if (recovery?.shouldAutoSubmit || !recovery?.resumeAllowed) return;
      }
      await enterExamMode();
    } catch {
      // recordInterruptionRecovery already displayed the recovery problem and left the exam locked.
    }
  }

  async function restoreExamLock() {
    if (violationLimitReachedRef.current || interruptionLimitExceededRef.current || examSubmittingRef.current || examSubmittedRef.current) return;
    try {
      await requestExamLock();
      authorizedFullscreenRecoveryRef.current = false;
      setExamLocked(false);
    } catch (error) {
      if (!authorizedFullscreenRecoveryRef.current) {
        recordManualViolation("FULLSCREEN_EXIT", error instanceof Error ? error.message : "Unable to restore fullscreen.", "High");
      }
      toast.error("Return to fullscreen to continue the exam.");
    }
  }

  async function handleSubmit(reason = "manual") {
    if (examSubmittingRef.current || examSubmittedRef.current) return;
    const systemSubmission = reason === "violation_limit" || reason === "interruption_limit";
    if (!scanPassed && !systemSubmission) {
      toast.error("Complete and pass the environment scan before submitting the exam.");
      setScanOpen(true);
      return;
    }
    if (!hasSupabaseConfig || !user?.id || !exam) return;
    examSubmittingRef.current = true;
    setSubmitting(true);
    setSubmissionError("");
    const snapshot = submissionSnapshotRef.current || { answers: { ...answersRef.current }, files: { ...filesRef.current }, touched: new Set(touchedAnswersRef.current) };
    if (systemSubmission) submissionSnapshotRef.current = snapshot;

    try {
      const { count, error: attemptCountError } = await supabase
        .from("exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", exam.id)
        .eq("student_id", user.id);

      if (attemptCountError) throw attemptCountError;
      const latestEligibility = getExamAttemptEligibility(exam, count || 0);
      if (!latestEligibility.allowed) {
        if (!(reopenedAttempt && latestEligibility.reason === "Attempts Exhausted")) {
          setExistingAttemptCount(count || 0);
          toast.error(latestEligibility.reason === "Attempts Exhausted" ? "You have used all available attempts for this exam." : `This exam is ${String(latestEligibility.reason).toLowerCase()}.`);
          return;
        }
      }

      const uploadedPaths = {};
      const submissionAnswers = { ...snapshot.answers };
      for (const question of questions) {
        if (question.question_type === "Ordering / Sequencing" && !snapshot.touched.has(question.id)) delete submissionAnswers[question.id];
      }
      for (const question of questions) {
        if (question.question_type === "File Upload" && snapshot.files[question.id]) {
          uploadedPaths[question.id] = await uploadFile(question.id, snapshot.files[question.id]);
          submissionAnswers[question.id] = { fileName: snapshot.files[question.id].name, path: uploadedPaths[question.id] };
        }
      }

      // Empty responses receive zero; answered manual types retain manual grading on the server.
      for (const question of questions) {
        if (!hasProvidedAnswer(submissionAnswers[question.id])) submissionAnswers[question.id] = null;
      }

      const submissionViolations = violationsRef.current.map((violation, index) => violationLimitReachedRef.current && index === EXAM_VIOLATION_LIMIT - 1
          ? { ...violation, submissionReason: "violation_limit", submissionMessage: "Exam submission initiated after reaching 5 violations." }
          : violation);
      if (reason === "interruption_limit") {
        submissionViolations.push({
          type: "AUTO_SUBMISSION",
          message: "Exam submission initiated after exceeding the recoverable interruption limit.",
          severity: "High",
          timestamp: new Date().toISOString(),
          submissionReason: "interruption_limit",
        });
      }

      const { error: submitError } = await supabase.rpc("submit_exam_attempt", {
        p_exam_id: exam.id,
        p_answers: submissionAnswers,
        p_violations: submissionViolations,
      });

      if (submitError) throw submitError;

      const limitViolation = violationsRef.current[EXAM_VIOLATION_LIMIT - 1];
      if (violationLimitReachedRef.current && limitViolation?.id) {
        const { error: logError } = await supabase.from("violations").update({
          description: `${limitViolation.message} Exam submission initiated after reaching 5 violations.`,
        }).eq("id", limitViolation.id).eq("student_id", user.id);
        if (logError) window.console.warn("Automatic submission reason is saved on the attempt; violation description update failed.", logError);
      }

      toast.success("Exam submitted");
      examSubmittedRef.current = true;
      interruptionLimitExceededRef.current = false;
      clearSavedExamProgress(user.id, examId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["student-dashboard", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["student-grades", user.id] }),
      ]);
      examModeReadyRef.current = false;
      setExamModeReady(false);
      stopProctoring();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      await exitFullscreen();
      navigate("/student/grades");
    } catch (error) {
      setSubmissionError(error.message || "Submission failed. Please retry.");
      toast.error(error.message);
      if (reason === "interruption_limit") {
        interruptionLimitExceededRef.current = true;
        setInterruptionAutoSubmitRequired(true);
        setExamLocked(true);
        setExamLockMessage("Interruption limit exceeded. Submission is pending and the exam cannot continue.");
      }
    } finally {
      if (!examSubmittedRef.current) examSubmittingRef.current = false;
      if (!examSubmittedRef.current && reason === "timer") timerExpiredRef.current = false;
      setSubmitting(false);
    }
  }

  function renderQuestion(question, index) {
    const config = getQuestionConfig(question);
    const choices = normalizeChoiceItems(question.choices || config.choices || []);
    const legacyPairs = config.pairs || [];
    const matchingLeftItems = (config.matchingLeftItems || legacyPairs.map((pair, pairIndex) => ({ id: pair.id || pair.left || `left-${pairIndex}`, text: pair.text || pair.left }))).map((item, index) => ({
      id: String(item.id || item.left || `left-${index}`),
      text: item.text || item.left || "",
    }));
    const matchingRightItems = (config.matchingRightItems || config.matchChoices || legacyPairs.map((pair, pairIndex) => ({ id: pair.right || `right-${pairIndex}`, text: pair.right }))).map((item, index) => ({
      id: String(item.id || item.value || item.text || `right-${index}`),
      text: item.text || item.value || item.right || "",
    }));
    const pairs = matchingLeftItems;
    const orderItems = answers[question.id] || config.orderItems || [];
    const rightOptions = matchingRightItems.length ? matchingRightItems : legacyPairs.map((pair) => ({ id: pair.right, text: pair.right })).filter((item) => item.text).sort((a, b) => a.text.localeCompare(b.text));
    const matchingAnswers = answers[question.id] || {};
    const selectedLeft = selectedMatchingLeft[question.id] || "";
    const matchingRowCount = Math.max(pairs.length, rightOptions.length, 1);
    const matchingLines = pairs.map((pair, leftIndex) => {
      const rightIndex = rightOptions.findIndex((option) => option.id === matchingAnswers[pair.id]);
      if (rightIndex < 0) return null;
      return {
        key: `${pair.id}-${matchingAnswers[pair.id]}`,
        x1: 28,
        y1: ((leftIndex + 0.5) / matchingRowCount) * 100,
        x2: 72,
        y2: ((rightIndex + 0.5) / matchingRowCount) * 100,
      };
    }).filter(Boolean);

    return (
      <Card className="student-exam-question" key={question.id}>
        <div className="student-card-title">
          <div>
            <h2>{index + 1}. {question.question_text}</h2>
            <p>{question.question_type} - {question.points} point{Number(question.points) === 1 ? "" : "s"}</p>
          </div>
        </div>

        {question.question_type === "Picture Choice" && config.questionImage ? (
          <div className="student-question-image">
            <img alt="Question reference" decoding="async" loading="lazy" src={config.questionImage} />
          </div>
        ) : null}

        {question.question_type === "Multiple Choice" || question.question_type === "Picture Choice" ? choices.map((choice) => (
          <label className="student-answer-option" key={choice.id}>
            <input checked={answers[question.id] === choice.id || answers[question.id] === choice.key} onChange={() => setAnswer(question.id, choice.id)} type="radio" />
            <span>{choice.key}. {choice.value}</span>
          </label>
        )) : null}

        {question.question_type === "Multiple Select" ? choices.map((choice) => (
          <label className="student-answer-option" key={choice.id}>
            <input checked={(answers[question.id] || []).includes(choice.id) || (answers[question.id] || []).includes(choice.key)} onChange={() => toggleMultiAnswer(question.id, choice.id)} type="checkbox" />
            <span>{choice.key}. {choice.value}</span>
          </label>
        )) : null}

        {question.question_type === "True or False" ? ["True", "False"].map((item) => (
          <label className="student-answer-option" key={item}>
            <input checked={answers[question.id] === item} onChange={() => setAnswer(question.id, item)} type="radio" />
            <span>{item}</span>
          </label>
        )) : null}

        {["Identification", "Fill in the Blank", "Essay"].includes(question.question_type) ? (
          <textarea className="professor-create-textarea" onChange={(event) => setAnswer(question.id, event.target.value)} placeholder="Type your answer" value={answers[question.id] || ""} />
        ) : null}

        {question.question_type === "Enumeration" ? (answers[question.id] || ["", "", ""]).map((answer, answerIndex) => (
          <input className="professor-create-input" key={answerIndex} onChange={(event) => setEnumerationAnswer(question.id, answerIndex, event.target.value)} placeholder={`Answer ${answerIndex + 1}`} value={answer} />
        )) : null}

        {question.question_type === "Matching Type" ? (
          <div className="student-matching-board" style={{ "--match-row-count": matchingRowCount }}>
            <svg aria-hidden="true" className="student-matching-lines" preserveAspectRatio="none" viewBox="0 0 100 100">
              {matchingLines.map((line) => (
                <line key={line.key} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
              ))}
            </svg>
            <div className="student-matching-column">
              {pairs.map((pair) => (
                <button
                  className={`student-matching-choice ${selectedLeft === pair.id ? "selected" : ""} ${matchingAnswers[pair.id] ? "matched" : ""}`}
                  key={pair.id}
                  onClick={() => selectMatchingLeft(question.id, pair.id)}
                  type="button"
                >
                  {pair.text}
                </button>
              ))}
            </div>
            <div className="student-matching-column right">
              {rightOptions.map((option) => {
                const matchedLeft = Object.entries(matchingAnswers).find(([, value]) => value === option.id)?.[0];
                return (
                  <button
                    className={`student-matching-choice ${matchedLeft ? "matched" : ""}`}
                    disabled={!selectedLeft && !matchedLeft}
                    key={option.id}
                    onClick={() => selectedLeft ? connectMatchingAnswer(question.id, option.id) : removeMatchingAnswer(question.id, matchedLeft)}
                    type="button"
                  >
                    {option.text}
                    {matchedLeft && !selectedLeft ? <small>Tap to remove</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {question.question_type === "Drag and Drop" ? (
          <div className="student-dragdrop-board">
            <div className="student-dragdrop-column">
              <strong>Available Choices</strong>
              {choices.filter((choice) => !(answers[question.id] || []).includes(choice.id)).map((choice) => (
                <button
                  className="student-dragdrop-chip"
                  key={choice.id}
                  onClick={() => toggleDragDropAnswer(question.id, choice.id)}
                  onPointerDown={(event) => event.currentTarget.setPointerCapture?.(event.pointerId)}
                  type="button"
                >
                  {choice.value}
                </button>
              ))}
            </div>
            <div className="student-dragdrop-column answer">
              <strong>Answer Area</strong>
              {(answers[question.id] || []).length ? (answers[question.id] || []).map((choiceId) => {
                const choice = choices.find((item) => item.id === choiceId);
                if (!choice) return null;
                return (
                  <button
                    className="student-dragdrop-chip selected"
                    key={choice.id}
                    onClick={() => toggleDragDropAnswer(question.id, choice.id)}
                    onPointerDown={(event) => event.currentTarget.setPointerCapture?.(event.pointerId)}
                    type="button"
                  >
                    {choice.value}
                  </button>
                );
              }) : <span className="student-dragdrop-empty">Drop answers here</span>}
            </div>
          </div>
        ) : null}

        {question.question_type === "Ordering / Sequencing" ? orderItems.map((item, itemIndex) => (
          <div
            className="student-order-row"
            data-index={itemIndex}
            data-question-id={question.id}
            key={`${question.id}-${String(item)}`}
            onPointerCancel={endOrderingDrag}
            onPointerDown={(event) => startOrderingDrag(event, question.id, itemIndex)}
            onPointerMove={moveOrderingDrag}
            onPointerUp={endOrderingDrag}
            role="button"
            tabIndex={0}
          >
            <span>{itemIndex + 1}. {item}</span>
            <div className="student-order-controls" aria-label={`Move ${item}`}>
              <button
                aria-label={`Move ${item} up`}
                disabled={itemIndex === 0}
                onClick={() => moveOrderingAnswer(question.id, itemIndex, itemIndex - 1)}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <FiArrowUp />
                <span>Up</span>
              </button>
              <button
                aria-label={`Move ${item} down`}
                disabled={itemIndex === orderItems.length - 1}
                onClick={() => moveOrderingAnswer(question.id, itemIndex, itemIndex + 1)}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <FiArrowDown />
                <span>Down</span>
              </button>
            </div>
          </div>
        )) : null}

        {question.question_type === "File Upload" ? (
          <label className="student-file-answer">
            <FiUpload />
            <span>{files[question.id]?.name || "Upload PDF, DOCX, DOC, JPG, or PNG up to 10MB"}</span>
            <input
              accept={FILE_UPLOAD_ACCEPT}
              onChange={(event) => handleFilePickerChange(question.id, event.target.files?.[0])}
              onClick={() => beginAuthorizedFilePicker(question.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") beginAuthorizedFilePicker(question.id);
              }}
              onPointerDown={() => beginAuthorizedFilePicker(question.id)}
              type="file"
            />
          </label>
        ) : null}
      </Card>
    );
  }

  if (!hasSupabaseConfig) return <PageHeader title="Exam" subtitle="Live Supabase exam taking is required." />;
  if (!exam || !progressReady) return <main className="center-screen">Loading exam and saved progress...</main>;

  if (!attemptEligibility.allowed && !reopenedAttempt) {
    const courseLabel = exam.courses?.course_code && exam.courses?.section ? `${exam.courses.course_code} - ${exam.courses.section}` : exam.courses?.course_code || "Course";
    const typeLabel = exam.exam_type || "Exam";
    const periodLabel = exam.description || "No period";
    const blockedTitle = attemptsExhausted ? "Exam Attempt Completed" : "Exam Unavailable";
    const blockedMessage = attemptsExhausted
      ? attemptEligibility.attemptLimit === 1
        ? "You have completed the available attempt for this exam."
        : `You have used all ${attemptEligibility.attemptLimit} attempts for this exam.`
      : attemptEligibility.reason === "Expired"
        ? "The deadline for this exam has passed."
        : attemptEligibility.reason === "Scheduled"
          ? "This exam is scheduled and has not started yet."
          : "This exam is not currently available.";
    return (
      <main className="student-exam-blocked-page">
        <Card className="student-exam-blocked-card">
          <div className="student-exam-blocked-heading">
            <div>
              <span>{blockedTitle}</span>
              <h1>{exam.exam_title || exam.title}</h1>
              <p>{courseLabel} - {typeLabel} - {periodLabel}</p>
            </div>
            <FiCheckCircle />
          </div>
          <p className="student-exam-blocked-message">{blockedMessage}</p>
          <div className="student-exam-blocked-meta">
            <span>Attempts Used</span>
            <strong>{formatAttemptUsage(attemptEligibility)}</strong>
          </div>
          <div className="student-exam-blocked-actions">
            <Button onClick={() => navigate(exam.course_id ? `/student/courses/${exam.course_id}/materials` : "/student")}>Back to Course</Button>
            {existingAttemptCount > 0 ? <Button onClick={() => navigate("/student/grades")}>View Grades</Button> : null}
          </div>
        </Card>
      </main>
    );
  }

  if (!examCompatibility.supported) {
    return (
      <main className="student-exam-blocked-page">
        <Card className="student-exam-blocked-card student-exam-compatibility-card">
          <div className="student-exam-blocked-heading">
            <div>
              <span>Compatibility Check</span>
              <h1>{exam.exam_title || exam.title}</h1>
              <p>{examCompatibility.message}</p>
            </div>
            <FiXCircle />
          </div>
          <div className="student-exam-compatibility-list" role="list">
            {examCompatibility.missing.map((item) => (
              <article key={item.id} role="listitem">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </article>
            ))}
          </div>
          <p className="student-exam-blocked-message">Use a browser or device that supports the requirements enabled for this exam. Permission prompts, if shown by a supported browser, can still be retried from the normal exam flow.</p>
          <div className="student-exam-blocked-actions">
            <Button onClick={() => navigate(exam.course_id ? `/student/courses/${exam.course_id}/materials` : "/student")}>Back to Available Exams</Button>
          </div>
        </Card>
      </main>
    );
  }

  if (autoSubmitRequired) {
    return (
      <section className="student-exam-take-page" role="alert" aria-live="assertive" aria-busy={submitting}>
        <PageHeader title={exam.exam_title || exam.title} subtitle={`Violations: ${Math.min(violations.length, EXAM_VIOLATION_LIMIT)} / ${EXAM_VIOLATION_LIMIT}`} />
        <Card>
          <FiShield />
          <h2>Maximum violation limit reached</h2>
          <p>{violationWarning(EXAM_VIOLATION_LIMIT)}</p>
          {submissionError ? <>
            <p>Your answers are locked. Submission failed: {submissionError}</p>
            <Button disabled={submitting} onClick={() => handleSubmit("violation_limit")}>Retry Submission</Button>
          </> : <p>Saving your completed answers. Please keep this page open.</p>}
        </Card>
      </section>
    );
  }

  if (interruptionAutoSubmitRequired) {
    return (
      <section className="student-exam-take-page" role="alert" aria-live="assertive" aria-busy={submitting}>
        <PageHeader title={exam.exam_title || exam.title} subtitle={`Interruptions: ${interruptionState.count} / ${interruptionState.limit}`} />
        <Card>
          <FiRefreshCw />
          <h2>Interruption limit exceeded</h2>
          <p>Your exam is locked while automatic submission is finalized.</p>
          {submissionError ? <>
            <p>Your answers are preserved locally. Submission failed: {submissionError}</p>
            <Button disabled={submitting} onClick={() => handleSubmit("interruption_limit")}>Retry Submission</Button>
          </> : <p>Saving your current answers. Please keep this page open.</p>}
        </Card>
      </section>
    );
  }

  if (!scanPassed || scanOpen) {
    const scanActive = scanStatus === "scanning";
    const activeScanAngleId = selectedScanAngleId || scanSummary.nextAngleId;
    const activeScanAngle = SCAN_ANGLES.find((angle) => angle.id === activeScanAngleId) || null;
    const capturedPercent = Math.round((scanSummary.capturedCount / scanSummary.total) * 100);
    const scanIssues = SCAN_ANGLES
      .map((angle) => scanState.angles[angle.id])
      .filter((angle) => angle.reason && [ANGLE_STATUS.REJECTED, ANGLE_STATUS.RECAPTURE, ANGLE_STATUS.ERROR].includes(angle.status));
    const outcomeAlert = scanActive ? {
      [SCAN_OUTCOME.RISK]: { tone: "danger", title: "Prohibited item detected", text: "Remove the item from your exam area, then retake the affected angle." },
      [SCAN_OUTCOME.RESCAN]: { tone: "warning", title: "Some angles need to be retaken", text: "Only the listed angles need a new capture." },
      [SCAN_OUTCOME.TECHNICAL]: { tone: "warning", title: "The environment check could not finish", text: "This is a connection or service problem, not a violation. Retry the check for the listed angle." },
    }[scanSummary.outcome] : null;
    const captureLabel = !scanCameraReady
      ? "Starting camera..."
      : scanCapturing
        ? "Capturing..."
        : activeScanAngle
          ? `Capture ${activeScanAngle.title}`
          : scanSummary.outcome === "analyzing" ? "Checking captures..." : "All angles captured";

    return (
      <section className="student-exam-take-page">
        <PageHeader
          title="Environment Scan"
          subtitle="Complete the required camera scan before taking the exam."
        />

        <Card className="student-environment-scan">
          <div className="student-scan-hero">
            <div>
              <FiShield />
              <h2>{scanStatus === "passed" ? "Scan Passed" : scanActive && activeScanAngle ? activeScanAngle.title : "Environment Scan"}</h2>
              <p>
                {scanStatus === "passed"
                  ? "Your environment scan is complete. You can proceed to the exam."
                  : scanActive
                    ? activeScanAngle ? `${activeScanAngle.instruction} Then press Capture.` : "All five angles are captured. Waiting for the environment check to finish."
                    : "Start the camera, then capture the front, left, right, upper and desk views one at a time."}
              </p>
            </div>
            <span>{scanSummary.capturedCount} of {scanSummary.total} captured</span>
          </div>

          {cameraError ? <div className="student-scan-alert danger"><FiXCircle /> {cameraError}</div> : null}
          {scanStatus === "failed" && scanFindings.length ? (
            <div className="student-scan-alert danger" role="alert">
              <FiXCircle />
              <div>
                <strong>Environment scan needs to be repeated.</strong>
                <p>{scanFindings[0].instruction || scanFindings[0].label}</p>
              </div>
            </div>
          ) : null}
          {outcomeAlert ? (
            <div className={`student-scan-alert ${outcomeAlert.tone}`} role="alert">
              <FiXCircle />
              <div>
                <strong>{outcomeAlert.title}</strong>
                <p>{outcomeAlert.text}</p>
                <ul>
                  {scanIssues.map((angle) => <li key={angle.id}>{getScanAngleTitle(angle.id)}: {angle.reason}</li>)}
                </ul>
              </div>
            </div>
          ) : null}

          {scanStatus === "passed" ? (
            <div className="student-scan-alert success"><FiCheckCircle /> Environment scan passed.</div>
          ) : null}

          <div className="student-camera-frame">
            {scanStatus === "idle" || scanStatus === "failed" || scanStatus === "passed" ? (
              <div className="student-camera-placeholder">
                <FiCamera />
                <span>Camera preview will appear here.</span>
              </div>
            ) : null}
            <video autoPlay muted playsInline ref={videoRef} />
            <canvas ref={canvasRef} />
          </div>

          {scanActive ? (
            <div className="student-scan-meter" aria-live="polite">
              <div>
                <strong>{scanSummary.capturedCount} of {scanSummary.total} captured</strong>
                <span>{scanSummary.approvedCount} approved</span>
              </div>
              <div>
                <span style={{ width: `${capturedPercent}%` }} />
              </div>
              <small>Each angle is checked separately. Retaking one angle keeps the others.</small>
            </div>
          ) : null}

          <div className="student-scan-steps">
            {SCAN_ANGLES.map((angle, index) => {
              const angleState = scanState.angles[angle.id];
              const status = angleState.status;
              const tone = status === ANGLE_STATUS.APPROVED
                ? "done"
                : status === ANGLE_STATUS.REJECTED
                  ? "rejected"
                  : [ANGLE_STATUS.RECAPTURE, ANGLE_STATUS.ERROR].includes(status)
                    ? "warning"
                    : scanActive && angle.id === activeScanAngleId ? "active" : "";
              const canSelect = scanActive && !scanCapturing && angle.id !== activeScanAngleId && [ANGLE_STATUS.PENDING, ANGLE_STATUS.RECAPTURE, ANGLE_STATUS.REJECTED].includes(status);
              const canRetake = scanActive && !scanCapturing && [ANGLE_STATUS.ANALYZING, ANGLE_STATUS.APPROVED, ANGLE_STATUS.ERROR].includes(status);
              return (
                <span className={tone} key={angle.id}>
                  {canSelect ? (
                    <button className="student-scan-step-select" onClick={() => setSelectedScanAngleId(angle.id)} type="button">{index + 1}. {angle.title}</button>
                  ) : <>{index + 1}. {angle.title}</>}
                  <small>{scanStatus === "passed" ? "Approved" : SCAN_ANGLE_STATUS_LABELS[status]}</small>
                  {scanActive && status === ANGLE_STATUS.ERROR ? (
                    <button className="student-scan-step-action" onClick={() => retryScanAngleAnalysis(angle.id)} type="button">Retry check</button>
                  ) : null}
                  {canRetake ? (
                    <button className="student-scan-step-action" onClick={() => retakeScanAngle(angle.id)} type="button">Retake</button>
                  ) : null}
                </span>
              );
            })}
            <span className={scanStatus === "passed" ? "done" : ""}>
              {SCAN_ANGLES.length + 1}. Keep the tab active until the scan completes.
            </span>
          </div>

          <div className="student-scan-actions">
            <Button disabled={scanActive} onClick={switchEnvironmentCamera} type="button"><FiRepeat /> {scanFacingMode === "user" ? "Use Rear Camera" : "Use Front Camera"}</Button>
            {scanStatus === "idle" || scanStatus === "failed" ? <Button onClick={startEnvironmentScan}><FiCamera /> Start Scan</Button> : null}
            {scanActive ? <Button disabled={!scanCameraReady || scanCapturing || !activeScanAngle} onClick={() => captureScanAngle(activeScanAngle.id)} type="button"><FiCamera /> {captureLabel}</Button> : null}
            {scanActive || scanStatus === "failed" || scanStatus === "passed" ? <Button onClick={retakeEnvironmentScan} type="button"><FiRefreshCw /> {scanStatus === "passed" ? "Retake" : "Restart Scan"}</Button> : null}
            {scanStatus === "passed" ? <Button disabled={examStarting} onClick={enterExamMode}><FiCheckCircle /> Use Photo / {secureModeRequired ? "Continue to Secure Exam" : "Start Exam"}</Button> : null}
          </div>
        </Card>
      </section>
    );
  }

  if (!examModeReady) {
    return (
      <section className="student-exam-start-page">
        <div className="student-exam-start-panel">
          <h1>{exam.exam_title || exam.title}</h1>{exam.exam_settings?.instructions ? <p style={{ whiteSpace: "pre-wrap" }}>{exam.exam_settings.instructions}</p> : null}
          <div className="student-exam-start-meta">
            <span>{exam.courses?.course_code || "Course"}</span>
            <span>{formatDurationLabel(exam.time_limit || exam.duration)}</span>
            <span>{totalPoints} points</span>
          </div>
          <p>{secureModeRequired ? "Fullscreen and monitoring permissions are required." : "Fullscreen is required before taking the exam."}</p>
          {savedProgress?.savedAt ? (
            <div className="student-exam-resume-note">
              <strong>Saved progress found</strong>
              <span>Last saved {new Date(savedProgress.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ) : null}
          <div className="student-exam-start-actions">
            {savedProgress ? <Button disabled={!scanPassed || attemptsExhausted || examStarting} onClick={resumeExamMode}>Resume Exam</Button> : null}
            <Button disabled={!scanPassed || attemptsExhausted || examStarting} onClick={enterExamMode}>{examStarting ? "Starting..." : "Start Exam"}</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="student-exam-take-page with-proctor-dock">
      <PageHeader
        title={exam.exam_title || exam.title}
        subtitle={(
          <span className="student-exam-meta">
            {exam.courses?.course_code ? <span>{[exam.courses.course_code, exam.courses.section].filter(Boolean).join(" ")}</span> : null}
            <span><FiClock aria-hidden="true" /> {formatDurationLabel(exam.time_limit || exam.duration)}</span>
            <span>{totalPoints} {Number(totalPoints) === 1 ? "point" : "points"}</span>
          </span>
        )}
        actions={<Button disabled={submitting || !scanPassed || examLocked || isMicrophoneBlocked || attemptsExhausted || interruptionLimitExceededRef.current} onClick={() => handleSubmit("manual")}>{submitting ? "Submitting..." : "Submit Exam"}</Button>}
      />

      <div className="student-exam-workspace">
        <div className="student-exam-question-list">
          {questions.map(renderQuestion)}
        </div>

        <aside className="student-proctor-dock" aria-label="Live proctoring panel">
          {/* Time, violations and interruptions stay at the top so they never need scrolling. */}
          <section className="student-proctor-status-card" aria-label="Exam status">
            <div className="student-proctor-stats">
              <div className={`student-proctor-stat ${hasTimer && remainingMs !== null && remainingMs <= 60000 ? "urgent" : ""}`} role="timer" aria-live="polite">
                <span><FiClock aria-hidden="true" /> Time left</span>
                <strong>{hasTimer ? formatRemainingTime(remainingMs ?? (timerEndsAt ? new Date(timerEndsAt).getTime() - Date.now() : durationMinutes * 60 * 1000)) : "No timer"}</strong>
              </div>
              <div className={`student-proctor-stat ${violations.length >= 3 ? "urgent" : ""}`} role="status" aria-live="polite" title={violations.length ? violationWarning(violations.length) : `Auto-submit after ${EXAM_VIOLATION_LIMIT} violations.`}>
                <span><FiShield aria-hidden="true" /> Violations</span>
                <strong>{violations.length} / {EXAM_VIOLATION_LIMIT}</strong>
                {renderStatusPips(violations.length, EXAM_VIOLATION_LIMIT)}
              </div>
              <div className={`student-proctor-stat ${interruptionState.count >= interruptionState.limit ? "urgent" : ""}`} role="status" aria-live="polite" title={interruptionWarning(interruptionState)}>
                <span><FiRefreshCw aria-hidden="true" /> Interruptions</span>
                <strong>{interruptionState.count} / {interruptionState.limit}</strong>
                {renderStatusPips(interruptionState.count, interruptionState.limit)}
              </div>
            </div>
            {violations.length >= 3 ? <p className="student-proctor-status-warning">{violationWarning(violations.length)}</p> : null}
            {interruptionState.count >= interruptionState.limit ? <p className="student-proctor-status-warning">{interruptionWarning(interruptionState)}</p> : null}
          </section>

          {proctoringEnabled ? (
            <section className="student-proctor-camera-card">
              {liveCameraMonitoringEnabled ? (
                <>
                  <div className="student-proctor-video-frame">
                    <video autoPlay muted playsInline ref={proctorVideoRef} />
                    <div className="student-face-bounding-box" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <div className="student-proctor-pills">
                    <span title="Face tracking"><FiShield aria-hidden="true" /> {faceStatus}</span>
                    <span title={roboflowMonitoringEnabled ? "Roboflow detection active" : "Camera monitoring active"}><FiCamera aria-hidden="true" /> {roboflowStatus}</span>
                  </div>
                </>
              ) : null}
              {examSettings.liveAudioMonitoring ? (
                <AudioMonitoringTimeline
                  level={audioMonitoring.audioLevel}
                  micStatus={audioMonitoring.micStatus}
                  status={audioMonitoring.audioStatus}
                  timeline={audioMonitoring.timeline}
                />
              ) : null}
            </section>
          ) : null}

          <section className="student-proctor-alert-card">
            <div className="student-proctor-alert-heading">
              <strong>Live alerts</strong>
              <span>{violations.length}</span>
            </div>
            <div className="student-proctor-alert-list">
              {violations.length ? violations.slice(-3).reverse().map((violation, index) => (
                <article key={`${violation.timestamp}-${index}`} title={`${violation.severity} severity`}>
                  <strong>{violation.message}</strong>
                  <span>{new Date(violation.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </article>
              )) : <p>No alerts yet.</p>}
            </div>
          </section>
        </aside>
      </div>

      {examLocked ? (
        <div className="student-exam-lock-overlay" role="alert">
          <Card>
            <FiShield />
            <h2>Exam Paused</h2>
            <p>{examLockMessage}</p>
            {interruptionLimitExceededRef.current ? null : <Button onClick={restoreExamLock}>Return to Fullscreen</Button>}
          </Card>
        </div>
      ) : null}

      {isMicrophoneBlocked ? (
        <div className="student-exam-lock-overlay student-microphone-lock-overlay" role="alert" aria-live="assertive">
          <Card>
            <FiMic />
            <h2>Microphone Required</h2>
            <p>Your microphone appears to be muted, disabled, disconnected, or unavailable. Microphone access is required during the exam.</p>
            <p>Please unmute or reconnect your microphone to continue.</p>
            {microphoneBlockReason ? <small>{microphoneBlockReason}</small> : null}
            {microphoneSilencePausedRef.current ? <strong>Audio level: {audioMonitoring.audioLevel}% (at least {SILENCE_RESUME_LEVEL}% needed)</strong> : null}
            <span>Checking microphone automatically…</span>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
