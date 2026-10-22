// Microphone health policy for live audio monitoring.
//
// Violations come only from signals the browser reports reliably: no audio track, an ended track,
// a disabled track, a track the browser marks muted (no frames delivered), or revoked permission.
// Silence never counts. 8-bit analyser samples cannot tell a quiet room from a dead input (one step
// is ~-42 dBFS, louder than a quiet room's noise floor), and even exact digital silence from float
// samples is ambiguous: an OS-level or hardware mute switch and a noise-gated headset both deliver
// zeros while the track stays "live" and unmuted, and no browser API distinguishes them. A noise
// gate or virtual microphone (Krisp, NVIDIA Broadcast) also outputs exact zeros in a normal quiet
// room. Exact digital silence therefore never pauses the exam or records a violation: after 15 s it
// shows a non-blocking notice, once per silent stretch.

export const DIGITAL_SILENCE_RMS = 0.00001;
export const DIGITAL_SILENCE_NOTICE_MS = 15000;
export const MICROPHONE_VIOLATION_CONFIRM_MS = 3000;

// RMS of one analyser frame. Byte samples are centred on 128.
export function measureRms(samples, { byteSamples = false } = {}) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = byteSamples ? (samples[index] - 128) / 128 : samples[index];
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

// Tracks continuous exact digital silence and returns "notice" once at noticeMs. Only precise
// (float) measurements can notice; any sound starts a new stretch.
export function createSilenceTracker({ noticeMs = DIGITAL_SILENCE_NOTICE_MS } = {}) {
  let silentSince = null;
  let noticed = false;
  const reset = () => {
    silentSince = null;
    noticed = false;
  };
  return {
    observe({ rms, precise, now }) {
      if (!precise || rms > DIGITAL_SILENCE_RMS) {
        reset();
        return null;
      }
      silentSince ??= now;
      if (!noticed && now - silentSince >= noticeMs) {
        noticed = true;
        return "notice";
      }
      return null;
    },
    reset,
  };
}

// Browser-reported microphone failures, in order of precedence. Returns null when healthy.
export function classifyMicrophoneState({ track, permissionState } = {}) {
  if (permissionState === "denied") return { type: "MICROPHONE_ACCESS_LOST", reason: "Microphone permission was lost." };
  if (!track) return { type: "MICROPHONE_UNAVAILABLE", reason: "No microphone audio track is available." };
  if (track.readyState !== "live") return { type: "MICROPHONE_DISCONNECTED", reason: "The microphone track ended or became unavailable." };
  if (!track.enabled) return { type: "MICROPHONE_MUTED", reason: "The microphone track was disabled." };
  if (track.muted) return { type: "MICROPHONE_MUTED", reason: "The browser reports the microphone is muted or delivering no audio." };
  return null;
}

// Permission revocation: "denied", or a change from "granted" back to "prompt" (Chrome's
// "reset permission"/"ask" also ends the track). An initial "prompt" is not revocation: Firefox
// reports "prompt" for a one-time grant while the microphone works.
export function isMicrophonePermissionRevoked(previousState, currentState) {
  return currentState === "denied" || (previousState === "granted" && currentState === "prompt");
}

// One interruption = from the first reported failure until the microphone is restored. It is
// recorded at most once, and only if it persists for confirmMs, so a momentary browser mute or
// device glitch pauses the exam but is not a violation.
export function createMicrophoneInterruptionGate({ confirmMs = MICROPHONE_VIOLATION_CONFIRM_MS } = {}) {
  let active = null;
  return {
    report(issue, now) {
      const started = !active;
      if (started) active = { ...issue, since: now, recorded: false };
      return started;
    },
    due(now) {
      if (!active || active.recorded || now - active.since < confirmMs) return null;
      active.recorded = true;
      return { type: active.type, reason: active.reason };
    },
    restore() {
      active = null;
    },
    isActive() {
      return Boolean(active);
    },
  };
}
