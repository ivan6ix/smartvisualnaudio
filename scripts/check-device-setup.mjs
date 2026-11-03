/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEVICE_PREFERENCE_KEY,
  cameraConstraints,
  groupDevices,
  loadDeviceChoice,
  microphoneConstraints,
  microphoneLevel,
  resolveChoice,
  saveDeviceChoice,
  setupReady,
} from "../src/lib/mediaDevices.js";

// The choice is remembered on this computer; bad or missing storage never breaks the exam.
{
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.deepEqual(loadDeviceChoice(storage), { cameraId: "", microphoneId: "", speakerId: "" });
  saveDeviceChoice(storage, { cameraId: "cam-2", microphoneId: "mic-1" });
  assert.deepEqual(loadDeviceChoice(storage), { cameraId: "cam-2", microphoneId: "mic-1", speakerId: "" });
  store.set(DEVICE_PREFERENCE_KEY, "{not json");
  assert.deepEqual(loadDeviceChoice(storage), { cameraId: "", microphoneId: "", speakerId: "" });
  assert.deepEqual(loadDeviceChoice({ getItem: () => { throw new Error("blocked"); } }), { cameraId: "", microphoneId: "", speakerId: "" });
  saveDeviceChoice({ setItem: () => { throw new Error("blocked"); } }, { cameraId: "x" });
}

// Device lists by kind, with names before permission is given and no duplicate "communications" entry.
{
  const groups = groupDevices([
    { kind: "videoinput", deviceId: "cam-1", label: "" },
    { kind: "videoinput", deviceId: "cam-2", label: "USB Webcam" },
    { kind: "audioinput", deviceId: "communications", label: "Communications - Mic" },
    { kind: "audioinput", deviceId: "mic-1", label: "Headset Mic" },
    { kind: "audiooutput", deviceId: "spk-1", label: "Speakers" },
    { kind: "videoinput", deviceId: "cam-2", label: "USB Webcam" },
  ]);
  assert.deepEqual(groups.cameras, [{ id: "cam-1", label: "Camera 1" }, { id: "cam-2", label: "USB Webcam" }]);
  assert.deepEqual(groups.microphones, [{ id: "mic-1", label: "Headset Mic" }]);
  assert.deepEqual(resolveChoice({ cameraId: "cam-2", microphoneId: "gone", speakerId: "" }, groups), { cameraId: "cam-2", microphoneId: "mic-1", speakerId: "spk-1" }, "An unplugged device falls back to the first one.");
}

// Constraints: the chosen device is preferred (exact only for the setup preview), the front camera otherwise.
{
  const size = { width: { ideal: 640 } };
  assert.deepEqual(cameraConstraints("", size), { width: { ideal: 640 }, facingMode: "user" });
  assert.deepEqual(cameraConstraints("cam-2", size), { width: { ideal: 640 }, deviceId: { ideal: "cam-2" } });
  assert.deepEqual(cameraConstraints("cam-2", size, { exact: true }), { width: { ideal: 640 }, deviceId: { exact: "cam-2" } });
  assert.deepEqual(microphoneConstraints("mic-1", { autoGainControl: true }), { autoGainControl: true, deviceId: { ideal: "mic-1" } });
  assert.deepEqual(microphoneConstraints("", { autoGainControl: true }), { autoGainControl: true });
}

// Level meter and the continue rule.
assert.equal(microphoneLevel(new Uint8Array(512).fill(128)), 0, "Silence reads 0.");
assert.ok(microphoneLevel(Uint8Array.from({ length: 512 }, (_, index) => (index % 2 ? 160 : 96))) > 50, "A loud signal reads high.");
assert.equal(setupReady({ cameraWorks: true, microphoneWorks: false, microphoneRequired: false }), true);
assert.equal(setupReady({ cameraWorks: true, microphoneWorks: false, microphoneRequired: true }), false, "An audio-monitored exam needs a working microphone.");
assert.equal(setupReady({ cameraWorks: false, microphoneWorks: true, microphoneRequired: false }), false, "A working camera is always needed.");

// The exam page shows the setup step before the scan and uses the choice for the scan, monitoring and recovery.
const exam = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(exam, /if \(!deviceSetupDone && scanStatus !== "scanning" && scanStatus !== "passed"\)[\s\S]*?<DeviceSetup/);
assert.match(exam, /microphoneRequired=\{Boolean\(examSettings\.liveAudioMonitoring\)\}/);
assert.match(exam, /cameraConstraints\(deviceChoiceRef\.current\.cameraId, scanSize\)/, "The scan uses the chosen camera.");
assert.match(exam, /video: liveCameraMonitoringEnabled \? cameraConstraints\(deviceChoiceRef\.current\.cameraId/, "Exam monitoring uses the chosen camera.");
assert.match(exam, /audio: examSettings\.liveAudioMonitoring \? microphoneConstraints\(deviceChoiceRef\.current\.microphoneId/, "Exam monitoring uses the chosen microphone.");
assert.equal((exam.match(/microphoneConstraints\(deviceChoiceRef\.current\.microphoneId/g) || []).length, 2, "Microphone recovery during the exam uses the chosen microphone too.");
assert.match(exam, /Change devices/);

const setup = readFileSync("src/components/student/DeviceSetup.jsx", "utf8");
assert.match(setup, /saveDeviceChoice\(window\.localStorage, choice\);\s+stopDevices\(\);\s+onContinue\(choice\);/, "Continuing saves the choice and releases the camera and microphone for the scan.");
assert.match(setup, /addEventListener\?\.\("devicechange"/, "Plugging in a device refreshes the lists.");
assert.match(setup, /audio\.setSinkId\(choice\.speakerId\)/, "The test sound plays on the chosen speaker where supported.");

console.log("Device setup checks passed.");
