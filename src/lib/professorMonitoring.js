const AUDIO_VIOLATION_TYPES = new Set(["AUDIO_DETECTED", "LOUD_AUDIO", "LOUD_NOISE_DETECTED", "BACKGROUND_VOICE"]);

export const MONITORING_INITIAL_VIOLATION_LIMIT = 100;
export const MONITORING_SELECTED_STUDENT_LIMIT = 100;

function isAudioPath(value) {
  return Boolean(value?.startsWith?.("data:audio/") || value?.endsWith?.(".webm"));
}

export function getViolationEvidenceState(violation = {}) {
  const audioPath = isAudioPath(violation.evidence_url)
    ? violation.evidence_url
    : isAudioPath(violation.screenshot_url)
      ? violation.screenshot_url
      : "";

  return {
    audioPath,
    hasAudioEvidence: Boolean(audioPath) || violation.evidence_type?.startsWith?.("audio") || AUDIO_VIOLATION_TYPES.has(violation.violation_type),
    hasScreenshotEvidence: Boolean(violation.screenshot_url && !isAudioPath(violation.screenshot_url)),
  };
}

export function shouldRequestLazyEvidence(violation = {}) {
  return Boolean(
    !violation.evidenceLoading
    && (
      (violation.hasAudioEvidence && !violation.audioUrl)
      || (violation.hasScreenshotEvidence && !violation.screenshotUrl)
    ),
  );
}
