// Camera, microphone and speaker choices from the device setup step before the environment scan. The same choice is
// used by the scan and by exam monitoring, and is remembered on this computer for the next exam. Pure helpers, so
// check scripts can run them.

export const DEVICE_PREFERENCE_KEY = "smartproctor.exam.devices";
// Above this level (0-100) the microphone is hearing something, not just silence.
export const MIC_SOUND_LEVEL = 6;

export const EMPTY_DEVICE_CHOICE = { cameraId: "", microphoneId: "", speakerId: "" };

export function loadDeviceChoice(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(DEVICE_PREFERENCE_KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...EMPTY_DEVICE_CHOICE };
    return {
      cameraId: typeof saved.cameraId === "string" ? saved.cameraId : "",
      microphoneId: typeof saved.microphoneId === "string" ? saved.microphoneId : "",
      speakerId: typeof saved.speakerId === "string" ? saved.speakerId : "",
    };
  } catch {
    return { ...EMPTY_DEVICE_CHOICE };
  }
}

export function saveDeviceChoice(storage, choice) {
  try {
    storage?.setItem(DEVICE_PREFERENCE_KEY, JSON.stringify({ ...EMPTY_DEVICE_CHOICE, ...choice }));
  } catch {
    // Private windows can refuse storage; the choice still applies to this exam.
  }
}

// The browser's device list split by kind. Devices without a label (before permission) get a numbered name.
export function groupDevices(devices = []) {
  const groups = { cameras: [], microphones: [], speakers: [] };
  const kinds = { videoinput: ["cameras", "Camera"], audioinput: ["microphones", "Microphone"], audiooutput: ["speakers", "Speaker"] };
  for (const device of devices) {
    const kind = kinds[device?.kind];
    if (!kind || !device.deviceId || device.deviceId === "communications") continue;
    const list = groups[kind[0]];
    if (list.some((item) => item.id === device.deviceId)) continue;
    list.push({ id: device.deviceId, label: device.label || `${kind[1]} ${list.length + 1}` });
  }
  return groups;
}

// A saved device that is no longer plugged in falls back to the first one available.
export function resolveChoice(choice, groups) {
  const pick = (id, list) => (list.some((item) => item.id === id) ? id : list[0]?.id || "");
  return {
    cameraId: pick(choice.cameraId, groups.cameras),
    microphoneId: pick(choice.microphoneId, groups.microphones),
    speakerId: pick(choice.speakerId, groups.speakers),
  };
}

// getUserMedia video constraints for the chosen camera. `ideal` keeps the exam working (on another camera) if the
// chosen one was unplugged; the setup preview asks for the exact device.
export function cameraConstraints(cameraId, size, { exact = false } = {}) {
  return { ...size, ...(cameraId ? { deviceId: exact ? { exact: cameraId } : { ideal: cameraId } } : { facingMode: "user" }) };
}

export function microphoneConstraints(microphoneId, extra = {}, { exact = false } = {}) {
  return { ...extra, ...(microphoneId ? { deviceId: exact ? { exact: microphoneId } : { ideal: microphoneId } } : {}) };
}

// Microphone level 0-100 from an analyser's time-domain bytes (128 is silence).
export function microphoneLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (const sample of samples) {
    const value = (sample - 128) / 128;
    sum += value * value;
  }
  return Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 300));
}

// The student may continue once the camera shows video, and the microphone works when the exam listens to it.
export function setupReady({ cameraWorks, microphoneWorks, microphoneRequired }) {
  return Boolean(cameraWorks && (!microphoneRequired || microphoneWorks));
}
