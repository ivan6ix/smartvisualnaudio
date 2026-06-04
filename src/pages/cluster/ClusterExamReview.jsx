import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, PageHeader, TextArea } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";
import { StatusBadge } from "./helpers";

export default function ClusterExamReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { exams, saveReview, approveExam, rejectExam } = useCluster();
  const exam = exams.find((item) => item.id === id);
  const [notes, setNotes] = useState(exam?.reviewNotes || "");
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const points = useMemo(() => exam?.questions.reduce((total, item) => total + Number(item.points), 0) || 0, [exam]);

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
            <span>Course <strong>{exam.course}</strong></span>
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
          <TextArea label="Review Notes" rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="header-actions">
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
          {exam.questions.map((question, index) => (
            <article key={question.id}>
              <div><strong>Question {index + 1}</strong><span>{question.questionType}</span></div>
              <p>{question.questionText}</p>
              <ul>{question.choices.map((choice) => <li key={choice}>{choice}</li>)}</ul>
              <footer><span>Correct answer: <b>{question.correctAnswer}</b></span><span>Points: <b>{question.points}</b></span></footer>
            </article>
          ))}
        </div>
      </Card>
      {approveOpen ? (
        <div className="modal-backdrop">
          <Card className="cluster-modal">
            <h2>Approve Examination</h2>
            <p>Are you sure you want to approve this examination?</p>
            <div className="header-actions"><Button onClick={handleApprove}>Approve</Button><Button variant="light" onClick={() => setApproveOpen(false)}>Cancel</Button></div>
          </Card>
        </div>
      ) : null}
      {rejectOpen ? (
        <div className="modal-backdrop">
          <Card className="cluster-modal">
            <h2>Reject Examination</h2>
            <TextArea label="Reason for rejection" rows={5} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter reason for rejecting this examination..." />
            <div className="rejection-examples">
              <span>Incorrect answer key</span><span>Duplicate questions</span><span>Missing instructions</span><span>Time limit is too short</span><span>Question format issue</span>
            </div>
            <div className="header-actions"><Button onClick={handleReject}>Reject Exam</Button><Button variant="light" onClick={() => setRejectOpen(false)}>Cancel</Button></div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
