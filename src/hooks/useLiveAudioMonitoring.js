import { useCallback, useEffect, useRef, useState } from "react";
import { uploadAudioViolation } from "../services/audioViolationService";

const QUIET_THRESHOLD = 8;
const MODERATE_THRESHOLD = 18;
const LOUD_THRESHOLD = 50;
const LOUD_DURATION_MS = 3000;
const LOUD_GRACE_MS = 1000;
const LOUD_NOISE_COOLDOWN_MS = 0;
const AUDIO_LEVEL_GAIN = 16;
const AUDIO_EVIDENCE_MS = 10000;
const MIN_AUDIO_EVIDENCE_BYTES = 2048;
const DIGITAL_SILENCE_RMS = 0.00001;
const DIGITAL_SILENCE_BLOCK_MS = 45000;

function getRecorderOptions() {
  if (!window.MediaRecorder) return {};
  if (window.MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")) return { mimeType: "audio/webm;codecs=opus" };
  if (window.MediaRecorder.isTypeSupported?.("audio/webm")) return { mimeType: "audio/webm" };
  return {};
}

function classifyAudio(level) {
  if (level <= QUIET_THRESHOLD) return "Quiet";
  if (level <= MODERATE_THRESHOLD) return "Normal";
  if (level <= LOUD_THRESHOLD) return "Moderate Noise";
  return "Loud Noise";
}

export function useLiveAudioMonitoring({ enabled, exam, student, onViolation, canRecordViolation, onMicrophoneIssue, onMicrophoneRestored }) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioStatus, setAudioStatus] = useState("Quiet");
  const [micStatus, setMicStatus] = useState("Inactive");
  const [timeline, setTimeline] = useState([]);
  const audioContextRef = useRef(null);
  const audioMonitorRef = useRef(null);
  const audioStreamRef = useRef(null);
  const lastTimelineAtRef = useRef(0);
  const lastStatusRef = useRef("Quiet");
  const loudStartedAtRef = useRef(null);
  const loudLastAtRef = useRef(null);
  const loudPeakRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const handlingViolationRef = useRef(false);
  const loudIncidentRecordedRef = useRef(false);
  const quietSinceRef = useRef(null);
  const activeRef = useRef(false);
  const evidenceRecordersRef = useRef(new Set());
  const violationCallbacksRef = useRef({ onViolation, canRecordViolation });
  violationCallbacksRef.current = { onViolation, canRecordViolation };
  const digitalSilenceStartedAtRef = useRef(null);
  const digitalSilenceReportedRef = useRef(false);
  const microphoneCallbacksRef = useRef({ onMicrophoneIssue, onMicrophoneRestored });

  useEffect(() => {
    microphoneCallbacksRef.current = { onMicrophoneIssue, onMicrophoneRestored };
  }, [onMicrophoneIssue, onMicrophoneRestored]);

  const addTimelineItem = useCallback((status, level, message = status, force = false) => {
    const now = Date.now();
    if (!force && status === lastStatusRef.current && now - lastTimelineAtRef.current < 5000) return;
    lastStatusRef.current = status;
    lastTimelineAtRef.current = now;
    setTimeline((current) => [
      ...current.slice(-20),
      { id: `${now}-${status}`, time: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), status, level, message },
    ]);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    for (const recorder of evidenceRecordersRef.current) {
      if (recorder.state === "recording") recorder.stop();
    }
    if (audioMonitorRef.current) {
      window.cancelAnimationFrame(audioMonitorRef.current);
      audioMonitorRef.current = null;
    }
    audioStreamRef.current = null;
    audioContextRef.current?.close?.();
    audioContextRef.current = null;
    loudStartedAtRef.current = null;
    loudLastAtRef.current = null;
    loudPeakRef.current = 0;
    digitalSilenceStartedAtRef.current = null;
    digitalSilenceReportedRef.current = false;
    setMicStatus("Inactive");
    setAudioLevel(0);
    setAudioStatus("Quiet");
  }, []);

  const captureAudioEvidenceBlob = useCallback(() => new Promise((resolve) => {
    if (!window.MediaRecorder || !audioStreamRef.current?.getAudioTracks?.().length) {
      resolve(null);
      return;
    }

    const chunks = [];
    let recorder = null;
    let timeout = null;
    const finish = () => {
      if (recorder?.state === "recording") recorder.stop();
    };

    try {
      recorder = new window.MediaRecorder(audioStreamRef.current, getRecorderOptions());
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        evidenceRecordersRef.current.delete(recorder);
        window.clearTimeout(timeout);
        resolve(chunks.length ? new window.Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : null);
      };
      recorder.onerror = () => {
        evidenceRecordersRef.current.delete(recorder);
        window.clearTimeout(timeout);
        resolve(null);
      };
      recorder.start();
      evidenceRecordersRef.current.add(recorder);
      timeout = window.setTimeout(finish, AUDIO_EVIDENCE_MS);
    } catch (error) {
      window.console.error("[AudioMonitoring]", error);
      resolve(null);
    }
  }), []);

  const handleLoudViolation = useCallback(async (level) => {
    if (!activeRef.current || loudIncidentRecordedRef.current || handlingViolationRef.current || Date.now() < cooldownUntilRef.current || violationCallbacksRef.current.canRecordViolation?.() === false) return;
    loudIncidentRecordedRef.current = true;
    const triggeredAt = new Date().toISOString();
    handlingViolationRef.current = true;
    cooldownUntilRef.current = Date.now() + LOUD_NOISE_COOLDOWN_MS;
    addTimelineItem("Loud Noise Detected", level, "Audio reached 50% for 3 seconds. Recording the next 10 seconds for the professor.", true);
    try {
      const audioBlob = (async () => {
        let captured = await captureAudioEvidenceBlob();
        if (activeRef.current && (!captured?.size || captured.size < MIN_AUDIO_EVIDENCE_BYTES)) captured = await captureAudioEvidenceBlob();
        return captured;
      })();
      await uploadAudioViolation({
        audioBlob,
        audioLevel: level,
        courseId: exam?.course_id,
        exam,
        professorId: exam?.professor_id || exam?.created_by,
        studentId: student?.id,
        triggeredAt,
        onRecorded: ({ violationId }) => violationCallbacksRef.current.onViolation?.({
          id: violationId, examId: exam.id, type: "AUDIO_DETECTED", severity: "Medium", timestamp: triggeredAt,
          message: "Audio reached 50% for 3 seconds. Audio evidence recorded for the professor.",
        }),
      });
      addTimelineItem("Loud Noise Detected", level, "Audio violation recorded. The professor can review the 10-second clip.", true);
    } catch (error) {
      window.console.error("[AudioMonitoring]", error);
      addTimelineItem("Loud Noise Detected", level, "Loud noise detected, but audio evidence upload failed.", true);
    } finally {
      loudStartedAtRef.current = null;
      loudLastAtRef.current = null;
      loudPeakRef.current = 0;
      handlingViolationRef.current = false;
    }
  }, [addTimelineItem, captureAudioEvidenceBlob, exam, student]);

  const start = useCallback((stream) => {
    if (!enabled || !stream?.getAudioTracks?.().length) return;
    stop();
    activeRef.current = true;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Microphone access is required to continue the exam.");

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    audioContextRef.current = context;
    void context.resume?.();
    setMicStatus("Active");

    audioStreamRef.current = new window.MediaStream(stream.getAudioTracks());

    function monitorAudio() {
      if (!activeRef.current) return;
      analyser.getByteTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => {
        const normalized = (value - 128) / 128;
        return sum + (normalized * normalized);
      }, 0) / samples.length);
      const level = Math.min(100, Math.round(rms * 160 * AUDIO_LEVEL_GAIN));

      if (rms <= DIGITAL_SILENCE_RMS) {
        digitalSilenceStartedAtRef.current ??= Date.now();
        if (!digitalSilenceReportedRef.current && Date.now() - digitalSilenceStartedAtRef.current >= DIGITAL_SILENCE_BLOCK_MS) {
          digitalSilenceReportedRef.current = true;
          microphoneCallbacksRef.current.onMicrophoneIssue?.("No audio input signal has been received for an extended period.", "MICROPHONE_MUTED");
        }
      } else {
        digitalSilenceStartedAtRef.current = null;
        if (digitalSilenceReportedRef.current) {
          digitalSilenceReportedRef.current = false;
          microphoneCallbacksRef.current.onMicrophoneRestored?.();
        }
      }
      const status = classifyAudio(level);
      setAudioLevel(level);
      setAudioStatus(status);
      addTimelineItem(status, level);

      const now = Date.now();
      if (level >= LOUD_THRESHOLD) {
        quietSinceRef.current = null;
        loudStartedAtRef.current ??= now;
        loudLastAtRef.current = now;
        loudPeakRef.current = Math.max(loudPeakRef.current, level);
      } else {
        quietSinceRef.current ??= now;
        if (now - quietSinceRef.current > LOUD_GRACE_MS) {
          loudIncidentRecordedRef.current = false;
          loudStartedAtRef.current = null;
          loudLastAtRef.current = null;
          loudPeakRef.current = 0;
        }
      }

      if (loudStartedAtRef.current && now - loudStartedAtRef.current >= LOUD_DURATION_MS) {
        void handleLoudViolation(loudPeakRef.current || level);
      }

      if (activeRef.current) audioMonitorRef.current = window.requestAnimationFrame(monitorAudio);
    }

    monitorAudio();
  }, [addTimelineItem, enabled, handleLoudViolation, stop]);

  useEffect(() => stop, [stop]);

  return { audioLevel, audioStatus, micStatus, start, stop, timeline };
}
