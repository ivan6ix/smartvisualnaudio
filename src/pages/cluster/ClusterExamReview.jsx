import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, EmptyState, PageHeader, TextArea } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";
import { buildClusterQuestionReview } from "../../lib/clusterReview";
import { StatusBadge } from "./helpers";

const REVIEW_NOTES_LIMIT = 1000;
const EMPTY = "Not configured";

function renderAnswerList(title, items) {
  return (
    <div className="cluster-question-review-block">
      <strong>{title}</strong>
      {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{EMPTY}</p>}
    </div>
  );
}

function renderQuestionDetails(question) {
  const review = buildClusterQuestionReview(question);

  if (review.questionType === "Matching Type") {
    return (
      <>
        <div className="cluster-question-review-block">
          <strong>Correct matches</strong>
          {review.matchingPairs.length ? (
            <div className="cluster-match-review">
              {review.matchingPairs.map((pair) => (
                <div key={`${pair.left}-${pair.right}`}>
                  <span>{pair.left}</span>
                  <b>{pair.right}</b>
                </div>
              ))}
            </div>
          ) : <p>{EMPTY}</p>}
        </div>
        {renderAnswerList("Distractors", review.matchingDistractors)}
      </>
    );
  }

  if (review.questionType === "Ordering / Sequencing") {
    return renderAnswerList("Configured sequence", review.sequence);
  }

  if (review.questionType === "Drag and Drop") {
    return (
      <>
        {renderAnswerList("Available choices", review.choices.map((choice) => choice.value).filter(Boolean))}
        {renderAnswerList("Correct choices", review.correctAnswers)}
      </>
    );
  }

  if (review.questionType === "File Upload") {
    return (
      <div className="cluster-question-review-block">
        <strong>Upload configuration</strong>
        <p>{review.questionConfig.allowedTypes || review.questionConfig.accept || "Student file submission; no configured answer key."}</p>
      </div>
    );
  }

  return (
    <>
      {renderAnswerList("Choices", review.choices.map((choice) => choice.value).filter(Boolean))}
      {renderAnswerList(review.questionType === "Multiple Select" ? "Correct choices" : "Correct answer", review.correctAnswers)}
      {review.partialMatch ? <p className="cluster-review-hint">Partial match enabled</p> : null}
    </>
  );
}

export default function ClusterExamReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { exams, saveReview, approveExam, rejectExam } = useCluster();
  const safeExams = Array.isArray(exams) ? exams : [];
  const exam = safeExams.find((item) => item.id === id);
  const [notes, setNotes] = useState(exam?.reviewNotes || "");
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const questions = useMemo(() => Array.isArray(exam?.questions) ? exam.questions : [], [exam]);
  const points = useMemo(() => questions.reduce((total, item) => total + Number(item.points || 0), 0), [questions]);

  if (!exam) return <Navigate to="/cluster/pending" replace />;

  async function handleApprove() {
    await approveExam(exam.id);
    setApproveOpen(false);
    navigate("/cluster/approved");
  }

  async function handleReject() {
    if (!reason.trim()) {
      toast.error("Reason for rejection is required");
      return;
    }
    await rejectExam(exam.id, reason);
    setRejectOpen(false);
    navigate("/cluster/rejected");
  }

  return (
    <>
      <PageHeader title="Exam Review" subtitle="Review exam metadata, questions, answer key, and scoring before approval." actions={<StatusBadge status={exam.status} />} />
      <div className="dashboard-grid">
        <Card>
          <h2>{exam.examTitle}</h2>
          <div className="info-list">
            <span>Description <strong>{exam.description}</strong></span>
            <span>Program <strong>{exam.programCode || "Program not assigned"}</strong></span>
            <span>Course <strong>{exam.course}</strong></span>
            <span>Year/Section <strong>{[exam.yearLevel, exam.section].filter(Boolean).join(" - ") || exam.courseMeta || "Not assigned"}</strong></span>
            <span>Professor Name <strong>{exam.professorName}</strong></span>
            <span>Time Limit <strong>{exam.timeLimit} minutes</strong></span>
            <span>Passing Score <strong>{exam.passingScore}%</strong></span>
            <span>Exam Type <strong>{exam.examType}</strong></span>
            <span>Created Date <strong>{exam.createdAt}</strong></span>
            <span>Submission Date <strong>{exam.submittedAt}</strong></span>
            <span>Total Points <strong>{points}</strong></span>
          </div>
        </Card>
        <Card>
          <h2>Review Panel</h2>
          <div className="cluster-review-notes">
            <TextArea label="Review Notes" rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={REVIEW_NOTES_LIMIT} />
            <span className="review-notes-counter">{notes.length} / {REVIEW_NOTES_LIMIT}</span>
          </div>
          <div className="header-actions cluster-review-actions">
            <Button variant="light" onClick={() => saveReview(exam.id, notes)}>Save Review</Button>
            <Button onClick={() => setApproveOpen(true)}>Approve Exam</Button>
            <Button variant="light" onClick={() => setRejectOpen(true)}>Reject Exam</Button>
            <Button variant="light" onClick={() => navigate(-1)}>Return</Button>
          </div>
        </Card>
      </div>
      <Card>
        <h2>Questions</h2>
        <div className="cluster-question-list">
          {questions.map((question, index) => (
            <article key={question.id}>
              <div><strong>Question {index + 1}</strong><span>{question.questionType}</span></div>
              <p>{question.questionText || EMPTY}</p>
              {renderQuestionDetails(question)}
              <footer><span>Question type: <b>{question.questionType || "Question"}</b></span><span>Points: <b>{question.points || 0}</b></span></footer>
            </article>
          ))}
          {!questions.length ? <EmptyState title="No questions available" description="This exam does not have configured review questions yet." /> : null}
        </div>
      </Card>
      {approveOpen ? (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setApproveOpen(false); }}>
          <Card className="cluster-modal">
            <h2>Approve Examination</h2>
            <p>Are you sure you want to approve this examination?</p>
            <div className="header-actions"><Button onClick={handleApprove}>Approve</Button><Button variant="light" onClick={() => setApproveOpen(false)}>Cancel</Button></div>
          </Card>
        </div>
      ) : null}
      {rejectOpen ? (
        <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setRejectOpen(false); }}>
          <Card className="cluster-modal">
            <h2>Reject Examination</h2>
            <TextArea label="Reason for rejection" rows={5} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter reason for rejecting this examination..." />
            <div className="header-actions reject-modal-actions"><Button onClick={handleReject}>Reject Exam</Button><Button variant="light" onClick={() => setRejectOpen(false)}>Cancel</Button></div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
