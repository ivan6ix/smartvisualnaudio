import { useMemo, useState } from "react";
import {
  ACCEPTABLE_KR20,
  GROUP_SHARE,
  MIN_ATTEMPTS_FOR_FLAGS,
  TOO_EASY_P,
  TOO_HARD_P,
  WEAK_D,
  analyzeExam,
} from "../../lib/itemAnalysis";

const FLAG_TONE = { Good: "success", Weak: "warn", "Too easy": "warn", "Too hard": "warn", Revise: "danger", "Need more attempts": "neutral" };

// Rounds half up (0.975 -> "0.98"); toFixed alone rounds some halves down because of binary floating point.
function number(value, digits = 1) {
  if (value === null || value === undefined) return "-";
  const factor = 10 ** digits;
  return (Math.round((Number(value) + Number.EPSILON) * factor) / factor).toFixed(digits);
}

function percent(value, digits = 0) {
  return value === null || value === undefined ? "-" : `${number(value * 100, digits)}%`;
}

function shortText(value, limit = 90) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function reliabilityLabel(value) {
  if (value === null) return "Needs at least 2 questions and varied scores";
  if (value >= 0.8) return "Good consistency";
  if (value >= ACCEPTABLE_KR20) return "Acceptable for a classroom exam";
  return "Low: some questions may not measure the same skill";
}

export default function ExamAnalytics({ questions, attempts, answers, passingScore }) {
  const analysis = useMemo(() => analyzeExam({ questions, attempts, answers, passingScore }), [answers, attempts, passingScore, questions]);
  const [selectedId, setSelectedId] = useState("");
  const { summary, items, quality } = analysis;
  const selected = items.find((item) => item.id === selectedId)
    || items.find((item) => item.keyOutdrawn || item.flag === "Revise")
    || items.find((item) => item.options.length)
    || null;
  const tallest = Math.max(1, ...summary.bins.map((bin) => bin.count));
  const analysed = items.length;

  if (!analysis.attemptCount) {
    return <div className="professor-analytics-empty">No graded attempts yet. Analytics appear once students submit and all manual answers are graded.</div>;
  }

  return (
    <div className="professor-analytics">
      <p className="professor-analytics-basis">
        Based on {analysis.attemptCount} student{analysis.attemptCount === 1 ? "" : "s"}&apos; final graded attempts, {analysed} auto-graded question{analysed === 1 ? "" : "s"}, passing score {passingScore}%.
        {analysis.attemptCount < MIN_ATTEMPTS_FOR_FLAGS ? ` Question flags need at least ${MIN_ATTEMPTS_FOR_FLAGS} attempts.` : ""}
      </p>

      <div className="professor-analytics-kpis">
        <div><span>Average score</span><strong>{number(summary.mean)}%</strong><small>Median {number(summary.median)}%</small></div>
        <div><span>Pass rate</span><strong>{percent(summary.passRate)}</strong><small>{summary.passed} of {summary.count} passed</small></div>
        <div><span>Highest / lowest</span><strong>{number(summary.highest, 0)} / {number(summary.lowest, 0)}</strong><small>Score in %</small></div>
        <div><span>Average time</span><strong>{summary.averageMinutes === null ? "-" : `${Math.round(summary.averageMinutes)} min`}</strong><small>From start to submit</small></div>
        <div><span>Reliability (KR-20)</span><strong>{number(analysis.kr20, 2)}</strong><small>{reliabilityLabel(analysis.kr20)}</small></div>
      </div>

      <div className="professor-analytics-row">
        <section className="professor-analytics-card professor-analytics-wide">
          <header><h3>Score distribution</h3><span>Dashed line: passing score ({passingScore}%)</span></header>
          <div className="professor-analytics-histogram" role="img" aria-label={`Score distribution: ${summary.bins.map((bin) => `${bin.label}% ${bin.count} students`).join(", ")}`}>
            {summary.bins.map((bin) => (
              <div className="professor-analytics-bin" key={bin.label}>
                <span>{bin.count || ""}</span>
                <div className={bin.from + 10 <= passingScore ? "is-below" : ""} style={{ height: `${(bin.count / tallest) * 100}%` }} />
              </div>
            ))}
            <div className="professor-analytics-pass-line" style={{ left: `${Math.min(100, passingScore)}%` }} aria-hidden="true" />
          </div>
          <div className="professor-analytics-bin-labels" aria-hidden="true">
            {summary.bins.map((bin) => <span key={bin.label}>{bin.label}</span>)}
          </div>
        </section>

        <section className="professor-analytics-card">
          <header><h3>Question quality</h3></header>
          {analysed ? (
            <>
              <div className="professor-analytics-stack" aria-hidden="true">
                <span className="is-good" style={{ width: `${(quality.good / analysed) * 100}%` }} />
                <span className="is-review" style={{ width: `${(quality.review / analysed) * 100}%` }} />
                <span className="is-revise" style={{ width: `${(quality.revise / analysed) * 100}%` }} />
                <span className="is-pending" style={{ width: `${(quality.pending / analysed) * 100}%` }} />
              </div>
              <ul className="professor-analytics-legend">
                <li><span className="is-good" />Good<strong>{quality.good}</strong></li>
                <li><span className="is-review" />Review: too easy, too hard or weak<strong>{quality.review}</strong></li>
                <li><span className="is-revise" />Revise: negative discrimination<strong>{quality.revise}</strong></li>
                {quality.pending ? <li><span className="is-pending" />Need more attempts<strong>{quality.pending}</strong></li> : null}
              </ul>
            </>
          ) : <p className="professor-analytics-muted">This exam has no auto-graded questions to analyse.</p>}
        </section>
      </div>

      {analysed ? (
        <section className="professor-analytics-card">
          <header>
            <h3>Item analysis</h3>
            <span>Difficulty p = share correct · Discrimination D = top {Math.round(GROUP_SHARE * 100)}% minus bottom {Math.round(GROUP_SHARE * 100)}% (groups of {analysis.groupSize})</span>
          </header>
          <div className="professor-score-table-wrap">
            <table className="professor-score-table compact professor-analytics-table">
              <thead>
                <tr><th>#</th><th>Question</th><th>Difficulty (p)</th><th>Discrimination (D)</th><th>Result</th><th><span className="sr-only">Choices</span></th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr className={selected?.id === item.id ? "is-selected" : ""} key={item.id}>
                    <td>{item.number}</td>
                    <td title={item.text}>{shortText(item.text)}<small>{item.type}</small></td>
                    <td>
                      <div className="professor-analytics-meter">
                        <span><span style={{ width: `${(item.p ?? 0) * 100}%` }} /></span>
                        <strong>{number(item.p, 2)}</strong>
                      </div>
                    </td>
                    <td className={item.d !== null && item.d < 0 ? "is-negative" : ""}>{number(item.d, 2)}</td>
                    <td><span className={`badge badge-${FLAG_TONE[item.flag]} professor-score-status-badge`}>{item.flag}</span></td>
                    <td>
                      {item.options.length ? (
                        <button className="professor-analytics-link" onClick={() => setSelectedId(item.id)} type="button" aria-label={`Show choices for question ${item.number}`}>Choices</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="professor-analytics-muted">
            Flags: too easy above p {TOO_EASY_P.toFixed(2)}, too hard below {TOO_HARD_P.toFixed(2)}, weak below D {WEAK_D.toFixed(2)}, revise below D 0.
          </p>
        </section>
      ) : null}

      <div className="professor-analytics-row">
        {selected ? (
          <section className="professor-analytics-card professor-analytics-wide">
            <header>
              <h3>Choices chosen — Question {selected.number}</h3>
              <span>{shortText(selected.text, 120)}</span>
            </header>
            <ul className="professor-analytics-legend is-inline">
              <li><span className="is-upper" />Top {analysis.groupSize} students</li>
              <li><span className="is-lower" />Bottom {analysis.groupSize} students</li>
            </ul>
            <div className="professor-analytics-options">
              {selected.options.map((option) => (
                <div className="professor-analytics-option" key={option.key}>
                  <span className="professor-analytics-option-label">
                    <strong>{option.key === "No answer" ? option.key : `${option.key}. ${shortText(option.label, 48)}`}</strong>
                    {option.isKey ? <small>Correct answer</small> : null}
                  </span>
                  <div className="professor-analytics-pair">
                    <div><span className="is-upper" style={{ width: `${option.upperShare * 100}%` }} /><small>{percent(option.upperShare)}</small></div>
                    <div><span className="is-lower" style={{ width: `${option.lowerShare * 100}%` }} /><small>{percent(option.lowerShare)}</small></div>
                  </div>
                </div>
              ))}
            </div>
            {selected.keyOutdrawn ? (
              <p className="professor-analytics-warning">
                More top students chose <strong>{selected.keyOutdrawn.key} (“{selected.keyOutdrawn.label}”)</strong> than the correct answer. Check the answer key or the wording.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="professor-analytics-card">
          <header><h3>Recommended actions</h3></header>
          {analysis.recommendations.length ? (
            <ul className="professor-analytics-actions">
              {analysis.recommendations.slice(0, 6).map((item) => (
                <li key={item.title}><strong>{item.title}</strong><span>{item.detail}</span></li>
              ))}
            </ul>
          ) : <p className="professor-analytics-muted">No issues found. The questions separate stronger and weaker students well.</p>}
        </section>
      </div>
    </div>
  );
}
