import { useEffect, useMemo, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { connectors, webrtc } from "@roboflow/inference-sdk";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";
import { FiCamera, FiCheckCircle, FiClock, FiMic, FiRefreshCw, FiShield, FiUpload, FiXCircle } from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import AudioMonitoringTimeline from "../../components/exam/AudioMonitoringTimeline";
import { Button, Card, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useLiveAudioMonitoring } from "../../hooks/useLiveAudioMonitoring";
import { computeAttemptScore, FILE_UPLOAD_ACCEPT, FILE_UPLOAD_LIMIT_BYTES, FILE_UPLOAD_MIME_TYPES, getCorrectAnswers, getQuestionConfig } from "../../lib/examQuestionTypes";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function toJsonAnswer(value) {
  return value === undefined ? null : value;
}

function moveItemToIndex(items, fromIndex, toIndex) {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

const environmentSteps = [
  { id: "left", title: "180° Left Scan", instruction: "Start from the center, then slowly rotate your camera to the left side of your surroundings." },
  { id: "right", title: "180° Right Scan", instruction: "Return through center, then slowly rotate your camera to the right side of your surroundings." },
];

const scanCheckpoints = [
  { id: "center", title: "Center View", instruction: "Face the camera forward and show the front of your environment.", message: "Center view captured." },
  ...environmentSteps.map((step) => step.id === "left"
    ? { id: step.id, title: "Left Side", instruction: "Slowly show the left side of your environment.", message: "Left side captured." }
    : { id: step.id, title: "Right Side", instruction: "Slowly show the right side of your environment.", message: "Right side captured." }),
];

const MIN_SCAN_DURATION_MS = 5000;
const MAX_SCAN_DURATION_MS = 20000;
const TAB_INACTIVE_GRACE_MS = 1000;
const MAX_CAPTURE_RETRIES = 3;
const SCAN_SAMPLE_MS = 500;
const ENV_SCAN_TIMEOUT_MS = 12000;
const MIN_FRAME_CHANGE_DISTANCE = 16;
const MIN_UNIQUE_SCENE_DISTANCE = 26;
const MIN_UNIQUE_VIEW_INTERVAL_MS = 650;
const MAX_REPEATED_FRAME_SAMPLES = 12;
const MIN_FRAME_TEXTURE_SCORE = 10;
const CHECKPOINT_FRAMES_REQUIRED = 3;
const CHECKPOINT_PROGRESS = 100 / (scanCheckpoints.length * CHECKPOINT_FRAMES_REQUIRED);
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
const ENV_SCAN_OBJECT_CONFIDENCE = 0.62;
const ENV_SCAN_PHONE_CONFIDENCE = 0.25;
const ROBOFLOW_OBJECT_CONFIDENCE = Number(import.meta.env.VITE_ROBOFLOW_OBJECT_CONFIDENCE || 0.35);
const ROBOFLOW_MODEL_ID = import.meta.env.VITE_ROBOFLOW_MODEL || "spare-gadget-detection";
const ROBOFLOW_MODEL_VERSION = import.meta.env.VITE_ROBOFLOW_MODEL_VERSION || "16";
const ROBOFLOW_API_BASE = import.meta.env.VITE_ROBOFLOW_API_BASE || "https://detect.roboflow.com";
const PHONE_LABELS = new Set(["cell phone", "mobile phone", "phone", "smartphone", "cellphone", "cellular phone", "iphone", "android phone", "handphone", "mobile"]);
const GADGET_LABELS = new Set(["cell phone", "mobile phone", "phone", "smartphone", "cellphone", "cellular phone", "iphone", "android phone", "handphone", "mobile", "laptop", "tablet"]);
const ROBOFLOW_GADGET_LABELS = new Set(["cell phone", "mobile phone", "phone", "smartphone", "cellphone", "cellular phone", "iphone", "android phone", "handphone", "mobile", "laptop", "tablet", "ipad"]);
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

function normalizeDetectionLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPhoneDetectionLabel(value) {
  const label = normalizeDetectionLabel(value);
  return PHONE_LABELS.has(label) || label.includes("phone") || label.includes("iphone") || label.includes("mobile");
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

function getAttemptLimit(settings) {
  const value = String(settings?.attemptLimit || settings?.attempts || "Unlimited").toLowerCase();
  if (value.includes("unlimited")) return Infinity;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Infinity;
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

function getSignatureDifference(previous, next) {
  if (!previous?.length || !next?.length || previous.length !== next.length) return 0;
  const total = next.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0);
  return total / next.length;
}

function getSignatureTextureScore(signature) {
  if (!signature?.length) return 0;
  const average = signature.reduce((sum, value) => sum + value, 0) / signature.length;
  const variance = signature.reduce((sum, value) => sum + ((value - average) ** 2), 0) / signature.length;
  return Math.sqrt(variance);
}

export default function StudentExamTake() {
  const { examId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [selectedMatchingLeft, setSelectedMatchingLeft] = useState({});
  const [files, setFiles] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [timerEndsAt, setTimerEndsAt] = useState(null);
  const [remainingMs, setRemainingMs] = useState(null);
  const [submitting, setSubmitting] = useState(false);
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
  const objectAlertCooldownRef = useRef(0);
  const phoneAlertCooldownRef = useRef(0);
  const objectDetectorRef = useRef(null);
  const orderingDragRef = useRef(null);
  const roboflowConnectionRef = useRef(null);
  const roboflowAlertCooldownRef = useRef(0);
  const orientationRef = useRef({ available: false, alpha: null, centerAlpha: null, samples: 0 });
  const scanCancelledRef = useRef(false);
  const scanInactiveTimerRef = useRef(null);
  const [scanOpen, setScanOpen] = useState(true);
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [scanMotion, setScanMotion] = useState({});
  const [scanProgress, setScanProgress] = useState({});
  const [scanFindings, setScanFindings] = useState([]);
  const [scanSensorStatus, setScanSensorStatus] = useState("Motion sensor pending");
  const [cameraError, setCameraError] = useState("");
  const [examModeReady, setExamModeReady] = useState(false);
  const [examLocked, setExamLocked] = useState(false);
  const [existingAttemptCount, setExistingAttemptCount] = useState(0);
  const [violations, setViolations] = useState([]);
  const [savedProgress, setSavedProgress] = useState(null);
  const examSubmittingRef = useRef(false);
  const examSubmittedRef = useRef(false);
  const timerExpiredRef = useRef(false);
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
  const attemptLimit = getAttemptLimit(exam?.exam_settings);
  const durationMinutes = getDurationMinutes(exam);
  const hasTimer = durationMinutes > 0;
  const examAlreadyTaken = existingAttemptCount > 0;
  const attemptsExhausted = examAlreadyTaken || (Number.isFinite(attemptLimit) && existingAttemptCount >= attemptLimit);
  const roboflowConfigured = Boolean(
    import.meta.env.VITE_ROBOFLOW_API_KEY
    || import.meta.env.VITE_ROBOFLOW_PROXY_URL
    || import.meta.env.VITE_ROBOFLOW_ENV_SCAN_ENDPOINT,
  );
  const liveCameraMonitoringEnabled = examSettings.liveCameraMonitoring || roboflowConfigured;
  const proctoringEnabled = liveCameraMonitoringEnabled || examSettings.liveAudioMonitoring;
  const secureModeRequired = proctoringEnabled;
  const audioMonitoring = useLiveAudioMonitoring({
    enabled: examSettings.liveAudioMonitoring,
    exam,
    student: user,
    onViolation: (violation) => {
      setViolations((current) => [...current, violation]);
      toast.warning(violation.message);
    },
  });

  useEffect(() => {
    if (!hasSupabaseConfig || !examId || !user?.id) return;

    async function loadExam() {
      let examRow = null;
      let examError = null;
      const examResult = await supabase
        .from("exams")
        .select("id, title, exam_title, duration, time_limit, exam_type, course_id, professor_id, created_by, exam_settings, courses(course_name, course_code, section)")
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
        .from("exam_questions")
        .select("id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points")
        .eq("exam_id", examId)
        .order("id", { ascending: true });

      if (examError) {
        toast.error(examError.message);
        return;
      }
      if (questionsError) {
        toast.error(questionsError.message);
        return;
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

      setExam(examRow);
      setExistingAttemptCount(count || 0);
      setQuestions(questionRows || []);
      const saved = readSavedExamProgress(user.id, examId);
      const defaultAnswers = (questionRows || []).reduce((items, question) => {
        const config = getQuestionConfig(question);
        if (question.question_type === "Ordering / Sequencing") items[question.id] = [...(config.orderItems || getCorrectAnswers(question))].sort(() => Math.random() - 0.5);
        if (question.question_type === "Enumeration") items[question.id] = ["", "", ""];
        if (question.question_type === "Matching Type") items[question.id] = {};
        if (question.question_type === "Multiple Select") items[question.id] = [];
        return items;
      }, {});
      setAnswers({ ...defaultAnswers, ...(saved?.answers || {}) });
      setViolations(saved?.violations || []);
      setSavedProgress(saved);
      setStartedAt(saved?.startedAt || null);
      setTimerEndsAt(saved?.timerEndsAt || null);
      if (saved?.scanStatus === "passed") {
        setScanStatus("passed");
        setScanOpen(false);
      }
    }

    loadExam();
  }, [examId, user?.id]);

  useEffect(() => {
    return () => {
      scanCancelledRef.current = true;
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
    if (!examModeReady || examSubmittedRef.current || !user?.id || !examId) return;
    writeSavedExamProgress(user.id, examId, {
      answers,
      violations,
      scanStatus,
      startedAt,
      timerEndsAt,
      savedAt: new Date().toISOString(),
    });
    setSavedProgress({ answers, violations, scanStatus, startedAt, timerEndsAt, savedAt: new Date().toISOString() });
  }, [answers, examId, examModeReady, scanStatus, startedAt, timerEndsAt, user?.id, violations]);

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
        setExamLocked(true);
        recordGuardViolation("FULLSCREEN_EXIT", "Fullscreen mode was exited. Return to fullscreen to continue.", "High");
      }
    }

    function handleVisibilityChange() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
      if (window.document.hidden) {
        setExamLocked(true);
        recordGuardViolation("TAB_SWITCH", "Tab switch or hidden exam tab detected.", "High");
      }
    }

    function handleWindowBlur() {
      if (examSubmittingRef.current || examSubmittedRef.current) return;
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
    window.document.addEventListener("visibilitychange", handleVisibilityChange);
    window.document.addEventListener("mouseleave", handleMouseLeave);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      blockedEvents.forEach((eventName) => window.document.removeEventListener(eventName, blockEvent, true));
      window.document.removeEventListener("keydown", handleKeyDown, true);
      fullscreenEvents.forEach((eventName) => window.document.removeEventListener(eventName, handleFullscreenChange));
      window.document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("blur", handleWindowBlur);
    };
  // The guard listeners should only be rebound when secure exam mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeReady, scanOpen, scanPassed]);

  useEffect(() => {
    if (!examModeReady || !hasTimer || !timerEndsAt || examSubmittedRef.current) return undefined;

    function tick() {
      const nextRemaining = new Date(timerEndsAt).getTime() - Date.now();
      setRemainingMs(Math.max(0, nextRemaining));
      if (nextRemaining <= 0 && !timerExpiredRef.current && !examSubmittingRef.current && !examSubmittedRef.current) {
        timerExpiredRef.current = true;
        toast.error("Time is up. Submitting your exam now.");
        void handleSubmit();
      }
    }

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  // Timer should follow only the active deadline and exam mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examModeReady, hasTimer, timerEndsAt]);

  function setAnswer(questionId, value) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function toggleMultiAnswer(questionId, key) {
    setAnswers((current) => {
      const selected = current[questionId] || [];
      return {
        ...current,
        [questionId]: selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key],
      };
    });
  }

  function setEnumerationAnswer(questionId, index, value) {
    setAnswers((current) => ({
      ...current,
      [questionId]: (current[questionId] || ["", "", ""]).map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  }

  function setMatchingAnswer(questionId, left, right) {
    setAnswers((current) => {
      const nextMatches = Object.entries(current[questionId] || {}).reduce((items, [key, value]) => {
        if (value !== right || key === left) items[key] = value;
        return items;
      }, {});
      nextMatches[left] = right;
      return { ...current, [questionId]: nextMatches };
    });
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
    setAnswers((current) => ({
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
    setScanStatus("failed");
    setScanFindings([{ label: message, instruction: message }]);
    setScanProgress({});
    setScanMotion({});
    setScanStepIndex(0);
    stopEnvironmentCamera();
  }

  function handleDeviceOrientation(event) {
    if (!Number.isFinite(event.alpha)) return;
    orientationRef.current.available = true;
    orientationRef.current.alpha = Number(event.alpha);
    orientationRef.current.samples += 1;
    if (!Number.isFinite(orientationRef.current.centerAlpha)) {
      orientationRef.current.centerAlpha = Number(event.alpha);
    }
    setScanSensorStatus("Motion sensor active with visual coverage check");
  }

  async function startOrientationTracking() {
    orientationRef.current = { available: false, alpha: null, centerAlpha: null, samples: 0 };
    setScanSensorStatus("Checking camera movement");

    try {
      if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
        const permission = await window.DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          setScanSensorStatus("Visual coverage mode active");
          return;
        }
      }

      window.addEventListener("deviceorientation", handleDeviceOrientation, true);
      window.setTimeout(() => {
        if (!orientationRef.current.available) {
          setScanSensorStatus("Visual coverage mode active");
        }
      }, 1600);
    } catch {
      setScanSensorStatus("Visual coverage mode active");
    }
  }

  function stopOrientationTracking() {
    window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
    orientationRef.current = { available: false, alpha: null, centerAlpha: null, samples: 0 };
  }

  async function startEnvironmentScan() {
    setCameraError("");
    setScanFindings([]);
    setScanMotion({});
    setScanProgress({});
    setScanSensorStatus("Checking camera movement");
    setScanStepIndex(0);
    setScanStatus("scanning");
    scanCancelledRef.current = false;

    try {
      await startOrientationTracking();
      const stream = await window.navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
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
      await runLiveEnvironmentScan();
    } catch (error) {
      window.console.error("[EnvironmentScan]", error);
      setScanStatus("idle");
      setCameraError(getEnvironmentScanError(error));
      stopEnvironmentCamera();
    }
  }

  function stopEnvironmentCamera() {
    scanCancelledRef.current = true;
    stopOrientationTracking();
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
    const signature = getFrameSignature(context, canvas.width, canvas.height);
    return {
      image: canvas.toDataURL("image/jpeg", 0.82),
      signature,
      textureScore: getSignatureTextureScore(signature),
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

  async function runLiveEnvironmentScan() {
    const collectedFrames = { center: [], left: [], right: [] };
    const progressScores = { center: 0, left: 0, right: 0 };
    const acceptedSignatures = { center: [], left: [], right: [] };
    const allAcceptedSignatures = [];
    const captured = { center: false, left: false, right: false };
    let previousSignature = null;
    let repeatedSamples = 0;
    let lastAcceptedAt = 0;
    let checkpointIndex = 0;
    const scanStartedAt = Date.now();

    while (checkpointIndex < scanCheckpoints.length) {
      if (scanCancelledRef.current) return;
      const checkpoint = scanCheckpoints[checkpointIndex];
      setScanStepIndex(checkpointIndex);

      if (Date.now() - scanStartedAt > MAX_SCAN_DURATION_MS) break;

      const frame = await captureCurrentFrameWithRetry();
      if (frame) {
        const phoneFinding = await detectPhoneInScanFrame(frame.image, checkpoint.id);
        if (phoneFinding) {
          setScanFindings([phoneFinding]);
          setScanStatus("failed");
          setScanSensorStatus("Phone detected. Remove it and scan again.");
          stopEnvironmentCamera();
          toast.error("Phone detected during environment scan. Please remove it and scan again.");
          return;
        }

        const frameChange = previousSignature ? getSignatureDifference(previousSignature, frame.signature) : MIN_FRAME_CHANGE_DISTANCE;
        previousSignature = frame.signature;
        repeatedSamples = frameChange < MIN_FRAME_CHANGE_DISTANCE ? repeatedSamples + 1 : 0;

        if (repeatedSamples >= MAX_REPEATED_FRAME_SAMPLES) {
          setScanSensorStatus("Progress paused. Slowly show a different side of your environment.");
        }

        const nearestSceneDistance = allAcceptedSignatures.length
          ? Math.min(...allAcceptedSignatures.map((signature) => getSignatureDifference(signature, frame.signature)))
          : Number.POSITIVE_INFINITY;
        const nearestCheckpointDistance = acceptedSignatures[checkpoint.id].length
          ? Math.min(...acceptedSignatures[checkpoint.id].map((signature) => getSignatureDifference(signature, frame.signature)))
          : Number.POSITIVE_INFINITY;
        const imageChanged = frameChange >= MIN_FRAME_CHANGE_DISTANCE;
        const isUsefulFrame = frame.textureScore >= MIN_FRAME_TEXTURE_SCORE;
        const isUniqueScene = !allAcceptedSignatures.length || nearestSceneDistance >= MIN_UNIQUE_SCENE_DISTANCE;
        const isUniqueForCheckpoint = !acceptedSignatures[checkpoint.id].length || nearestCheckpointDistance >= MIN_UNIQUE_SCENE_DISTANCE;
        const enoughTimePassed = Date.now() - lastAcceptedAt >= MIN_UNIQUE_VIEW_INTERVAL_MS;
        const canAcceptFrame = isUsefulFrame && enoughTimePassed && (
          !acceptedSignatures[checkpoint.id].length
          || (imageChanged && isUniqueForCheckpoint && isUniqueScene)
        );

        if (canAcceptFrame) {
          acceptedSignatures[checkpoint.id].push(frame.signature);
          allAcceptedSignatures.push(frame.signature);
          collectedFrames[checkpoint.id].push({
            image: frame.image,
            timestamp: frame.timestamp,
            angle: checkpoint.id,
          });
          lastAcceptedAt = Date.now();

          if (collectedFrames[checkpoint.id].length >= CHECKPOINT_FRAMES_REQUIRED) {
            captured[checkpoint.id] = true;
            checkpointIndex += 1;
          }

          const acceptedFrameCount = scanCheckpoints.reduce((total, step) => total + Math.min(CHECKPOINT_FRAMES_REQUIRED, collectedFrames[step.id].length), 0);
          const totalProgress = Math.min(100, Math.round(acceptedFrameCount * CHECKPOINT_PROGRESS));
          progressScores.center = Math.min(100, Math.round((collectedFrames.center.length / CHECKPOINT_FRAMES_REQUIRED) * 100));
          progressScores.left = Math.min(100, Math.round((collectedFrames.left.length / CHECKPOINT_FRAMES_REQUIRED) * 100));
          progressScores.right = Math.min(100, Math.round((collectedFrames.right.length / CHECKPOINT_FRAMES_REQUIRED) * 100));
          setScanProgress({
            surroundings: totalProgress,
            center: progressScores.center,
            left: progressScores.left,
            right: progressScores.right,
          });
          setScanSensorStatus(captured[checkpoint.id] ? checkpoint.message : `Capturing ${checkpoint.title.toLowerCase()} ${progressScores[checkpoint.id]}%.`);
        } else if (imageChanged && (!isUniqueScene || !isUniqueForCheckpoint)) {
          setScanSensorStatus("This spot was already captured. Show a different part of your environment.");
        } else if (!isUsefulFrame) {
          setScanSensorStatus("Frame is too blurry or plain. Move slowly and show a clearer surrounding view.");
        } else if (!imageChanged) {
          setScanSensorStatus("Camera movement is too small. Slowly show a wider view of your environment.");
        }

        setScanMotion({
          center: captured.center ? 1 : 0,
          left: captured.left ? 1 : 0,
          right: captured.right ? 1 : 0,
          surroundings: Number.isFinite(nearestSceneDistance) ? nearestSceneDistance : MIN_UNIQUE_SCENE_DISTANCE,
        });
      }

      await wait(SCAN_SAMPLE_MS);
    }

    if (scanCancelledRef.current) return;
    if (Date.now() - scanStartedAt < MIN_SCAN_DURATION_MS) {
      await wait(MIN_SCAN_DURATION_MS - (Date.now() - scanStartedAt));
    }

    const incompleteSide = scanCheckpoints.find((step) => !captured[step.id] || !collectedFrames[step.id].length);
    if (incompleteSide) {
      setScanStatus("failed");
      setScanFindings([{ label: `${incompleteSide.title} not captured`, instruction: `Please show the ${incompleteSide.id} side of your environment.` }]);
      stopEnvironmentCamera();
      return;
    }

    setScanStatus("analyzing");

    try {
      const result = await analyzeEnvironment(collectedFrames, progressScores);
      const findings = result.findings || [];
      if (result.passed === false || findings.length) {
        setScanFindings(findings);
        setScanStatus("failed");
        stopEnvironmentCamera();
        return;
      }

      setScanFindings([]);
      setScanStatus("passed");
      stopEnvironmentCamera();
      toast.success("Environment scan passed. You may now take the exam.");
    } catch (error) {
      window.console.error("[EnvironmentScan]", error);
      setScanStatus("failed");
      setScanFindings([{ label: getEnvironmentScanError(error), instruction: getEnvironmentScanError(error) }]);
      stopEnvironmentCamera();
    }
  }

  async function analyzeEnvironment(frames, progressScores = {}) {
    const capturedCount = scanCheckpoints.reduce((total, step) => total + (frames[step.id] || []).length, 0);
    if (!capturedCount) throw new Error("No scan image was captured.");

    try {
      const roboflowResult = await analyzeEnvironmentWithRoboflow(frames, progressScores);
      if (roboflowResult) {
        return roboflowResult;
      }
    } catch (error) {
      window.console.warn("[EnvironmentScan] Roboflow scan unavailable, using fallback analysis.", error);
    }

    const localFindings = await detectEnvironmentGadgets(frames);
    if (localFindings.length) {
      return { passed: false, findings: localFindings };
    }

    const endpoint = getUsableScanEndpoint(import.meta.env.VITE_ENV_SCAN_ENDPOINT);
    if (!endpoint) {
      return { passed: true, findings: [] };
    }

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
        frames: scanCheckpoints.map((step) => ({
          angle: step.id,
          images: (frames[step.id] || []).map((frame) => dataUrlToPayload(frame.image || frame)),
          captures: (frames[step.id] || []).map((frame) => ({
            timestamp: frame.timestamp,
            angle: frame.angle,
          })),
          movementScore: Number((progressScores[step.id] || 0).toFixed(2)),
        })),
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Analysis server error (${response.status}). Please try again.`);
    return result;
  }

  async function analyzeEnvironmentWithRoboflow(frames, progressScores = {}) {
    const proxyUrl = import.meta.env.VITE_ROBOFLOW_PROXY_URL;
    const endpoint = getUsableScanEndpoint(import.meta.env.VITE_ROBOFLOW_ENV_SCAN_ENDPOINT || (proxyUrl ? `${proxyUrl.replace(/\/$/, "")}/api/environment-scan` : ""));
    const framePayload = scanCheckpoints.map((step) => ({
      angle: step.id,
      images: (frames[step.id] || []).map((frame) => dataUrlToPayload(frame.image || frame)),
      captures: (frames[step.id] || []).map((frame) => ({
        timestamp: frame.timestamp,
        angle: frame.angle,
      })),
      movementScore: Number((progressScores[step.id] || 0).toFixed(2)),
    }));

    if (!endpoint) {
      return analyzeEnvironmentWithDirectRoboflow(framePayload);
    }

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        examId,
        studentId: user?.id,
        frames: framePayload,
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Roboflow analysis server error (${response.status}). Please try again.`);
    }

    return response.json();
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

  async function analyzeEnvironmentWithDirectRoboflow(framePayload) {
    if (!import.meta.env.VITE_ROBOFLOW_API_KEY) return null;

    const findings = [];
    const detectedLabels = new Set();
    for (const frame of framePayload) {
      for (const image of frame.images || []) {
        const result = await runDirectRoboflowImageDetection(image);
        const prediction = collectRoboflowPredictions(result).find((item) => (
          (ROBOFLOW_GADGET_LABELS.has(item.label) || isPhoneDetectionLabel(item.label))
          && item.confidence >= ROBOFLOW_OBJECT_CONFIDENCE
          && !detectedLabels.has(item.label)
        ));
        if (!prediction) continue;
        detectedLabels.add(prediction.label);
        findings.push({
          angle: frame.angle,
          class: prediction.label,
          name: prediction.label,
          label: `${getDetectedGadgetLabel(prediction)} detected by Roboflow`,
          detected: true,
          confidence: prediction.confidence,
          instruction: `Remove the detected item from your exam area and scan again. Confidence: ${Math.round(prediction.confidence * 100)}%.`,
        });
      }
    }

    return { passed: findings.length === 0, findings };
  }

  function loadScanImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to read scan frame."));
      image.src = dataUrl;
    });
  }

  function getSampledScanFrames(images = []) {
    if (images.length <= 4) return images;
    const indexes = new Set([0, Math.floor(images.length / 3), Math.floor(images.length / 2), images.length - 1]);
    return [...indexes].map((index) => images[index]).filter(Boolean);
  }

  function buildGadgetFinding(prediction) {
    const label = normalizeDetectionLabel(prediction.class || prediction.label || prediction.name || "gadget");
    const readableLabel = isPhoneDetectionLabel(label) ? "Phone detected. Please remove it and scan again." : `${label} detected. Please remove it and scan again.`;
    return {
      label: readableLabel,
      detected: true,
      confidence: Number(prediction.score ?? prediction.confidence ?? 0),
      instruction: "Remove extra gadgets from the exam area and scan again.",
    };
  }

  async function detectPhoneInScanFrame(dataUrl, angle) {
    try {
      const roboflowResult = await runDirectRoboflowImageDetection(dataUrlToPayload(dataUrl), ENV_SCAN_PHONE_CONFIDENCE);
      const roboflowPhone = collectRoboflowPredictions(roboflowResult).find((item) => (
        isPhoneDetectionLabel(item.label)
        && item.confidence >= ENV_SCAN_PHONE_CONFIDENCE
      ));

      if (roboflowPhone) {
        return {
          angle,
          class: roboflowPhone.label,
          name: roboflowPhone.label,
          label: "Phone detected by Roboflow. Please remove it and scan again.",
          detected: true,
          confidence: roboflowPhone.confidence,
          instruction: "Phone detected. Remove it from the exam area and scan again.",
        };
      }

      if (!objectDetectorRef.current) {
        objectDetectorRef.current = await cocoSsd.load();
      }

      const image = await loadScanImage(dataUrl);
      const predictions = await objectDetectorRef.current.detect(image);
      const phone = predictions.find((item) => (
        isPhoneDetectionLabel(item.class || item.label || item.name)
        && Number(item.score ?? item.confidence ?? 0) >= ENV_SCAN_PHONE_CONFIDENCE
      ));

      if (!phone) return null;

      return {
        ...buildGadgetFinding(phone),
        angle,
        instruction: "Phone detected. Remove it from the exam area and scan again.",
      };
    } catch (error) {
      window.console.warn("[EnvironmentScan] Phone frame check unavailable.", error);
      return null;
    }
  }

  async function detectEnvironmentGadgets(frames) {
    try {
      if (!objectDetectorRef.current) {
        objectDetectorRef.current = await cocoSsd.load();
      }

      const findings = [];
    for (const step of scanCheckpoints) {
        const sampledFrames = getSampledScanFrames(frames[step.id] || []);
        for (const frame of sampledFrames) {
          const image = await loadScanImage(frame.image || frame);
          const predictions = await objectDetectorRef.current.detect(image);
          const detected = predictions.find((item) => (
            GADGET_LABELS.has(normalizeDetectionLabel(item.class))
            && Number(item.score || 0) >= ENV_SCAN_OBJECT_CONFIDENCE
          ));
          if (detected) {
            findings.push(buildGadgetFinding(detected, step.id));
            break;
          }
        }
      }

      return findings;
    } catch (error) {
      window.console.error("[EnvironmentScan]", error);
      return [];
    }
  }

  function recordManualViolation(type, message, severity = "Medium") {
    const timestamp = new Date().toISOString();
    setViolations((current) => [
      ...current,
      { type, message, severity, timestamp },
    ]);
    if (hasSupabaseConfig && user?.id && exam?.id) {
      void persistViolation({ type, message, severity, timestamp });
    }
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
    try {
      const screenshotPath = await uploadProctorSnapshot(type, timestamp);
      const payload = {
        student_id: user.id,
        exam_id: exam.id,
        professor_id: exam.professor_id || exam.created_by || null,
        course_id: exam.course_id || null,
        violation_type: type,
        description: message || type,
        severity,
        screenshot_url: screenshotPath,
        created_at: timestamp,
      };
      let { error } = await supabase.from("violations").insert(payload);
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
          screenshot_url: screenshotPath,
          created_at: timestamp,
        });
        error = fallback.error;
      }
      if (error) throw error;
    } catch (error) {
      toast.error(`Monitoring alert was not saved: ${error.message}`);
    }
  }

  function stopProctoring() {
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
    objectAlertCooldownRef.current = 0;
    phoneAlertCooldownRef.current = 0;
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
    if (!response.ok) return null;
    const result = await response.json();
    const predictions = result.predictions || result.objects || [];
    return predictions.find((item) => GADGET_LABELS.has(normalizeDetectionLabel(item.class || item.label || item.name)) && Number(item.confidence ?? item.score ?? 1) >= 0.45);
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
      const result = await runDirectRoboflowImageDetection(image);
      return collectRoboflowPredictions(result).find((item) => (
        (ROBOFLOW_GADGET_LABELS.has(item.label) || isPhoneDetectionLabel(item.label))
        && item.confidence >= ROBOFLOW_OBJECT_CONFIDENCE
      )) || null;
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
    if (!response.ok) return null;

    const result = await response.json();
    return (result.findings || []).find((item) => item.detected);
  }

  async function detectWithCocoSsd(video) {
    if (!objectDetectorRef.current) {
      objectDetectorRef.current = await cocoSsd.load();
    }
    const predictions = await objectDetectorRef.current.detect(video);
    return predictions.find((item) => GADGET_LABELS.has(normalizeDetectionLabel(item.class)) && Number(item.score || 0) >= 0.5);
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

  function getDetectedGadgetLabel(item) {
    const rawLabel = normalizeDetectionLabel(item.class || item.label || item.name || item.class_name || "gadget");
    if (isPhoneDetectionLabel(rawLabel)) return "phone";
    if (rawLabel.includes("tablet") || rawLabel.includes("ipad")) return "tablet";
    if (rawLabel.includes("laptop")) return "laptop";
    return rawLabel;
  }

  function handleRoboflowData(data) {
    const predictions = collectRoboflowPredictions(data);
    const detected = predictions.find((item) => (ROBOFLOW_GADGET_LABELS.has(item.label) || isPhoneDetectionLabel(item.label)) && item.confidence >= ROBOFLOW_OBJECT_CONFIDENCE);
    if (!detected) return;

    const isPhone = isPhoneDetectionLabel(detected.label) || detected.label === "tablet" || detected.label === "ipad";
    const cooldownRef = isPhone ? phoneAlertCooldownRef : roboflowAlertCooldownRef;
    if (Date.now() - cooldownRef.current < 8000) return;

    cooldownRef.current = Date.now();
    const message = isPhone
      ? `Phone or tablet detected by Roboflow live camera (${Math.round(detected.confidence * 100)}%).`
      : `Spare gadget detected by Roboflow live camera (${Math.round(detected.confidence * 100)}%).`;
    recordManualViolation(isPhone ? "PHONE_DETECTED" : "GADGET_DETECTED", message, "High");
  }

  async function startRoboflowMonitoring(stream) {
    const config = getRoboflowConfig();
    if (!config) {
      setRoboflowStatus(import.meta.env.VITE_ROBOFLOW_API_KEY || getRoboflowImageScanEndpoint() ? "Roboflow image detector active" : "Roboflow detector off");
      return;
    }

    try {
      setRoboflowStatus("Connecting Roboflow detector");
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
      setRoboflowStatus("Roboflow detector active");
    } catch (error) {
      window.console.error("[RoboflowLive]", error);
      setRoboflowStatus(import.meta.env.VITE_ROBOFLOW_API_KEY || getRoboflowImageScanEndpoint() ? "Roboflow image detector active" : "Roboflow detector unavailable");
    }
  }

  async function detectProctorObjects() {
    const video = proctorVideoRef.current;
    if (!video?.videoWidth) return;

    try {
      let detected = null;
      for (const detector of [detectWithRoboflowImage, detectWithEndpoint, detectWithCocoSsd]) {
        try {
          detected = await detector(video);
        } catch (error) {
          window.console.warn("[ObjectDetection] Detector unavailable.", error);
        }
        if (detected) break;
      }

      if (detected) {
        const label = getDetectedGadgetLabel(detected);
        const isPhone = label === "phone";
        const isTablet = label === "tablet" || label === "ipad";
        const isLaptop = label === "laptop";
        const readableLabel = isPhone ? "Phone" : isTablet ? "Tablet" : isLaptop ? "Laptop" : "Gadget";
        const violationType = isPhone || isTablet ? "PHONE_DETECTED" : "GADGET_DETECTED";
        const cooldownRef = violationType === "PHONE_DETECTED" ? phoneAlertCooldownRef : objectAlertCooldownRef;
        if (Date.now() - cooldownRef.current < 8000) return;

        cooldownRef.current = Date.now();
        recordManualViolation(violationType, `${readableLabel} detected in camera view.`, "High");
      }
    } catch {
      // Keep exam proctoring active even if the optional object detector is unreachable.
    }
  }

  function startObjectMonitoring() {
    void detectProctorObjects();
    objectMonitorRef.current = window.setInterval(() => {
      void detectProctorObjects();
    }, OBJECT_SCAN_INTERVAL_MS);
  }

  async function startProctorCamera() {
    if (!liveCameraMonitoringEnabled && !examSettings.liveAudioMonitoring) {
      stopProctoring();
      setFaceStatus("Live camera monitoring disabled");
      setRoboflowStatus("Roboflow detector off");
      return;
    }

    const stream = await window.navigator.mediaDevices.getUserMedia({
      video: liveCameraMonitoringEnabled ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 } } : false,
      audio: examSettings.liveAudioMonitoring ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      } : false,
    });
    stopProctoring();
    proctorStreamRef.current = stream;
    if (liveCameraMonitoringEnabled) {
      if (proctorVideoRef.current) proctorVideoRef.current.srcObject = stream;
      void startFaceMonitoring();
      startObjectMonitoring();
      void startRoboflowMonitoring(stream);
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

  async function enterExamMode() {
    function startTimerIfNeeded() {
      const start = startedAt || new Date().toISOString();
      setStartedAt(start);
      if (hasTimer && !timerEndsAt) {
        setTimerEndsAt(new Date(new Date(start).getTime() + durationMinutes * 60 * 1000).toISOString());
      }
      if (!hasTimer) setRemainingMs(null);
    }

    try {
      await requestExamLock();
      if (secureModeRequired) {
        await startProctorCamera();
      } else {
        stopProctoring();
      }
      startTimerIfNeeded();
      setExamLocked(false);
      setExamModeReady(true);
      setScanOpen(false);
      toast.success(secureModeRequired ? "Secure exam mode started" : "Exam started in fullscreen");
    } catch (error) {
      setExamModeReady(false);
      setExamLocked(false);
      recordManualViolation("FULLSCREEN_EXIT", error instanceof Error ? error.message : "Secure exam mode failed to start.", "High");
      const errorMessage = error instanceof Error ? error.message : "";
      const message = examSettings.liveAudioMonitoring && /audio|microphone|mic|notallowed|permission|device|mediarecorder/i.test(errorMessage)
        ? "Microphone access is required to continue the exam."
        : "Fullscreen is required before taking the exam. Please use a browser/device that supports fullscreen mode.";
      toast.error(message);
    }
  }

  async function resumeExamMode() {
    if (savedProgress?.answers) setAnswers((current) => ({ ...current, ...savedProgress.answers }));
    if (savedProgress?.violations) setViolations(savedProgress.violations);
    if (savedProgress?.scanStatus === "passed") {
      setScanStatus("passed");
      setScanOpen(false);
    }
    await enterExamMode();
  }

  async function restoreExamLock() {
    try {
      await requestExamLock();
      setExamLocked(false);
    } catch (error) {
      recordManualViolation("FULLSCREEN_EXIT", error instanceof Error ? error.message : "Unable to restore fullscreen.", "High");
      toast.error("Return to fullscreen to continue the exam.");
    }
  }

  async function handleSubmit() {
    if (!scanPassed) {
      toast.error("Complete and pass the environment scan before submitting the exam.");
      setScanOpen(true);
      return;
    }
    if (!hasSupabaseConfig || !user?.id || !exam) return;
    examSubmittingRef.current = true;
    setSubmitting(true);

    try {
      const { count, error: attemptCountError } = await supabase
        .from("exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", exam.id)
        .eq("student_id", user.id);

      if (attemptCountError) throw attemptCountError;
      if ((count || 0) > 0 || (Number.isFinite(attemptLimit) && (count || 0) >= attemptLimit)) {
        setExistingAttemptCount(count || 0);
        toast.error("You have already taken this exam.");
        return;
      }

      const uploadedPaths = {};
      const submissionAnswers = { ...answers };
      for (const question of questions) {
        if (question.question_type === "File Upload" && files[question.id]) {
          uploadedPaths[question.id] = await uploadFile(question.id, files[question.id]);
          submissionAnswers[question.id] = { fileName: files[question.id].name, path: uploadedPaths[question.id] };
        }
      }

      const grading = computeAttemptScore(questions, submissionAnswers);
      const attemptPayload = {
        exam_id: exam.id,
        student_id: user.id,
        score: grading.hasManual ? null : Number(grading.percentage.toFixed(2)),
        violations,
        started_at: startedAt || new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      };

      let attemptResult = await supabase
        .from("exam_attempts")
        .insert(attemptPayload)
        .select("id")
        .single();

      if (attemptResult.error?.message?.includes("started_at")) {
        const fallbackPayload = { ...attemptPayload };
        delete fallbackPayload.started_at;
        delete fallbackPayload.submitted_at;
        attemptResult = await supabase
          .from("exam_attempts")
          .insert(fallbackPayload)
          .select("id")
          .single();
      }

      const attempt = attemptResult.data;
      const attemptError = attemptResult.error;

      if (attemptError) throw attemptError;

      const answerRows = questions.map((question) => {
        const result = grading.results.find((item) => item.questionId === question.id);
        return {
          attempt_id: attempt.id,
          question_id: question.id,
          answer: toJsonAnswer(submissionAnswers[question.id]),
          file_url: uploadedPaths[question.id] || null,
          earned_points: result?.earnedPoints ?? null,
          max_points: result?.maxPoints ?? Number(question.points || 0),
          is_correct: result?.isCorrect || false,
          needs_manual_grading: result?.manual || false,
        };
      });

      let answersResult = await supabase.from("exam_attempt_answers").insert(answerRows);
      if (answersResult.error?.message?.includes("earned_points") || answersResult.error?.message?.includes("max_points")) {
        const fallbackAnswerRows = answerRows.map((row) => {
          const next = { ...row };
          delete next.earned_points;
          delete next.max_points;
          return next;
        });
        answersResult = await supabase.from("exam_attempt_answers").insert(fallbackAnswerRows);
      }

      if (answersResult.error) {
        await supabase.from("exam_attempts").delete().eq("id", attempt.id);
        throw answersResult.error;
      }

      toast.success(grading.hasManual ? "Exam submitted for manual grading" : "Exam submitted and graded");
      examSubmittedRef.current = true;
      clearSavedExamProgress(user.id, examId);
      stopProctoring();
      await exitFullscreen();
      navigate("/student/grades");
    } catch (error) {
      toast.error(error.message);
    } finally {
      if (!examSubmittedRef.current) examSubmittingRef.current = false;
      setSubmitting(false);
    }
  }

  function renderQuestion(question, index) {
    const config = getQuestionConfig(question);
    const choices = question.choices || config.choices || [];
    const pairs = config.pairs || [];
    const orderItems = answers[question.id] || config.orderItems || [];
    const rightOptions = pairs.map((pair) => pair.right).sort();
    const matchingAnswers = answers[question.id] || {};
    const selectedLeft = selectedMatchingLeft[question.id] || "";
    const matchingRowCount = Math.max(pairs.length, rightOptions.length, 1);
    const matchingLines = pairs.map((pair, leftIndex) => {
      const rightIndex = rightOptions.indexOf(matchingAnswers[pair.left]);
      if (rightIndex < 0) return null;
      return {
        key: `${pair.left}-${matchingAnswers[pair.left]}`,
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
            <img alt="Question reference" src={config.questionImage} />
          </div>
        ) : null}

        {question.question_type === "Multiple Choice" || question.question_type === "Picture Choice" ? choices.map((choice) => (
          <label className="student-answer-option" key={choice.key}>
            <input checked={answers[question.id] === choice.key} onChange={() => setAnswer(question.id, choice.key)} type="radio" />
            <span>{choice.key}. {choice.value}</span>
          </label>
        )) : null}

        {question.question_type === "Multiple Select" ? choices.map((choice) => (
          <label className="student-answer-option" key={choice.key}>
            <input checked={(answers[question.id] || []).includes(choice.key)} onChange={() => toggleMultiAnswer(question.id, choice.key)} type="checkbox" />
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
                  className={`student-matching-choice ${selectedLeft === pair.left ? "selected" : ""} ${matchingAnswers[pair.left] ? "matched" : ""}`}
                  key={pair.left}
                  onClick={() => selectMatchingLeft(question.id, pair.left)}
                  type="button"
                >
                  {pair.left}
                </button>
              ))}
            </div>
            <div className="student-matching-column right">
              {rightOptions.map((option) => {
                const matchedLeft = Object.entries(matchingAnswers).find(([, value]) => value === option)?.[0];
                return (
                  <button
                    className={`student-matching-choice ${matchedLeft ? "matched" : ""}`}
                    disabled={!selectedLeft && !matchedLeft}
                    key={option}
                    onClick={() => connectMatchingAnswer(question.id, option)}
                    type="button"
                  >
                    {option}
                  </button>
                );
              })}
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
          </div>
        )) : null}

        {question.question_type === "File Upload" ? (
          <label className="student-file-answer">
            <FiUpload />
            <span>{files[question.id]?.name || "Upload PDF, DOCX, DOC, JPG, or PNG up to 10MB"}</span>
            <input accept={FILE_UPLOAD_ACCEPT} onChange={(event) => setFiles((current) => ({ ...current, [question.id]: event.target.files?.[0] }))} type="file" />
          </label>
        ) : null}
      </Card>
    );
  }

  if (!hasSupabaseConfig) return <PageHeader title="Exam" subtitle="Live Supabase exam taking is required." />;
  if (!exam) return <main className="center-screen">Loading exam...</main>;

  if (attemptsExhausted) {
    return (
      <section className="student-exam-take-page">
        <PageHeader
          title={exam.exam_title || exam.title}
          subtitle="You have already taken this exam."
          actions={<Button onClick={() => navigate("/student")}>Back to Dashboard</Button>}
        />
        <Card className="student-exam-question">
          <div className="student-card-title">
            <div>
              <h2>Exam already taken</h2>
              <p>Your submitted attempt is already recorded. Retakes are not allowed.</p>
            </div>
          </div>
        </Card>
      </section>
    );
  }

  if (!scanPassed || scanOpen) {
    const currentStep = scanCheckpoints[scanStepIndex] || scanCheckpoints[0];
    const currentStepProgress = Math.min(100, scanProgress.surroundings || 0);
    const centerProgress = scanProgress.center || 0;
    const leftSweepProgress = scanProgress.left || 0;
    const rightSweepProgress = scanProgress.right || 0;

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
              <h2>{scanStatus === "passed" ? "Scan Passed" : currentStep.title}</h2>
              <p>{scanStatus === "passed" ? "Your environment scan is complete. You can proceed to the exam." : scanStatus === "scanning" ? `Scanning... ${Math.round(currentStepProgress)}%` : currentStep.instruction}</p>
            </div>
            <span>{scanStatus === "scanning" ? `${currentStep.title}` : scanStatus === "analyzing" ? "Checking" : "Required"}</span>
          </div>

          {cameraError ? <div className="student-scan-alert danger"><FiXCircle /> {cameraError}</div> : null}
          {scanStatus === "failed" ? (
            <div className="student-scan-alert danger">
              <FiXCircle />
              <div>
                <strong>{scanFindings.some((finding) => finding.detected) ? "Environment Check Failed" : "Environment scan needs to be repeated."}</strong>
                <p>{scanFindings[0]?.instruction || (scanFindings.some((finding) => finding.detected) ? "Remove all unauthorized devices and perform the scan again." : "Please show the left, center, and right side of your environment.")}</p>
                {scanFindings.length ? (
                  <ul>
                    {scanFindings.map((finding, index) => <li key={`${finding.label}-${index}`}>{finding.label || "Suspicious item"}{finding.confidence ? ` - ${Math.round(finding.confidence * 100)}%` : ""}</li>)}
                  </ul>
                ) : null}
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

          {scanStatus === "scanning" ? (
            <div className="student-scan-progress">
              <span style={{ width: `${currentStepProgress}%` }} />
            </div>
          ) : null}

          {scanStatus === "scanning" ? (
            <div className="student-scan-meter">
              <div>
                <strong>Surroundings coverage</strong>
                <span>{Math.round(currentStepProgress)}%</span>
              </div>
              <div>
                <span style={{ width: `${currentStepProgress}%` }} />
              </div>
              <small>Center {centerProgress}% - Left {leftSweepProgress}% - Right {rightSweepProgress}%</small>
              <small>{scanSensorStatus}</small>
              <small>
                {(scanMotion.surroundings || 0) >= MIN_UNIQUE_SCENE_DISTANCE
                  ? scanSensorStatus
                  : "Progress pauses when the camera is still, repeated, blurry, or pointed at the same area."}
              </small>
            </div>
          ) : null}

          <div className="student-scan-steps">
            <span className={scanProgress.center ? "done" : scanStatus === "scanning" && scanStepIndex === 0 ? "active" : ""}>
              1. Face camera and show your surroundings.
              <small>{centerProgress}% captured</small>
            </span>
            {scanCheckpoints.slice(1).map((step, index) => (
              <span className={(scanProgress[step.id] || 0) >= 100 ? "done" : index + 1 === scanStepIndex && scanStatus === "scanning" ? "active" : ""} key={step.id}>
                {index + 2}. {step.title}
                <small>{Math.round(scanProgress[step.id] || 0)}% captured</small>
              </span>
            ))}
            <span className={scanStatus === "analyzing" || scanStatus === "passed" ? "active" : ""}>
              4. Keep the tab active until scan completes.
            </span>
          </div>

          <div className="student-scan-actions">
            {scanStatus === "idle" || scanStatus === "failed" ? <Button onClick={startEnvironmentScan}><FiCamera /> Start Live Scan</Button> : null}
            {scanStatus === "scanning" ? <Button disabled><FiCamera /> Keep Scanning...</Button> : null}
            {scanStatus === "analyzing" ? <Button disabled><FiRefreshCw /> Analyzing...</Button> : null}
            {scanStatus === "passed" ? <Button onClick={enterExamMode}><FiCheckCircle /> {secureModeRequired ? "Continue to Secure Exam" : "Start Exam"}</Button> : null}
          </div>
        </Card>
      </section>
    );
  }

  if (!examModeReady) {
    return (
      <section className="student-exam-start-page">
        <div className="student-exam-start-panel">
          <h1>{exam.exam_title || exam.title}</h1>
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
            {savedProgress ? <Button disabled={!scanPassed || attemptsExhausted} onClick={resumeExamMode}>Resume Exam</Button> : null}
            <Button disabled={!scanPassed || attemptsExhausted} onClick={enterExamMode}>Start Exam</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`student-exam-take-page ${proctoringEnabled ? "with-proctor-dock" : ""}`}>
      <PageHeader
        title={exam.exam_title || exam.title}
        subtitle={`${exam.courses?.course_code || ""} ${exam.courses?.section || ""} - ${formatDurationLabel(exam.time_limit || exam.duration)} - ${totalPoints} points`}
        actions={<Button disabled={submitting || !scanPassed || examLocked || attemptsExhausted} onClick={handleSubmit}>{submitting ? "Submitting..." : "Submit Exam"}</Button>}
      />

      {proctoringEnabled ? (
        <aside className="student-proctor-dock" aria-label="Live proctoring panel">
          <section className="student-proctor-camera-card">
            <div className="student-proctor-title">
              {liveCameraMonitoringEnabled ? <FiCamera /> : <FiMic />}
              <div>
                <strong>{liveCameraMonitoringEnabled ? "Live Camera" : "Live Audio"}</strong>
                <span>{liveCameraMonitoringEnabled ? "Roboflow detection active" : "Audio monitoring only"}</span>
              </div>
            </div>
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
                <div className="student-face-status">
                  <FiShield />
                  <span>{faceStatus}</span>
                </div>
                <div className="student-face-status">
                  <FiCamera />
                  <span>{roboflowStatus}</span>
                </div>
              </>
            ) : null}
            <div className={`student-exam-timer ${hasTimer && remainingMs !== null && remainingMs <= 60000 ? "urgent" : ""}`}>
              <FiClock />
              <div>
                <span>Time Remaining</span>
                <strong>{hasTimer ? formatRemainingTime(remainingMs ?? (timerEndsAt ? new Date(timerEndsAt).getTime() - Date.now() : durationMinutes * 60 * 1000)) : "No timer"}</strong>
              </div>
            </div>
            {examSettings.liveAudioMonitoring ? (
              <AudioMonitoringTimeline
                level={audioMonitoring.audioLevel}
                micStatus={audioMonitoring.micStatus}
                status={audioMonitoring.audioStatus}
                timeline={audioMonitoring.timeline}
              />
            ) : null}
          </section>

          <section className="student-proctor-alert-card">
            <div className="student-proctor-alert-heading">
              <strong>Live Alerts</strong>
              <span>{violations.length}</span>
            </div>
            <div className="student-proctor-alert-list">
              {violations.length ? violations.slice(-5).reverse().map((violation, index) => (
                <article key={`${violation.timestamp}-${index}`}>
                  <strong>{violation.message}</strong>
                  <span>{violation.severity} - {new Date(violation.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </article>
              )) : <p>No alerts yet.</p>}
            </div>
          </section>
        </aside>
      ) : null}

      {examLocked ? (
        <div className="student-exam-lock-overlay" role="alert">
          <Card>
            <FiShield />
            <h2>Exam Paused</h2>
            <p>Fullscreen was exited or the exam window lost focus. Return to secure exam mode to continue.</p>
            <Button onClick={restoreExamLock}>Return to Fullscreen</Button>
          </Card>
        </div>
      ) : null}

      <div className="student-exam-question-list">
        {questions.map(renderQuestion)}
      </div>
    </section>
  );
}
