export const VIOLATION_ALERT_DURATION_MS = 8000;
export const MAX_VIOLATION_ALERTS = 3;

// Violation pop-ups: only the newest `max` show; older ones are counted for the "+N more violations" line.
export function addViolationAlert(stack, alert, max = MAX_VIOLATION_ALERTS) {
  const alerts = [...(stack?.alerts || []), alert];
  const overflow = Math.max(0, alerts.length - max);
  return { alerts: alerts.slice(overflow), hiddenCount: (stack?.hiddenCount || 0) + overflow };
}

// Closing the last visible pop-up also clears the "+N more" count.
export function removeViolationAlert(stack, id) {
  const alerts = (stack?.alerts || []).filter((alert) => alert.id !== id);
  return { alerts, hiddenCount: alerts.length ? stack?.hiddenCount || 0 : 0 };
}

export function describeViolationPlace({ examTitle, courseCode, section } = {}) {
  return [examTitle || "Exam", courseCode, section ? `Section ${section}` : ""].filter(Boolean).join(" · ");
}

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
  notes_detected: "Notes or Papers Detected",
};

export function formatViolationType(type) {
  if (!type) return "Monitoring Alert";
  const known = violationLabels[String(type).toLowerCase()];
  if (known) return known;
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
