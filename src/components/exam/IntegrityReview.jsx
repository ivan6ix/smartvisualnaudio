import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FAST_HIGH_SCORE, HIGH_RISK_FROM, MEDIUM_RISK_FROM, RISK_RULES } from "../../lib/integrityRisk";
import { getListPageSlice } from "../../lib/listView";
import { ListPagination } from "../ListViewControls";

const LEVEL_TONE = { High: "danger", Medium: "warn", Low: "neutral" };
// The review queue shows 5 attempts per page.
const PAGE_SIZE = 5;

function formatScore(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? "-" : `${Math.round(number)}%`;
}

// rows: buildRiskQueue rows plus studentName, studentDetail, examTitle and an optional reviewHref.
// filtered: the page filters the rows itself (including the risk level), so the queue's own level picker is hidden.
export default function IntegrityReview({ rows, summary, showExam = false, basis = "", filtered = false, emptyMessage = "No submitted attempts or monitoring alerts yet." }) {
  const [level, setLevel] = useState("All");
  const [page, setPage] = useState(1);
  const visible = useMemo(() => (filtered ? rows : rows.filter((row) => level === "All" || row.level === level)), [filtered, level, rows]);
  const queuePage = getListPageSlice(visible, page, PAGE_SIZE);
  const tallestType = Math.max(1, ...summary.byType.map((row) => row.count));
  const tallestSlot = Math.max(1, ...summary.timeline.map((slot) => slot.count));

  if (!rows.length && !summary.attemptCount && !summary.violationCount) {
    return <div className="professor-analytics-empty">{emptyMessage}</div>;
  }

  return (
    <div className="professor-analytics integrity-review">
      <p className="professor-analytics-basis">
        The risk score only orders attempts for review. A person decides every case after checking the evidence.{basis ? ` ${basis}` : ""}
      </p>

      <div className="professor-analytics-kpis">
        <div><span>Attempts</span><strong>{summary.attemptCount}</strong><small>Submitted and graded</small></div>
        <div><span>High risk</span><strong>{summary.high}</strong><small>Score {HIGH_RISK_FROM} or more</small></div>
        <div><span>Medium risk</span><strong>{summary.medium}</strong><small>Score {MEDIUM_RISK_FROM}–{HIGH_RISK_FROM - 1}</small></div>
        <div><span>Alerts per attempt</span><strong>{summary.violationsPerAttempt === null ? "-" : summary.violationsPerAttempt.toFixed(1)}</strong><small>{summary.violationCount} alerts in total</small></div>
        <div><span>Clean attempts</span><strong>{summary.cleanAttempts}</strong><small>No alerts at all</small></div>
      </div>

      <section className="professor-analytics-card">
        <header>
          <h3>Review queue — highest risk first</h3>
          {filtered ? null : <label className="integrity-review-filter">
            <span>Risk level</span>
            <select onChange={(event) => { setLevel(event.target.value); setPage(1); }} value={level}>
              {["All", "High", "Medium", "Low"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>}
        </header>
        <div className="professor-score-table-wrap">
          <table className="professor-score-table compact integrity-review-table">
            <thead>
              <tr>
                <th>Student</th>
                {showExam ? <th>Exam</th> : null}
                <th>Risk</th>
                <th>Main reasons</th>
                <th>Score</th>
                <th><span className="sr-only">Review</span></th>
              </tr>
            </thead>
            <tbody>
              {queuePage.rows.map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.studentName}</strong><small>{row.studentDetail}</small></td>
                  {showExam ? <td>{row.examTitle}</td> : null}
                  <td>
                    <div className="integrity-review-risk">
                      <span className={`integrity-review-bar is-${row.level.toLowerCase()}`}><span style={{ width: `${row.score}%` }} /></span>
                      <strong>{row.score}</strong>
                      <span className={`badge badge-${LEVEL_TONE[row.level]} professor-score-status-badge`}>{row.level}</span>
                    </div>
                  </td>
                  <td>
                    {row.reasons.length ? (
                      <div className="integrity-review-reasons">
                        {row.reasons.map((reason) => (
                          <span key={reason.label}>{reason.label}{reason.count > 1 ? ` ×${reason.count}` : ""}</span>
                        ))}
                      </div>
                    ) : <span className="professor-analytics-muted">No alerts</span>}
                  </td>
                  <td>{row.attempt ? formatScore(row.attempt.score) : "Not submitted"}</td>
                  <td>{row.reviewHref ? <Link className="professor-analytics-link integrity-review-open" to={row.reviewHref}>Open attempt</Link> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? <p className="professor-analytics-muted">{filtered ? "No attempts match these filters." : "No attempts at this risk level."}</p> : null}
        <ListPagination count={visible.length} page={queuePage.page} pageSize={PAGE_SIZE} onPage={setPage} />
      </section>

      <div className="professor-analytics-row">
        <section className="professor-analytics-card">
          <header><h3>Alerts by type</h3></header>
          {summary.byType.length ? (
            <div className="integrity-review-types">
              {summary.byType.map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <span className="integrity-review-bar is-type"><span style={{ width: `${(row.count / tallestType) * 100}%` }} /></span>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </div>
          ) : <p className="professor-analytics-muted">No alerts recorded.</p>}
        </section>

        <section className="professor-analytics-card integrity-review-timeline-card">
          <header>
            <h3>When alerts happen</h3>
            <span>{summary.timelineUnit === "minutes" ? "Minutes since each student started" : "Share of each student's exam time"}</span>
          </header>
          <div className="professor-analytics-histogram integrity-review-timeline" role="img" aria-label={`Alerts over exam time: ${summary.timeline.map((slot) => `${slot.label} ${slot.count}`).join(", ")}`}>
            {summary.timeline.map((slot) => (
              <div className="professor-analytics-bin" key={slot.label}>
                <span>{slot.count || ""}</span>
                <div style={{ height: `${(slot.count / tallestSlot) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="professor-analytics-bin-labels integrity-review-timeline-labels" aria-hidden="true">
            {summary.timeline.map((slot) => <span key={slot.label}>{slot.label}</span>)}
          </div>
        </section>

        <section className="professor-analytics-card">
          <header><h3>How the risk score works</h3></header>
          <ul className="integrity-review-rules">
            {RISK_RULES.map((rule) => (
              <li key={rule.id}><span>{rule.label}</span><strong>{rule.points} each, max {rule.cap}</strong></li>
            ))}
            <li><span>{FAST_HIGH_SCORE.label}</span><strong>{FAST_HIGH_SCORE.points}</strong></li>
          </ul>
          <p className="professor-analytics-muted">Low below {MEDIUM_RISK_FROM} · Medium {MEDIUM_RISK_FROM}–{HIGH_RISK_FROM - 1} · High {HIGH_RISK_FROM} and up. Total capped at 100.</p>
        </section>
      </div>
    </div>
  );
}
