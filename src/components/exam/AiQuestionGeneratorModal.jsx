import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiAlertTriangle, FiArrowDown, FiArrowUp, FiCheckCircle, FiPlus, FiRefreshCw, FiTrash2, FiUploadCloud, FiX } from "react-icons/fi";
import { toast } from "sonner";
import {
  CHOICE_KEYS,
  DIFFICULTY_OPTIONS,
  MAX_QUESTION_COUNT,
  QUESTION_COUNT_OPTIONS,
  QUESTION_DIFFICULTIES,
  assessExtractedText,
  createBlankPreviewQuestion,
  moveItem,
  normalizeGeneratedQuestion,
  normalizeQuestionCount,
  planQuestionBatches,
  toBuilderQuestion,
  validatePdfFile,
  validatePreviewQuestions,
} from "../../lib/aiQuestionGenerator";
import { GenerationRequestError, requestGeneratedQuestions } from "../../lib/aiQuestionClient";
import { PdfReadError, extractPdfPages } from "../../lib/pdfTextExtractor";

const CUSTOM_COUNT = "custom";

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error, fallback) {
  return error instanceof PdfReadError || error instanceof GenerationRequestError ? error.message : fallback;
}

function isValidPoints(value) {
  const points = Number(value);
  return Number.isFinite(points) && points >= 0.01 && points <= 1000;
}

export default function AiQuestionGeneratorModal({ onClose, onInsert, generate = requestGeneratedQuestions }) {
  const [step, setStep] = useState("setup");
  const [file, setFile] = useState(null);
  const [pageRange, setPageRange] = useState("");
  const [countChoice, setCountChoice] = useState("10");
  const [customCount, setCustomCount] = useState("15");
  const [difficulty, setDifficulty] = useState("Mixed");
  const [points, setPoints] = useState("1");
  const [setupError, setSetupError] = useState("");
  const [progress, setProgress] = useState("");
  const [pages, setPages] = useState([]);
  const [lastRequest, setLastRequest] = useState(null);
  const [sampleResult, setSampleResult] = useState(false);
  const [items, setItems] = useState([]);
  const [busyItemId, setBusyItemId] = useState("");
  const [errorItemId, setErrorItemId] = useState("");
  const [confirmAction, setConfirmAction] = useState("");
  const abortRef = useRef(null);
  const busy = step === "working" || Boolean(busyItemId);

  useEffect(() => () => abortRef.current?.abort(), []);

  function startRequest() {
    abortRef.current?.abort();
    abortRef.current = new window.AbortController();
    return abortRef.current.signal;
  }

  function requestClose() {
    if (busy) {
      abortRef.current?.abort();
      onClose();
      return;
    }
    if (items.length) {
      setConfirmAction("close");
      return;
    }
    onClose();
  }

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") requestCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function generateBatches(sourcePages, request, signal, onBatch) {
    const batches = planQuestionBatches(request.count, request.difficulty);
    const generated = [];
    for (const [index, batch] of batches.entries()) {
      onBatch?.(index + 1, batches.length);
      const result = await generate({
        pages: sourcePages,
        count: batch.count,
        difficulty: batch.difficulty,
        avoidStems: generated.map((item) => item.question),
        signal,
      });
      if (result?.sample) setSampleResult(true);
      generated.push(...(result?.questions || []).map((raw) => normalizeGeneratedQuestion(raw, sourcePages, { points: request.points })));
    }
    return generated;
  }

  function batchProgress(current, total) {
    setProgress(total > 1 ? `Generating questions (batch ${current} of ${total})...` : "Generating questions...");
  }

  function selectFile(nextFile) {
    setFile(nextFile || null);
    setSetupError(nextFile ? validatePdfFile(nextFile) : "");
  }

  async function handleGenerate(event) {
    event.preventDefault();
    const fileError = validatePdfFile(file);
    const { count, error: countError } = normalizeQuestionCount(countChoice === CUSTOM_COUNT ? customCount : countChoice);
    const setupMessage = fileError || countError || (isValidPoints(points) ? "" : "Enter points between 0.01 and 1000.");
    if (setupMessage) {
      setSetupError(setupMessage);
      return;
    }

    const request = { count, difficulty, points };
    const signal = startRequest();
    setSetupError("");
    setStep("working");
    try {
      const extracted = await extractPdfPages(file, {
        pageRange,
        signal,
        onProgress: ({ current, total }) => setProgress(`Reading page ${current} of ${total}...`),
      });
      const assessment = assessExtractedText(extracted.pages);
      if (assessment.status !== "ok") throw new PdfReadError(assessment.message);

      const generated = await generateBatches(extracted.pages, request, signal, batchProgress);
      if (!generated.length) throw new PdfReadError("No questions could be generated from this PDF.");
      if (generated.length < count) toast.warning(`Only ${generated.length} of ${count} questions could be generated from this PDF.`);
      setPages(extracted.pages);
      setLastRequest(request);
      setItems(generated);
      setErrorItemId("");
      setStep("preview");
    } catch (error) {
      if (error?.name !== "AbortError") {
        setSetupError(errorMessage(error, "Questions could not be generated. Try again."));
      }
      setStep("setup");
    } finally {
      setProgress("");
    }
  }

  async function regenerateAll() {
    setConfirmAction("");
    const signal = startRequest();
    setStep("working");
    try {
      const generated = await generateBatches(pages, lastRequest, signal, batchProgress);
      if (generated.length) {
        setItems(generated);
        setErrorItemId("");
      } else {
        toast.error("No new questions could be generated.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast.error(errorMessage(error, "Questions could not be regenerated. Try again."));
    } finally {
      setProgress("");
      setStep("preview");
    }
  }

  async function regenerateItem(item) {
    const signal = startRequest();
    setBusyItemId(item.id);
    try {
      const result = await generate({
        pages,
        count: 1,
        difficulty: item.difficulty,
        avoidStems: items.map((entry) => entry.question),
        signal,
      });
      const raw = result?.questions?.[0];
      if (!raw) {
        toast.error("No new question could be generated. Edit this one instead.");
        return;
      }
      const next = normalizeGeneratedQuestion(raw, pages, { points: item.points });
      setItems((current) => current.map((entry) => entry.id === item.id ? next : entry));
      if (errorItemId === item.id) setErrorItemId("");
    } catch (error) {
      if (error?.name !== "AbortError") toast.error(errorMessage(error, "This question could not be regenerated. Try again."));
    } finally {
      setBusyItemId("");
    }
  }

  function updateItem(id, patch) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateChoice(id, key, value) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, choices: { ...item.choices, [key]: value } } : item));
  }

  function addManualQuestion() {
    const blank = createBlankPreviewQuestion(lastRequest?.points || points);
    setItems((current) => [...current, blank]);
    window.requestAnimationFrame(() => document.getElementById(`ai-question-${blank.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  function handleInsert() {
    const { index, message } = validatePreviewQuestions(items);
    if (message) {
      const invalid = items[index];
      setErrorItemId(invalid?.id || "");
      toast.error(message);
      if (invalid) document.getElementById(`ai-question-${invalid.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    onInsert(items.map(toBuilderQuestion));
    onClose();
  }

  const totalPoints = items.reduce((total, item) => total + (Number(item.points) || 0), 0);

  return createPortal(
    <div className="professor-share-backdrop professor-ai-backdrop" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }} role="presentation">
      <section aria-labelledby="ai-generator-title" aria-modal="true" className="professor-share-modal professor-ai-modal" role="dialog">
        <div className="professor-share-header">
          <div>
            <h2 id="ai-generator-title">Generate Questions from PDF</h2>
            <p>Creates Multiple Choice questions from your PDF. Review every question before adding it to the exam.</p>
          </div>
          <button aria-label="Close question generator" onClick={requestClose} type="button">
            <FiX />
          </button>
        </div>

        {sampleResult && step === "preview" ? (
          <p className="professor-ai-notice">Sample mode: the server built these questions directly from the PDF text without AI.</p>
        ) : null}

        {step === "setup" ? (
          <form className="professor-ai-setup" noValidate onSubmit={handleGenerate}>
            <label
              className={`professor-ai-dropzone${file ? " has-file" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                selectFile(event.dataTransfer.files?.[0]);
              }}
            >
              <FiUploadCloud aria-hidden="true" />
              <strong>{file ? file.name : "Choose or drop a PDF"}</strong>
              <span>{file ? formatFileSize(file.size) : "Text-based PDF, up to 10 MB. Scanned PDFs are not supported."}</span>
              <input accept=".pdf,application/pdf" onChange={(event) => selectFile(event.target.files?.[0])} type="file" />
            </label>

            <div className="professor-ai-options">
              <label className="professor-field-label">
                <span>Page range (optional)</span>
                <input className="professor-create-input" onChange={(event) => setPageRange(event.target.value)} placeholder="All pages, e.g. 1-40" type="text" value={pageRange} />
              </label>
              <label className="professor-field-label">
                <span>Number of questions</span>
                <select className="professor-create-input" onChange={(event) => setCountChoice(event.target.value)} value={countChoice}>
                  {QUESTION_COUNT_OPTIONS.map((option) => <option key={option} value={String(option)}>{option}</option>)}
                  <option value={CUSTOM_COUNT}>Custom</option>
                </select>
              </label>
              {countChoice === CUSTOM_COUNT ? (
                <label className="professor-field-label">
                  <span>Custom count (1-{MAX_QUESTION_COUNT})</span>
                  <input className="professor-create-input" max={MAX_QUESTION_COUNT} min="1" onChange={(event) => setCustomCount(event.target.value)} step="1" type="number" value={customCount} />
                </label>
              ) : null}
              <label className="professor-field-label">
                <span>Difficulty</span>
                <select className="professor-create-input" onChange={(event) => setDifficulty(event.target.value)} value={difficulty}>
                  {DIFFICULTY_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label className="professor-field-label">
                <span>Points per question</span>
                <input className="professor-create-input" max="1000" min="0.01" onChange={(event) => setPoints(event.target.value)} step="0.01" type="number" value={points} />
              </label>
            </div>

            {setupError ? <p className="professor-ai-error" role="alert">{setupError}</p> : null}

            <div className="professor-delete-actions">
              <button onClick={requestClose} type="button">Cancel</button>
              <button className="professor-ai-primary" type="submit">Generate Questions</button>
            </div>
          </form>
        ) : null}

        {step === "working" ? (
          <div className="professor-ai-working" role="status">
            <span className="professor-ai-spinner" aria-hidden="true" />
            <strong>{progress || "Preparing..."}</strong>
            <span>Keep this window open. You can cancel at any time.</span>
            <div className="professor-delete-actions">
              <button onClick={() => abortRef.current?.abort()} type="button">Cancel</button>
            </div>
          </div>
        ) : null}

        {step === "preview" ? (
          <div className="professor-ai-preview">
            <div className="professor-ai-summary">
              <strong>{items.length} question{items.length === 1 ? "" : "s"}</strong>
              <span>Total points: {totalPoints.toFixed(2)}</span>
            </div>

            <div className="professor-ai-list">
              {items.map((item, index) => (
                <article className={`professor-ai-card${errorItemId === item.id ? " has-error" : ""}`} id={`ai-question-${item.id}`} key={item.id}>
                  <header>
                    <strong>Question {index + 1}</strong>
                    {item.source === "manual" ? (
                      <span className="professor-ai-source">Added manually</span>
                    ) : item.verified ? (
                      <span className="professor-ai-source is-verified"><FiCheckCircle aria-hidden="true" /> Page {item.sourcePage}</span>
                    ) : (
                      <span className="professor-ai-source is-unverified"><FiAlertTriangle aria-hidden="true" /> Source not verified - check carefully</span>
                    )}
                    <div className="professor-ai-card-actions">
                      <button aria-label={`Move question ${index + 1} up`} disabled={busy || index === 0} onClick={() => setItems((current) => moveItem(current, index, -1))} type="button"><FiArrowUp /></button>
                      <button aria-label={`Move question ${index + 1} down`} disabled={busy || index === items.length - 1} onClick={() => setItems((current) => moveItem(current, index, 1))} type="button"><FiArrowDown /></button>
                      <button aria-label={`Regenerate question ${index + 1}`} disabled={busy} onClick={() => regenerateItem(item)} type="button"><FiRefreshCw className={busyItemId === item.id ? "is-spinning" : ""} /></button>
                      <button aria-label={`Delete question ${index + 1}`} className="danger" disabled={busy} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} type="button"><FiTrash2 /></button>
                    </div>
                  </header>

                  <textarea aria-label={`Question ${index + 1} text`} className="professor-create-textarea" maxLength={1000} onChange={(event) => updateItem(item.id, { question: event.target.value })} placeholder="Question text" value={item.question} />

                  <div className="professor-ai-choices" role="radiogroup" aria-label={`Correct answer for question ${index + 1}`}>
                    {CHOICE_KEYS.map((key) => (
                      <div className={`professor-ai-choice${item.correct === key ? " is-correct" : ""}`} key={key}>
                        <label>
                          <input aria-label={`Mark choice ${key} as the correct answer`} checked={item.correct === key} name={`ai-correct-${item.id}`} onChange={() => updateItem(item.id, { correct: key })} type="radio" />
                          <span>{key}</span>
                        </label>
                        <input aria-label={`Question ${index + 1} choice ${key}`} className="professor-create-input" maxLength={300} onChange={(event) => updateChoice(item.id, key, event.target.value)} placeholder={`Choice ${key}`} type="text" value={item.choices[key]} />
                      </div>
                    ))}
                  </div>

                  <div className="professor-ai-meta">
                    <label className="professor-field-label">
                      <span>Difficulty</span>
                      <select className="professor-create-input" onChange={(event) => updateItem(item.id, { difficulty: event.target.value })} value={item.difficulty}>
                        {QUESTION_DIFFICULTIES.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="professor-field-label">
                      <span>Points</span>
                      <input className="professor-create-input" max="1000" min="0.01" onChange={(event) => updateItem(item.id, { points: event.target.value })} step="0.01" type="number" value={item.points} />
                    </label>
                  </div>

                  {item.source === "ai" && (item.explanation || item.evidence) ? (
                    <details className="professor-ai-explanation">
                      <summary>Why this answer (for your review only, not saved)</summary>
                      {item.explanation ? <p>{item.explanation}</p> : null}
                      {item.evidence ? <blockquote>{item.evidence}</blockquote> : null}
                    </details>
                  ) : null}
                </article>
              ))}
              {!items.length ? <div className="professor-added-empty">No questions left. Add one manually or regenerate the set.</div> : null}
            </div>

            {confirmAction ? (
              <div className="professor-ai-confirm" role="alert">
                <span>{confirmAction === "close" ? "Discard the generated questions?" : "Replace every question with a new set? Your edits will be lost."}</span>
                <div className="professor-delete-actions">
                  <button onClick={() => setConfirmAction("")} type="button">Keep editing</button>
                  <button className="danger" onClick={confirmAction === "close" ? onClose : regenerateAll} type="button">
                    {confirmAction === "close" ? "Discard" : "Replace all"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="professor-ai-footer">
                <div className="professor-delete-actions">
                  <button disabled={busy} onClick={addManualQuestion} type="button"><FiPlus /> Add Manual Question</button>
                  <button disabled={busy} onClick={() => setConfirmAction("regenerate")} type="button"><FiRefreshCw /> Regenerate All</button>
                </div>
                <button className="professor-ai-primary" disabled={busy || !items.length} onClick={handleInsert} type="button">
                  Insert {items.length} Question{items.length === 1 ? "" : "s"}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
