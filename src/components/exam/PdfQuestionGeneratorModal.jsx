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
  toBuilderQuestion,
  validatePdfFile,
  validatePreviewQuestions,
} from "../../lib/pdfQuestionGenerator";
import { PdfReadError, extractPdfPages } from "../../lib/pdfTextExtractor";
import { generateQuestionsInBrowser } from "../../lib/questionBuilder";

const CUSTOM_COUNT = "custom";

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error, fallback) {
  return error instanceof PdfReadError ? error.message : fallback;
}

function isValidPoints(value) {
  const points = Number(value);
  return Number.isFinite(points) && points >= 0.01 && points <= 1000;
}

export default function PdfQuestionGeneratorModal({ onClose, onInsert, generate = generateQuestionsInBrowser }) {
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
  const [items, setItems] = useState([]);
  const [busyItemId, setBusyItemId] = useState("");
  const [errorItemId, setErrorItemId] = useState("");
  const [confirmAction, setConfirmAction] = useState("");
  const abortRef = useRef(null);
  // Each run uses a new seed so regenerating picks different sentences and wrong choices.
  const seedRef = useRef(0);
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

  async function runGenerator(sourcePages, request, signal, avoidStems = []) {
    setProgress("Creating questions...");
    seedRef.current += 1;
    const result = await generate({
      pages: sourcePages,
      count: request.count,
      difficulty: request.difficulty,
      avoidStems,
      seed: seedRef.current,
      signal,
    });
    return (result?.questions || []).map((raw) => normalizeGeneratedQuestion(raw, sourcePages, { points: request.points }));
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

      const generated = await runGenerator(extracted.pages, request, signal);
      if (!generated.length) throw new PdfReadError("No questions could be made from this PDF. It needs full sentences of text, not only headings, lists or tables.");
      if (generated.length < count) toast.warning(`Only ${generated.length} of ${count} questions could be made from this PDF's text.`);
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
      // New questions first; earlier ones only fill the gap when the PDF has run out of new material.
      const fresh = await runGenerator(pages, lastRequest, signal, items.map((item) => item.question));
      const fill = fresh.length < lastRequest.count
        ? await runGenerator(pages, { ...lastRequest, count: lastRequest.count - fresh.length }, signal, fresh.map((item) => item.question))
        : [];
      const generated = [...fresh, ...fill];
      if (generated.length) {
        setItems(generated);
        setErrorItemId("");
      } else {
        toast.error("No new questions could be made.");
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
      const [next] = await runGenerator(pages, { count: 1, difficulty: item.difficulty, points: item.points }, signal, items.map((entry) => entry.question));
      if (!next) {
        toast.error("No other question could be made from this PDF. Edit this one instead.");
        return;
      }
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
    window.requestAnimationFrame(() => document.getElementById(`pdf-question-${blank.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  function handleInsert() {
    const { index, message } = validatePreviewQuestions(items);
    if (message) {
      const invalid = items[index];
      setErrorItemId(invalid?.id || "");
      toast.error(message);
      if (invalid) document.getElementById(`pdf-question-${invalid.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    onInsert(items.map(toBuilderQuestion));
    onClose();
  }

  const totalPoints = items.reduce((total, item) => total + (Number(item.points) || 0), 0);

  return createPortal(
    <div className="professor-share-backdrop professor-pdfq-backdrop" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }} role="presentation">
      <section aria-labelledby="pdf-generator-title" aria-modal="true" className="professor-share-modal professor-pdfq-modal" role="dialog">
        <div className="professor-share-header">
          <div>
            <h2 id="pdf-generator-title">Generate Questions from PDF</h2>
            <p>Builds Multiple Choice questions from your PDF&apos;s text. Review and edit every question before adding it.</p>
          </div>
          <button aria-label="Close question generator" onClick={requestClose} type="button">
            <FiX />
          </button>
        </div>

        {step === "setup" ? (
          <form className="professor-pdfq-setup" noValidate onSubmit={handleGenerate}>
            <label
              className={`professor-pdfq-dropzone${file ? " has-file" : ""}`}
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

            <div className="professor-pdfq-options">
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

            {setupError ? <p className="professor-pdfq-error" role="alert">{setupError}</p> : null}

            <div className="professor-delete-actions">
              <button onClick={requestClose} type="button">Cancel</button>
              <button className="professor-pdfq-primary" type="submit">Generate Questions</button>
            </div>
          </form>
        ) : null}

        {step === "working" ? (
          <div className="professor-pdfq-working" role="status">
            <span className="professor-pdfq-spinner" aria-hidden="true" />
            <strong>{progress || "Preparing..."}</strong>
            <span>Keep this window open. You can cancel at any time.</span>
            <div className="professor-delete-actions">
              <button onClick={() => abortRef.current?.abort()} type="button">Cancel</button>
            </div>
          </div>
        ) : null}

        {step === "preview" ? (
          <div className="professor-pdfq-preview">
            <div className="professor-pdfq-summary">
              <strong>{items.length} question{items.length === 1 ? "" : "s"}</strong>
              <span>Total points: {totalPoints.toFixed(2)}</span>
            </div>

            <div className="professor-pdfq-list">
              {items.map((item, index) => (
                <article className={`professor-pdfq-card${errorItemId === item.id ? " has-error" : ""}`} id={`pdf-question-${item.id}`} key={item.id}>
                  <header>
                    <strong>Question {index + 1}</strong>
                    {item.source === "manual" ? (
                      <span className="professor-pdfq-source">Added manually</span>
                    ) : item.verified ? (
                      <span className="professor-pdfq-source is-verified"><FiCheckCircle aria-hidden="true" /> Page {item.sourcePage}</span>
                    ) : (
                      <span className="professor-pdfq-source is-unverified"><FiAlertTriangle aria-hidden="true" /> Page not found - check carefully</span>
                    )}
                    <div className="professor-pdfq-card-actions">
                      <button aria-label={`Move question ${index + 1} up`} disabled={busy || index === 0} onClick={() => setItems((current) => moveItem(current, index, -1))} type="button"><FiArrowUp /></button>
                      <button aria-label={`Move question ${index + 1} down`} disabled={busy || index === items.length - 1} onClick={() => setItems((current) => moveItem(current, index, 1))} type="button"><FiArrowDown /></button>
                      <button aria-label={`Regenerate question ${index + 1}`} disabled={busy} onClick={() => regenerateItem(item)} type="button"><FiRefreshCw className={busyItemId === item.id ? "is-spinning" : ""} /></button>
                      <button aria-label={`Delete question ${index + 1}`} className="danger" disabled={busy} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} type="button"><FiTrash2 /></button>
                    </div>
                  </header>

                  <textarea aria-label={`Question ${index + 1} text`} className="professor-create-textarea" maxLength={1000} onChange={(event) => updateItem(item.id, { question: event.target.value })} placeholder="Question text" value={item.question} />

                  <div className="professor-pdfq-choices" role="radiogroup" aria-label={`Correct answer for question ${index + 1}`}>
                    {CHOICE_KEYS.map((key) => (
                      <div className={`professor-pdfq-choice${item.correct === key ? " is-correct" : ""}`} key={key}>
                        <label>
                          <input aria-label={`Mark choice ${key} as the correct answer`} checked={item.correct === key} name={`pdf-correct-${item.id}`} onChange={() => updateItem(item.id, { correct: key })} type="radio" />
                          <span>{key}</span>
                        </label>
                        <input aria-label={`Question ${index + 1} choice ${key}`} className="professor-create-input" maxLength={300} onChange={(event) => updateChoice(item.id, key, event.target.value)} placeholder={`Choice ${key}`} type="text" value={item.choices[key]} />
                      </div>
                    ))}
                  </div>

                  <div className="professor-pdfq-meta">
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

                  {item.source === "generated" && item.evidence ? (
                    <details className="professor-pdfq-explanation">
                      <summary>Where this comes from (for your review only, not saved)</summary>
                      <p>Page {item.sourcePage}:</p>
                      <blockquote>{item.evidence}</blockquote>
                    </details>
                  ) : null}
                </article>
              ))}
              {!items.length ? <div className="professor-added-empty">No questions left. Add one manually or regenerate the set.</div> : null}
            </div>

            {confirmAction ? (
              <div className="professor-pdfq-confirm" role="alert">
                <span>{confirmAction === "close" ? "Discard the generated questions?" : "Replace every question with a new set? Your edits will be lost."}</span>
                <div className="professor-delete-actions">
                  <button onClick={() => setConfirmAction("")} type="button">Keep editing</button>
                  <button className="danger" onClick={confirmAction === "close" ? onClose : regenerateAll} type="button">
                    {confirmAction === "close" ? "Discard" : "Replace all"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="professor-pdfq-footer">
                <div className="professor-delete-actions">
                  <button disabled={busy} onClick={addManualQuestion} type="button"><FiPlus /> Add Manual Question</button>
                  <button disabled={busy} onClick={() => setConfirmAction("regenerate")} type="button"><FiRefreshCw /> Regenerate All</button>
                </div>
                <button className="professor-pdfq-primary" disabled={busy || !items.length} onClick={handleInsert} type="button">
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
