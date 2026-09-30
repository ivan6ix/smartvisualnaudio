const CAPABILITIES = {
  fullscreen: {
    id: "fullscreen",
    label: "Fullscreen is unavailable",
    description: "Fullscreen mode is required before taking this exam.",
  },
  visibility: {
    id: "visibility",
    label: "Page visibility monitoring is unavailable",
    description: "The browser must report when the exam tab is hidden.",
  },
  camera: {
    id: "camera",
    label: "Camera access is required",
    description: "This exam requires camera access for environment scan or live monitoring.",
  },
  microphone: {
    id: "microphone",
    label: "Microphone access is required",
    description: "This exam requires microphone input for audio monitoring.",
  },
  audioRecording: {
    id: "audioRecording",
    label: "Microphone recording is unavailable",
    description: "This browser cannot record microphone evidence required by this exam.",
  },
  audioContext: {
    id: "audioContext",
    label: "Audio monitoring is unavailable",
    description: "This browser cannot analyze microphone levels required by this exam.",
  },
  fileApi: {
    id: "fileApi",
    label: "File upload support is unavailable",
    description: "This exam includes a file upload question.",
  },
};

function hasFileUploadQuestion(questions = []) {
  return questions.some((question) => String(question?.question_type || question?.type || "").toLowerCase() === "file upload");
}

export function normalizeBrowserCapabilities(source = globalThis) {
  const documentRef = source.document || source;
  const navigatorRef = source.navigator || source;
  const mediaDevices = navigatorRef.mediaDevices || source.mediaDevices;
  const element = documentRef.documentElement || source;
  const requestFullscreen = element?.requestFullscreen
    || element?.webkitRequestFullscreen
    || element?.webkitEnterFullscreen
    || element?.mozRequestFullScreen
    || element?.msRequestFullscreen
    || source.requestFullscreen;
  const exitFullscreen = documentRef.exitFullscreen
    || documentRef.webkitExitFullscreen
    || documentRef.mozCancelFullScreen
    || documentRef.msExitFullscreen
    || source.exitFullscreen;

  return {
    hasFullscreen: Boolean(requestFullscreen && exitFullscreen),
    hasVisibility: "hidden" in documentRef || "visibilityState" in documentRef,
    hasMediaDevices: Boolean(mediaDevices),
    hasGetUserMedia: typeof mediaDevices?.getUserMedia === "function",
    hasMediaRecorder: typeof source.MediaRecorder === "function",
    hasAudioContext: typeof source.AudioContext === "function" || typeof source.webkitAudioContext === "function",
    hasFileApi: typeof source.File === "function" && typeof source.FileReader === "function" && typeof source.Blob === "function",
  };
}

export function getRequiredExamCapabilities({ settings = {}, questions = [] } = {}) {
  const requiresCamera = Boolean(settings.requireEnvironmentScan || settings.liveCameraMonitoring);
  const requiresAudio = Boolean(settings.liveAudioMonitoring);
  const required = [CAPABILITIES.fullscreen, CAPABILITIES.visibility];

  if (requiresCamera) required.push(CAPABILITIES.camera);
  if (requiresAudio) {
    required.push(CAPABILITIES.microphone, CAPABILITIES.audioRecording, CAPABILITIES.audioContext);
  }
  if (hasFileUploadQuestion(questions)) required.push(CAPABILITIES.fileApi);

  return required;
}

export function buildExamCompatibilityResult({ settings = {}, questions = [], capabilities = normalizeBrowserCapabilities() } = {}) {
  const required = getRequiredExamCapabilities({ settings, questions });
  const missing = required.filter((capability) => {
    if (capability.id === "fullscreen") return !capabilities.hasFullscreen;
    if (capability.id === "visibility") return !capabilities.hasVisibility;
    if (capability.id === "camera") return !capabilities.hasMediaDevices || !capabilities.hasGetUserMedia;
    if (capability.id === "microphone") return !capabilities.hasMediaDevices || !capabilities.hasGetUserMedia;
    if (capability.id === "audioRecording") return !capabilities.hasMediaRecorder;
    if (capability.id === "audioContext") return !capabilities.hasAudioContext;
    if (capability.id === "fileApi") return !capabilities.hasFileApi;
    return false;
  });

  return {
    supported: missing.length === 0,
    required,
    missing,
    message: missing.length
      ? "This browser or device cannot meet the monitoring requirements for this exam."
      : "This browser supports the requirements configured for this exam.",
  };
}
