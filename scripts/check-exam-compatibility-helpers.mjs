import assert from "node:assert/strict";
import {
  buildExamCompatibilityResult,
  getRequiredExamCapabilities,
  normalizeBrowserCapabilities,
} from "../src/lib/examCompatibility.js";

const supportedEnvironment = normalizeBrowserCapabilities({
  document: { hidden: false },
  mediaDevices: { getUserMedia() {} },
  fullscreenElement: null,
  requestFullscreen() {},
  exitFullscreen() {},
  MediaRecorder: function MediaRecorder() {},
  AudioContext: function AudioContext() {},
  File: function File() {},
  FileReader: function FileReader() {},
  Blob: function Blob() {},
});

assert.deepEqual(getRequiredExamCapabilities({
  settings: { liveCameraMonitoring: false, liveAudioMonitoring: false, requireEnvironmentScan: false },
  questions: [],
}).map((capability) => capability.id), ["fullscreen", "visibility"]);

assert.deepEqual(getRequiredExamCapabilities({
  settings: { liveCameraMonitoring: true, liveAudioMonitoring: true, requireEnvironmentScan: true },
  questions: [{ question_type: "File Upload" }],
}).map((capability) => capability.id), ["fullscreen", "visibility", "camera", "microphone", "audioRecording", "audioContext", "fileApi"]);

assert.equal(buildExamCompatibilityResult({
  settings: { liveCameraMonitoring: true, liveAudioMonitoring: true, requireEnvironmentScan: true },
  questions: [{ question_type: "File Upload" }],
  capabilities: supportedEnvironment,
}).supported, true);

{
  const result = buildExamCompatibilityResult({
    settings: { liveCameraMonitoring: true, liveAudioMonitoring: false, requireEnvironmentScan: false },
    questions: [],
    capabilities: { ...supportedEnvironment, hasMediaDevices: false, hasGetUserMedia: false },
  });
  assert.equal(result.supported, false);
  assert.deepEqual(result.missing.map((item) => item.id), ["camera"]);
  assert.match(result.message, /cannot meet the monitoring requirements/i);
}

{
  const result = buildExamCompatibilityResult({
    settings: { liveCameraMonitoring: false, liveAudioMonitoring: true, requireEnvironmentScan: false },
    questions: [],
    capabilities: { ...supportedEnvironment, hasMediaRecorder: false, hasAudioContext: false },
  });
  assert.equal(result.supported, false);
  assert.deepEqual(result.missing.map((item) => item.id), ["audioRecording", "audioContext"]);
}

{
  const result = buildExamCompatibilityResult({
    settings: { liveCameraMonitoring: false, liveAudioMonitoring: false, requireEnvironmentScan: false },
    questions: [],
    capabilities: { ...supportedEnvironment, hasMediaDevices: false, hasGetUserMedia: false, hasMediaRecorder: false, hasAudioContext: false },
  });
  assert.equal(result.supported, true);
  assert.deepEqual(result.missing, []);
}

{
  const result = buildExamCompatibilityResult({
    settings: { liveCameraMonitoring: false, liveAudioMonitoring: false, requireEnvironmentScan: false },
    questions: [],
    capabilities: { ...supportedEnvironment, hasFullscreen: false },
  });
  assert.equal(result.supported, false);
  assert.deepEqual(result.missing.map((item) => item.id), ["fullscreen"]);
}

{
  const result = buildExamCompatibilityResult({
    settings: { liveCameraMonitoring: false, liveAudioMonitoring: false, requireEnvironmentScan: false },
    questions: [{ question_type: "file upload" }],
    capabilities: { ...supportedEnvironment, hasFileApi: false },
  });
  assert.equal(result.supported, false);
  assert.deepEqual(result.missing.map((item) => item.id), ["fileApi"]);
}
