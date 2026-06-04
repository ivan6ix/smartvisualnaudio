import { FiMic } from "react-icons/fi";

export default function AudioMonitoringTimeline({ level, micStatus, status, timeline }) {
  return (
    <div className="student-audio-monitoring-card">
      <div className="student-proctor-title">
        <FiMic />
        <div>
          <strong>Audio Monitoring</strong>
          <span>Microphone status: {micStatus}</span>
        </div>
      </div>
      <div className="student-audio-meter">
        <div>
          <span>{status}</span>
          <strong>{level}%</strong>
        </div>
        <div><span style={{ width: `${level}%` }} /></div>
      </div>
      <div className="student-audio-timeline">
        {timeline.length ? timeline.slice(-6).reverse().map((item) => (
          <article key={item.id}>
            <span>{item.time}</span>
            <strong>{item.status}</strong>
            <em>{item.level}</em>
          </article>
        )) : <p>No audio activity yet.</p>}
      </div>
    </div>
  );
}
