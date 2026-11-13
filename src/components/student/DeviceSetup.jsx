import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiMic, FiRefreshCw, FiSliders, FiVideo, FiVolume2 } from "react-icons/fi";
import { Button } from "../ui";
import {
  MIC_SOUND_LEVEL,
  cameraConstraints,
  groupDevices,
  loadDeviceChoice,
  microphoneConstraints,
  microphoneLevel,
  resolveChoice,
  saveDeviceChoice,
  setupReady,
} from "../../lib/mediaDevices";

const PREVIEW_SIZE = { width: { ideal: 640 }, height: { ideal: 360 } };

function deviceError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera or microphone access was blocked. Allow access in your browser's address bar, then press Try again.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "No camera or microphone was found. Plug one in, then press Refresh devices.";
  if (error?.name === "NotReadableError") return "Another app is using your camera or microphone. Close it, then press Try again.";
  return "Your camera or microphone could not start. Press Try again.";
}

// A short 660 Hz beep as a WAV file, so the test sound can play through the chosen speaker.
function beepUrl() {
  const rate = 22050;
  const samples = Math.round(rate * 0.6);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 400, (samples - index) / 400);
    view.setInt16(44 + index * 2, Math.sin((2 * Math.PI * 660 * index) / rate) * 0.4 * fade * 32767, true);
  }
  return window.URL.createObjectURL(new window.Blob([buffer], { type: "audio/wav" }));
}

// Step before the environment scan: pick and test the camera, microphone and speaker. The choice is remembered on
// this computer and used by the scan and by exam monitoring.
export default function DeviceSetup({ microphoneRequired, onContinue }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const frameRef = useRef(0);
  // Bumped whenever the devices are stopped, so a camera request still pending when the step closes (or when another
  // device is picked) stops its stream instead of leaving the camera and microphone on in the background.
  const openIdRef = useRef(0);
  const [choice, setChoice] = useState(() => loadDeviceChoice(window.localStorage));
  const [devices, setDevices] = useState({ cameras: [], microphones: [], speakers: [] });
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [cameraWorks, setCameraWorks] = useState(false);
  const [microphoneWorks, setMicrophoneWorks] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [heardSound, setHeardSound] = useState(false);
  const [soundNote, setSoundNote] = useState("");
  const speakerChoiceSupported = typeof window.HTMLMediaElement !== "undefined" && "setSinkId" in window.HTMLMediaElement.prototype;

  const stopDevices = useCallback(() => {
    openIdRef.current += 1;
    window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const refreshDeviceList = useCallback(async () => {
    const list = groupDevices(await window.navigator.mediaDevices.enumerateDevices());
    setDevices(list);
    return list;
  }, []);

  const openDevices = useCallback(async (wanted) => {
    stopDevices();
    const openId = openIdRef.current;
    setStatus("starting");
    setError("");
    setCameraWorks(false);
    setMicrophoneWorks(false);
    setMicrophoneMuted(false);
    setHeardSound(false);
    setLevel(0);
    const request = (ids) => window.navigator.mediaDevices.getUserMedia({
      video: cameraConstraints(ids.cameraId, PREVIEW_SIZE, { exact: Boolean(ids.cameraId) }),
      audio: microphoneConstraints(ids.microphoneId, { echoCancellation: false, noiseSuppression: false, autoGainControl: true }, { exact: Boolean(ids.microphoneId) }),
    });
    try {
      let stream;
      try {
        stream = await request(wanted);
      } catch (firstError) {
        // A remembered device that was unplugged: fall back to the browser's default devices.
        if (!["OverconstrainedError", "NotFoundError"].includes(firstError?.name) || (!wanted.cameraId && !wanted.microphoneId)) throw firstError;
        stream = await request({ cameraId: "", microphoneId: "" });
      }
      if (openIdRef.current !== openId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => setCameraWorks(Boolean(videoTrack && videoTrack.readyState === "live"));
        void videoRef.current.play().catch(() => {});
      }
      const audioUsable = Boolean(audioTrack && audioTrack.readyState === "live" && audioTrack.enabled && !audioTrack.muted);
      setMicrophoneWorks(audioUsable);
      setMicrophoneMuted(Boolean(audioTrack?.muted));
      if (audioTrack) {
        audioTrack.onmute = () => {
          setMicrophoneWorks(false);
          setMicrophoneMuted(true);
        };
        audioTrack.onunmute = () => {
          setMicrophoneWorks(true);
          setMicrophoneMuted(false);
        };
        const context = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(new window.MediaStream([audioTrack])).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          const next = microphoneLevel(samples);
          setLevel(next);
          if (next >= MIC_SOUND_LEVEL) setHeardSound(true);
          frameRef.current = window.requestAnimationFrame(tick);
        };
        tick();
      }
      // Device names are only available once access is allowed, so the list is read after opening.
      const list = await refreshDeviceList();
      setChoice((current) => resolveChoice({
        ...current,
        cameraId: videoTrack?.getSettings?.().deviceId || wanted.cameraId,
        microphoneId: audioTrack?.getSettings?.().deviceId || wanted.microphoneId,
      }, list));
      setStatus("ready");
    } catch (openError) {
      if (openIdRef.current !== openId) return;
      window.console.error("[DeviceSetup]", openError);
      setStatus("error");
      setError(deviceError(openError));
      void refreshDeviceList().catch(() => {});
    }
  }, [refreshDeviceList, stopDevices]);

  useEffect(() => {
    void openDevices(loadDeviceChoice(window.localStorage));
    const onDeviceChange = () => void refreshDeviceList().catch(() => {});
    window.navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      window.navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      stopDevices();
    };
  }, [openDevices, refreshDeviceList, stopDevices]);

  function pickDevice(changes) {
    const next = { ...choice, ...changes };
    setChoice(next);
    if ("cameraId" in changes || "microphoneId" in changes) void openDevices(next);
  }

  async function playTestSound() {
    setSoundNote("");
    const url = beepUrl();
    const audio = new window.Audio(url);
    try {
      if (speakerChoiceSupported && choice.speakerId) await audio.setSinkId(choice.speakerId);
      await audio.play();
      setSoundNote("Did you hear a beep? If not, check your volume or pick another speaker.");
    } catch {
      setSoundNote("The test sound could not play. Check your volume and speaker.");
    } finally {
      audio.onended = () => window.URL.revokeObjectURL(url);
    }
  }

  function continueToScan() {
    saveDeviceChoice(window.localStorage, choice);
    stopDevices();
    onContinue(choice);
  }

  const ready = setupReady({ cameraWorks, microphoneWorks, microphoneRequired });
  const microphoneMessage = !microphoneWorks
    ? microphoneMuted ? "Your microphone is muted. Unmute it (check any mute switch or key)." : "No working microphone found."
    : heardSound ? "Sound detected." : "Say something: the bar should move.";

  return (
    <div className="device-setup">
      <div className="device-setup-heading">
        <FiSliders aria-hidden="true" />
        <div>
          <h2>Set up your camera and microphone</h2>
          <p>Choose the devices to use for the environment scan and during the exam.{microphoneRequired ? " This exam listens through your microphone." : ""}</p>
        </div>
      </div>

      {error ? <div className="student-scan-alert danger" role="alert"><FiAlertTriangle /> {error}</div> : null}

      <div className="device-setup-grid">
        <div className="device-setup-camera">
          <label className="field">
            <span><FiVideo aria-hidden="true" /> Camera</span>
            <select disabled={status === "starting"} onChange={(event) => pickDevice({ cameraId: event.target.value })} value={choice.cameraId}>
              {devices.cameras.length ? devices.cameras.map((device) => <option key={device.id} value={device.id}>{device.label}</option>) : <option value="">No camera found</option>}
            </select>
          </label>
          <div className="device-setup-preview">
            <video autoPlay muted playsInline ref={videoRef} />
            {!cameraWorks ? <span>{status === "starting" ? "Starting camera..." : "No camera picture"}</span> : null}
          </div>
          <p className={cameraWorks ? "device-setup-ok" : "device-setup-warn"} aria-live="polite">
            {cameraWorks ? <><FiCheckCircle aria-hidden="true" /> Camera works.</> : status === "starting" ? "Checking your camera..." : "Your camera is not showing a picture."}
          </p>
        </div>

        <div className="device-setup-side">
          <div>
            <label className="field">
              <span><FiMic aria-hidden="true" /> Microphone</span>
              <select disabled={status === "starting"} onChange={(event) => pickDevice({ microphoneId: event.target.value })} value={choice.microphoneId}>
                {devices.microphones.length ? devices.microphones.map((device) => <option key={device.id} value={device.id}>{device.label}</option>) : <option value="">No microphone found</option>}
              </select>
            </label>
            <div aria-label={`Microphone level ${level}%`} className="device-setup-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
              <span style={{ width: `${level}%` }} />
            </div>
            <p className={microphoneWorks ? "device-setup-ok" : microphoneRequired ? "device-setup-warn" : "device-setup-note"} aria-live="polite">
              {microphoneWorks ? <FiCheckCircle aria-hidden="true" /> : null} {microphoneMessage}
            </p>
          </div>

          <div>
            {speakerChoiceSupported && devices.speakers.length ? (
              <label className="field">
                <span><FiVolume2 aria-hidden="true" /> Speaker (optional)</span>
                <select onChange={(event) => pickDevice({ speakerId: event.target.value })} value={choice.speakerId}>
                  {devices.speakers.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
                </select>
              </label>
            ) : <p className="device-setup-label"><FiVolume2 aria-hidden="true" /> Speaker (optional)</p>}
            <Button onClick={playTestSound} type="button" variant="light"><FiVolume2 /> Play test sound</Button>
            {soundNote ? <p className="device-setup-note">{soundNote}</p> : null}
          </div>
        </div>
      </div>

      <div className="student-scan-actions">
        <Button disabled={status === "starting"} onClick={() => void openDevices(choice)} type="button" variant="light">
          <FiRefreshCw /> {status === "error" ? "Try again" : "Refresh devices"}
        </Button>
        <Button disabled={!ready} onClick={continueToScan} type="button">
          Continue to environment scan <FiArrowRight />
        </Button>
      </div>
      {!ready && status === "ready" ? (
        <p className="device-setup-note">{!cameraWorks ? "A working camera is needed for the scan and the exam." : "This exam needs a working microphone."}</p>
      ) : null}
    </div>
  );
}
