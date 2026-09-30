export const VIOLATION_ALERT_DURATION_MS = 3000;
export const MAX_VIOLATION_ALERTS = 4;

const violationLabels = {
  copy_paste: "Copy / Paste",
  face_missing: "Face Missing",
  multiple_faces: "Multiple Faces",
  no_face: "No Face Detected",
  tab_switch: "Tab Switch",
  fullscreen_exit: "Fullscreen Exit",
  phone_detected: "Phone Detected",
  person_missing: "Person Missing",
  extra_person: "Extra Person",
  gaze_away: "Looking Away",
  excessive_noise: "Excessive Noise",
  prohibited_object: "Prohibited Object",
};

export function formatViolationType(type) {
  if (!type) return "Monitoring Alert";
  if (violationLabels[type]) return violationLabels[type];
  return String(type)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Monitoring Alert";
}

export function playViolationAlertSound(windowRef = typeof window === "undefined" ? undefined : window) {
  const AudioContext = windowRef?.AudioContext || windowRef?.webkitAudioContext;
  if (!AudioContext) return false;
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.24);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.25);
    oscillator.addEventListener("ended", () => audioContext.close?.());
    return true;
  } catch {
    return false;
  }
}
