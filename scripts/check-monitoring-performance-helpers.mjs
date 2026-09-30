import assert from "node:assert/strict";
import {
  MONITORING_INITIAL_VIOLATION_LIMIT,
  MONITORING_SELECTED_STUDENT_LIMIT,
  getViolationEvidenceState,
  shouldRequestLazyEvidence,
} from "../src/lib/professorMonitoring.js";

assert.equal(MONITORING_INITIAL_VIOLATION_LIMIT, 100);
assert.equal(MONITORING_SELECTED_STUDENT_LIMIT, 100);

assert.deepEqual(getViolationEvidenceState({ screenshot_url: "snapshot.png", evidence_url: null, evidence_type: null, violation_type: "NO_FACE" }), {
  audioPath: "",
  hasAudioEvidence: false,
  hasScreenshotEvidence: true,
});

assert.deepEqual(getViolationEvidenceState({ screenshot_url: "voice.webm", evidence_url: null, evidence_type: null, violation_type: "NO_FACE" }), {
  audioPath: "voice.webm",
  hasAudioEvidence: true,
  hasScreenshotEvidence: false,
});

assert.deepEqual(getViolationEvidenceState({ screenshot_url: null, evidence_url: null, evidence_type: null, violation_type: "LOUD_AUDIO" }), {
  audioPath: "",
  hasAudioEvidence: true,
  hasScreenshotEvidence: false,
});

assert.equal(shouldRequestLazyEvidence({ hasAudioEvidence: true, audioUrl: "", evidenceLoading: false }), true);
assert.equal(shouldRequestLazyEvidence({ hasAudioEvidence: true, audioUrl: "signed", evidenceLoading: false }), false);
assert.equal(shouldRequestLazyEvidence({ hasAudioEvidence: false, screenshotUrl: "", evidenceLoading: false }), false);
