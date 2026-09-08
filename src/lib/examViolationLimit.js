export const EXAM_VIOLATION_LIMIT = 5;

export function violationKey(event) {
  const type = event.type === "BACKGROUND_VOICE" ? "AUDIO_DETECTED" : event.type;
  return `${type}:${new Date(event.timestamp).getTime()}`;
}

export function mergeAttemptViolations(events, startedAt) {
  const start = new Date(startedAt).getTime();
  const unique = new Map();
  for (const event of events) {
    const timestamp = new Date(event.timestamp).getTime();
    if (event.type === "AUTO_SUBMISSION" || !Number.isFinite(timestamp) || timestamp < start) continue;
    unique.set(violationKey(event), event);
  }
  return [...unique.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function violationWarning(count) {
  if (count >= EXAM_VIOLATION_LIMIT) return "Maximum violation limit reached. Your exam is being submitted automatically.";
  if (count === 4) return "Final warning: 4 of 5 violations recorded. One more violation will automatically submit your exam.";
  if (count === 3) return "Warning: 3 of 5 violations recorded.";
  return `Violation detected. ${count} of 5 violations recorded.`;
}

// Latches continuous incidents until their detector reports a clear condition.
export function createIncidentTracker() {
  const active = new Set();
  let lastCopyAt = -Infinity;
  return {
    claim(type, now = Date.now()) {
      if (type === "COPY_ATTEMPT") {
        if (now - lastCopyAt < 1500) return false;
        lastCopyAt = now;
        return true;
      }
      if (active.has(type)) return false;
      active.add(type);
      return true;
    },
    clear(type) { active.delete(type); },
  };
}

export function hasProvidedAnswer(answer) {
  if (answer == null) return false;
  if (typeof answer === "string") return Boolean(answer.trim());
  if (Array.isArray(answer)) return answer.some(hasProvidedAnswer);
  if (typeof answer === "object") return Object.values(answer).some(hasProvidedAnswer);
  return true;
}
