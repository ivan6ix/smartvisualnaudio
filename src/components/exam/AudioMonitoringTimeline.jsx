import { FiMic } from "react-icons/fi";

export default function AudioMonitoringTimeline({ level, micStatus, status, timeline }) {
  return (
    <div className="student-audio-monitoring-card">
      <div className="student-audio-meter" title={`Microphone status: ${micStatus}`}>
        <FiMic aria-hidden="true" />
        <span>{status}</span>
        <div><span style={{ width: `${level}%` }} /></div>
        <strong>{level}%</strong>
      </div>
      <details className="student-audio-history">
        <summary>Audio history</summary>
        <div className="student-audio-timeline">
          {timeline.length ? timeline.slice(-6).reverse().map((item) => (
            <article key={item.id}>
              <span>{item.time}</span>
              <strong>{item.status}</strong>
              <em>{item.level}</em>
            </article>
          )) : <p>No audio activity yet.</p>}
        </div>
      </details>
    </div>
  );
}
