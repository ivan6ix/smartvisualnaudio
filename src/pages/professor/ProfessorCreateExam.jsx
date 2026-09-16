import { validateExam, toLocalDateTime } from "../../lib/examValidation";
import { queryClient } from "../../lib/queryClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiEdit2, FiPlus, FiSave, FiTrash2, FiX } from "react-icons/fi";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { professorCourses } from "../../data/professorData";
import { AUTO_GRADED_TYPES, QUESTION_TYPES } from "../../lib/examQuestionTypes";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const examTypes = ["Quiz", "Exam", "Long Exam", "Activity"];
const periods = ["Prelim", "Midterm", "Semi-Final", "Final"];
const semesters = ["1st Semester", "2nd Semester", "Summer"];
const attempts = ["1 attempt", "2 attempts", "3 attempts", "Unlimited Attempts"];

const settings = [
  { key: "randomizeQuestions", label: "Randomize question order per student" },
  { key: "randomizeChoices", label: "Randomize choices per student" },
  { key: "requireEnvironmentScan", label: "Require environment scan before exam" },
  { key: "liveCameraMonitoring", label: "Enable live camera monitoring" },
  { key: "liveAudioMonitoring", label: "Enable live audio monitoring" },
  { key: "captureSnapshots", label: "Capture snapshot when violation is detected" },
];

const defaultChoices = [
  { key: "A", value: "" },
  { key: "B", value: "" },
  { key: "C", value: "" },
  { key: "D", value: "" },
];

const defaultPairs = [
  { left: "", right: "" },
  { left: "", right: "" },
  { left: "", right: "" },
];

const defaultListItems = ["", "", ""];
const PICTURE_CHOICE_TYPE = "Picture Choice";
const CHOICE_TYPES = ["Multiple Choice", PICTURE_CHOICE_TYPE, "Multiple Select"];
const MAX_QUESTION_IMAGE_BYTES = 2 * 1024 * 1024;
const AUTOSAVE_DELAY_MS = 1600;

function SelectInput({ children, ...props }) {
  return (
    <select className="professor-create-input" {...props}>
      {children}
    </select>
  );
}

function TextInput(props) {
  return <input className="professor-create-input" {...props} />;
}

function mapLiveCourse(course) {
  return {
    id: course.id,
    courseName: course.course_name || course.courseName,
    courseCode: course.course_code || course.courseCode,
    section: course.section,
  };
}

function emptyQuestionDraft() {
  return {
    id: "",
    title: "",
    type: "",
    choices: defaultChoices,
    correctAnswer: "",
    correctAnswers: [],
    pairs: defaultPairs,
    listItems: defaultListItems,
    questionImageDataUrl: "",
    questionImageName: "",
    points: "1",
  };
}

function hasFilledValues(values) {
  return values.every((value) => String(value || "").trim());
}

function readImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function recoveryKey(userId, draftId = "new") {
  return `smartvisualnaudio:professor-exam-draft:${userId}:${draftId}`;
}

function activeCreateSessionKey(userId) {
  return `smartvisualnaudio:professor-exam-active-create:${userId}`;
}

function activeCreateDraftKey(userId) {
  return `smartvisualnaudio:professor-exam-active-draft:${userId}`;
}

function createSessionRecoveryId(sessionId) {
  return `new:${sessionId}`;
}

function isMeaningfulDraft(form, addedQuestions, draftQuestion) {
  return Boolean(
    form.courseId && (
      form.title.trim() ||
      form.description.trim() ||
      form.instructions.trim() ||
      form.examType ||
      form.period ||
      form.semester ||
      form.duration ||
      form.startsAt ||
      form.deadline ||
      addedQuestions.length ||
      draftQuestion.title.trim() ||
      draftQuestion.type
    )
  );
}

function buildDraftSnapshot(form, addedQuestions, draftQuestion) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    examForm: form,
    questions: addedQuestions,
    questionDraft: draftQuestion,
  };
}

function applyDraftSnapshot(snapshot, setExamForm, setQuestions, setQuestionDraft) {
  if (!snapshot?.examForm) return;
  setExamForm((current) => ({
    ...current,
    ...snapshot.examForm,
    settings: { ...current.settings, ...(snapshot.examForm.settings || {}) },
  }));
  if (Array.isArray(snapshot.questions)) setQuestions(snapshot.questions);
  if (snapshot.questionDraft) setQuestionDraft({ ...emptyQuestionDraft(), ...snapshot.questionDraft });
}

function defaultExamForm({ presetCourseId = "", presetType = "", presetPeriod = "" } = {}) {
  return {
    courseId: presetCourseId,
    title: "",
    examType: examTypes.includes(presetType) ? presetType : "",
    period: presetPeriod,
    semester: "",
    duration: "",
    attempts: "Unlimited Attempts",
    deadline: "",
    startsAt: "",
    status: "Draft",
    instructions: "",
    description: "",
    settings: {
      randomizeQuestions: false,
      randomizeChoices: false,
      requireEnvironmentScan: false,
      liveCameraMonitoring: false,
      liveAudioMonitoring: false,
      captureSnapshots: false,
    },
  };
}

export default function ProfessorCreateExam() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("editId") || "";
  const presetCourseId = searchParams.get("courseId") || "";
  const presetType = searchParams.get("type") || "";
  const presetPeriod = searchParams.get("period") || "";
  const isEditingExam = Boolean(editId);
  const [courses, setCourses] = useState(() => professorCourses.map(mapLiveCourse));
  const [periodOptions, setPeriodOptions] = useState(() => [...new Set([...periods, presetPeriod].filter(Boolean))]);
  const [examForm, setExamForm] = useState(() => defaultExamForm({ presetCourseId, presetType, presetPeriod }));
  const [questionDraft, setQuestionDraft] = useState(emptyQuestionDraft);
  const [questions, setQuestions] = useState([]);
  const [editingQuestionId, setEditingQuestionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [draftExamId, setDraftExamId] = useState(editId);
  const [autosaveStatus, setAutosaveStatus] = useState("Saved locally");
  const savingRef = useRef(false);
  const hydratedRef = useRef(false);
  const createSessionIdRef = useRef("");
  const autosaveTimerRef = useRef(null);
  const autosaveInFlightRef = useRef(false);
  const autosavePendingRef = useRef(false);
  const finalPublishRef = useRef(false);
  const latestSnapshotRef = useRef(null);
  const lastSyncedJsonRef = useRef("");

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadCourses() {
      const { data, error } = await supabase
        .from("courses")
        .select("id, course_name, course_code, section")
        .eq("professor_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false });

      if (error) {
        toast.error(error.message);
        return;
      }

      const liveCourses = (data || []).map(mapLiveCourse);
      setCourses(liveCourses);
      if (presetCourseId) {
        const { data: periodRows, error: periodError } = await supabase
          .from("course_periods")
          .select("name")
          .eq("course_id", presetCourseId)
          .eq("professor_id", user.id)
          .order("created_at", { ascending: true });
        if (!periodError) {
          setPeriodOptions([...new Set([...periods, ...(periodRows || []).map((period) => period.name), presetPeriod].filter(Boolean))]);
        }
      }
      setExamForm((current) => ({
        ...current,
        courseId: current.courseId && liveCourses.some((course) => course.id === current.courseId)
          ? current.courseId
          : liveCourses[0]?.id || "",
        examType: current.examType || (examTypes.includes(presetType) ? presetType : ""),
        period: current.period || presetPeriod,
      }));
    }

    loadCourses();
  }, [presetCourseId, presetPeriod, presetType, user?.id]);

  useEffect(() => {
    const freshCreateSession = location.state?.freshCreateSession;
    if (!user?.id || editId || (hydratedRef.current && !freshCreateSession)) return;
    const sessionId = freshCreateSession || window.sessionStorage.getItem(activeCreateSessionKey(user.id)) || crypto.randomUUID();
    createSessionIdRef.current = sessionId;
    window.sessionStorage.setItem(activeCreateSessionKey(user.id), sessionId);

    if (freshCreateSession) {
      window.sessionStorage.removeItem(activeCreateDraftKey(user.id));
      window.localStorage.removeItem(recoveryKey(user.id, "new"));
      setDraftExamId("");
      setQuestions([]);
      setQuestionDraft(emptyQuestionDraft());
      setEditingQuestionId("");
      setExamForm(defaultExamForm({ presetCourseId, presetType, presetPeriod }));
      latestSnapshotRef.current = null;
      lastSyncedJsonRef.current = "";
      window.clearTimeout(autosaveTimerRef.current);
      hydratedRef.current = true;
      setAutosaveStatus("Saved locally");
      return;
    }

    const activeDraftId = window.sessionStorage.getItem(activeCreateDraftKey(user.id));
    if (activeDraftId) {
      navigate(`/professor/exams/create?editId=${activeDraftId}`, { replace: true });
      return;
    }

    try {
      const saved = window.localStorage.getItem(recoveryKey(user.id, createSessionRecoveryId(sessionId)));
      if (saved) {
        const snapshot = JSON.parse(saved);
        applyDraftSnapshot(snapshot, setExamForm, setQuestions, setQuestionDraft);
        latestSnapshotRef.current = snapshot;
        setAutosaveStatus("Recovered locally");
      } else {
        setAutosaveStatus("Saved locally");
      }
    } catch {
      setAutosaveStatus("Saved locally");
    } finally {
      hydratedRef.current = true;
    }
  }, [editId, location.state, navigate, presetCourseId, presetPeriod, presetType, user?.id]);

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id || !editId) return;

    async function loadExamForEdit() {
      const { data: exam, error: examError } = await supabase
        .from("exams")
        .select("id, course_id, title, exam_title, description, semester, exam_type, duration, time_limit, status, exam_settings, professor_id, created_by")
        .eq("id", editId)
        .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
        .maybeSingle();

      if (examError) {
        toast.error(examError.message);
        return;
      }

      if (!exam) {
        toast.error("Exam not found or you do not have access to edit it.");
        navigate("/professor/exams");
        return;
      }

      const { count: attemptCount, error: attemptsError } = await supabase.from("exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", editId);
      if (attemptsError || attemptCount > 0) {
        toast.error(attemptsError?.message || "This exam already has attempts. Create a new exam to preserve answers and grades.");
        navigate("/professor/exams");
        return;
      }
      const { data: questionRows, error: questionError } = await supabase
        .from("exam_questions")
        .select("id, question_text, question_type, choices, correct_answer, correct_answers, question_config, manual_grading, points")
        .eq("exam_id", editId)
        .order("id", { ascending: true });

      if (questionError) {
        toast.error(questionError.message);
        return;
      }

      const period = exam.description || "";
      const serverSnapshot = exam.exam_settings?.draftSnapshot;
      setPeriodOptions((current) => [...new Set([...current, period].filter(Boolean))]);
      setExamForm((current) => ({
        ...current,
        courseId: exam.course_id || "",
        title: exam.exam_title || exam.title || "",
        examType: exam.exam_type || "",
        period,
        semester: exam.semester || "",
        duration: String(exam.time_limit || exam.duration || ""),
        attempts: exam.exam_settings?.attemptLimit || exam.exam_settings?.attempts || "Unlimited Attempts",
        deadline: toLocalDateTime(exam.exam_settings?.deadline),
        startsAt: toLocalDateTime(exam.exam_settings?.startsAt),
        instructions: exam.exam_settings?.instructions || "",
        description: exam.exam_settings?.description || "",
        status: "Draft",
        settings: {
          ...current.settings,
          ...(exam.exam_settings || {}),
        },
      }));
      setQuestions((questionRows || []).map((question) => ({
        id: question.id,
        title: question.question_text,
        type: question.question_type,
        choices: Array.isArray(question.choices) ? question.choices : [],
        correctAnswer: question.correct_answer || "",
        correctAnswers: Array.isArray(question.correct_answers) ? question.correct_answers : [],
        config: question.question_config || {},
        points: String(question.points || 1),
        manualGrading: Boolean(question.manual_grading),
      })));
      if (serverSnapshot) {
        let localSnapshot = null;
        try {
          localSnapshot = JSON.parse(window.localStorage.getItem(recoveryKey(user.id, editId)) || "null");
        } catch {
          localSnapshot = null;
        }
        const localTime = localSnapshot?.savedAt ? new Date(localSnapshot.savedAt).getTime() : 0;
        const serverTime = serverSnapshot.savedAt ? new Date(serverSnapshot.savedAt).getTime() : 0;
        applyDraftSnapshot(localTime > serverTime ? localSnapshot : serverSnapshot, setExamForm, setQuestions, setQuestionDraft);
        latestSnapshotRef.current = localTime > serverTime ? localSnapshot : serverSnapshot;
        setAutosaveStatus(localTime > serverTime ? "Recovered locally" : "Saved");
      }
      hydratedRef.current = true;
    }

    loadExamForEdit();
  }, [editId, navigate, user?.id]);

  const selectedCourse = courses.find((course) => course.id === examForm.courseId);
  const isAutoGraded = questionDraft.type ? AUTO_GRADED_TYPES.has(questionDraft.type) : true;
  const buildSavePayload = useCallback((statusOverride = null) => {
    const status = statusOverride || (examForm.status === "Submit for Review" ? "Pending Review" : "Draft");
    const durationValue = examForm.duration ? Number(examForm.duration) : null;
    const snapshot = buildDraftSnapshot(examForm, questions, questionDraft);
    const examPayload = {
      course_id: examForm.courseId,
      title: examForm.title.trim(),
      exam_title: examForm.title.trim(),
      description: examForm.period,
      semester: examForm.semester,
      course: selectedCourse ? `${selectedCourse.courseCode} - ${selectedCourse.section}` : "",
      professor_id: user?.id,
      created_by: user?.id,
      exam_type: examForm.examType,
      exam_settings: {
        ...examForm.settings,
        description: examForm.description,
        instructions: examForm.instructions,
        startsAt: examForm.startsAt ? new Date(examForm.startsAt).toISOString() : null,
        deadline: examForm.deadline ? new Date(examForm.deadline).toISOString() : null,
        attemptLimit: examForm.attempts || "Unlimited Attempts",
        draftSnapshot: snapshot,
      },
      duration: durationValue,
      time_limit: durationValue,
      questions_count: questions.length,
      status,
      submitted_at: status === "Pending Review" ? new Date().toISOString() : null,
      approved_at: null,
      rejected_at: null,
    };

    const questionRows = questions
      .filter((question) => question.title?.trim() && question.type && Number(question.points) > 0)
      .map((question) => ({
        id: question.id,
        question_text: question.title,
        question_type: question.type,
        choices: question.choices || [],
        correct_answer: question.correctAnswer || "",
        correct_answers: question.correctAnswers || [],
        question_config: question.config || {},
        manual_grading: question.manualGrading,
        points: Number(question.points),
      }));

    return { examPayload, questionRows, snapshot };
  }, [examForm, questionDraft, questions, selectedCourse, user?.id]);

  const getRecoveryTargetId = useCallback(() => {
    if (draftExamId) return draftExamId;
    return createSessionRecoveryId(createSessionIdRef.current || "current");
  }, [draftExamId]);

  const persistLocalSnapshot = useCallback((snapshot, targetId = draftExamId || "new") => {
    if (!user?.id || !snapshot) return;
    try {
      window.localStorage.setItem(recoveryKey(user.id, targetId), JSON.stringify(snapshot));
      setAutosaveStatus(window.navigator.onLine ? "Unsaved changes" : "Offline - saved locally");
    } catch {
      setAutosaveStatus("Unable to save locally");
    }
  }, [draftExamId, user?.id]);

  function clearActiveCreateRecovery(savedId = draftExamId || editId) {
    if (!user?.id) return;
    const sessionId = createSessionIdRef.current || window.sessionStorage.getItem(activeCreateSessionKey(user.id));
    if (sessionId) window.localStorage.removeItem(recoveryKey(user.id, createSessionRecoveryId(sessionId)));
    if (savedId) window.localStorage.removeItem(recoveryKey(user.id, savedId));
    window.localStorage.removeItem(recoveryKey(user.id, "new"));
    window.sessionStorage.removeItem(activeCreateSessionKey(user.id));
    window.sessionStorage.removeItem(activeCreateDraftKey(user.id));
  }

  const syncDraftNow = useCallback(async (manual = false) => {
    if (!hasSupabaseConfig || !user?.id) return false;
    if (finalPublishRef.current) return false;
    const { examPayload, snapshot } = buildSavePayload("Draft");
    if (!isMeaningfulDraft(examForm, questions, questionDraft)) return false;
    if (!examPayload.course_id) {
      setAutosaveStatus("Saved locally - select a course to sync");
      return false;
    }

    const snapshotJson = JSON.stringify(snapshot);
    if (!manual && snapshotJson === lastSyncedJsonRef.current) return true;
    latestSnapshotRef.current = snapshot;
    persistLocalSnapshot(snapshot, getRecoveryTargetId());
    autosavePendingRef.current = true;
    if (autosaveInFlightRef.current) return false;

    while (autosavePendingRef.current) {
      if (finalPublishRef.current) return false;
      autosavePendingRef.current = false;
      autosaveInFlightRef.current = true;
      setAutosaveStatus("Saving...");
      const latest = latestSnapshotRef.current;
      const latestPayload = buildSavePayload("Draft");
      try {
        const { data: savedId, error } = await supabase.rpc("save_exam", {
          p_id: draftExamId || null,
          p_exam: latestPayload.examPayload,
          p_questions: latestPayload.questionRows,
        });
        if (error) throw error;
        const nextId = savedId || draftExamId;
        if (nextId && nextId !== draftExamId) {
          setDraftExamId(nextId);
          window.sessionStorage.setItem(activeCreateDraftKey(user.id), nextId);
          const sessionId = createSessionIdRef.current;
          if (sessionId) window.localStorage.removeItem(recoveryKey(user.id, createSessionRecoveryId(sessionId)));
        }
        if (nextId) persistLocalSnapshot(latest, nextId);
        lastSyncedJsonRef.current = JSON.stringify(latest);
        setAutosaveStatus("Saved");
      } catch (error) {
        if (import.meta.env.DEV) window.console.error("Exam draft sync failed", error);
        setAutosaveStatus(window.navigator.onLine ? "Unable to sync - saved locally" : "Offline - saved locally");
        autosaveInFlightRef.current = false;
        return false;
      }
      autosaveInFlightRef.current = false;
    }
    return true;
  }, [buildSavePayload, draftExamId, examForm, getRecoveryTargetId, persistLocalSnapshot, questionDraft, questions, user?.id]);

  useEffect(() => {
    if (!user?.id || !hydratedRef.current) return;
    const snapshot = buildDraftSnapshot(examForm, questions, questionDraft);
    latestSnapshotRef.current = snapshot;
    persistLocalSnapshot(snapshot, getRecoveryTargetId());
    window.clearTimeout(autosaveTimerRef.current);
    if (!isMeaningfulDraft(examForm, questions, questionDraft)) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      void syncDraftNow(false);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [examForm, getRecoveryTargetId, persistLocalSnapshot, questionDraft, questions, syncDraftNow, user?.id]);

  useEffect(() => {
    function handleOnline() {
      if (isMeaningfulDraft(examForm, questions, questionDraft)) void syncDraftNow(false);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [examForm, questionDraft, questions, syncDraftNow]);

  useEffect(() => () => window.clearTimeout(autosaveTimerRef.current), []);

  function setExamValue(key, value) {
    setExamForm((current) => ({ ...current, [key]: value }));
  }

  function toggleExamSetting(key) {
    setExamForm((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: !current.settings[key],
      },
    }));
  }

  function setQuestionValue(key, value) {
    setQuestionDraft((current) => ({ ...current, [key]: value }));
  }

  function updateChoice(key, value) {
    setQuestionDraft((current) => ({
      ...current,
      choices: current.choices.map((choice) => choice.key === key ? { ...choice, value } : choice),
    }));
  }

  async function handleQuestionImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      toast.error("Upload an image file.");
      return;
    }
    if (file.size > MAX_QUESTION_IMAGE_BYTES) {
      toast.error("Question image must be 2MB or smaller.");
      return;
    }

    try {
      const dataUrl = await readImageDataUrl(file);
      setQuestionDraft((current) => ({
        ...current,
        questionImageDataUrl: dataUrl,
        questionImageName: file.name,
      }));
    } catch {
      toast.error("Unable to read image file.");
    } finally {
      event.target.value = "";
    }
  }

  function toggleCorrectChoice(key) {
    setQuestionDraft((current) => ({
      ...current,
      correctAnswers: current.correctAnswers.includes(key)
        ? current.correctAnswers.filter((item) => item !== key)
        : [...current.correctAnswers, key],
    }));
  }

  function updatePair(index, key, value) {
    setQuestionDraft((current) => ({
      ...current,
      pairs: current.pairs.map((pair, pairIndex) => pairIndex === index ? { ...pair, [key]: value } : pair),
    }));
  }

  function updateListItem(index, value) {
    setQuestionDraft((current) => {
      const nextItems = current.listItems.map((item, itemIndex) => itemIndex === index ? value : item);
      return {
        ...current,
        listItems: nextItems,
        correctAnswers: current.type === "Ordering / Sequencing" ? nextItems.filter(Boolean) : current.correctAnswers,
      };
    });
  }

  function updateEnumerationAnswer(index, value) {
    setQuestionDraft((current) => ({
      ...current,
      correctAnswers: current.correctAnswers.map((answer, answerIndex) => answerIndex === index ? value : answer),
    }));
  }

  function handleQuestionTypeChange(type) {
    setQuestionDraft({
      ...emptyQuestionDraft(),
      title: questionDraft.title,
      type,
      points: questionDraft.points,
      correctAnswers: type === "Enumeration" || type === "Ordering / Sequencing" ? defaultListItems : [],
    });
  }

  function resetQuestionDraft() {
    setQuestionDraft(emptyQuestionDraft());
    setEditingQuestionId("");
  }

  function validateQuestion() {
    const fieldError = validateExam({ title: "Question validation" }, [questionDraft]);
    if (fieldError) return fieldError;
    const title = questionDraft.title.trim();
    if (!title || !questionDraft.type || Number(questionDraft.points) <= 0) return "Question title, type, and points are required.";

    if (CHOICE_TYPES.includes(questionDraft.type)) {
      if (!hasFilledValues(questionDraft.choices.map((choice) => choice.value))) return "Complete choices A, B, C, and D.";
      if ((questionDraft.type === "Multiple Choice" || questionDraft.type === PICTURE_CHOICE_TYPE) && !questionDraft.correctAnswer) return "Select the correct answer.";
      if (questionDraft.type === "Multiple Select" && !questionDraft.correctAnswers.length) return "Select at least one correct answer.";
      if (questionDraft.type === PICTURE_CHOICE_TYPE && !questionDraft.questionImageDataUrl) return "Upload a picture for this question.";
    }

    if (["Identification", "Fill in the Blank", "True or False"].includes(questionDraft.type) && !questionDraft.correctAnswer.trim()) {
      return "Correct answer is required.";
    }

    if (questionDraft.type === "Matching Type" && questionDraft.pairs.some((pair) => !pair.left.trim() || !pair.right.trim())) {
      return "Complete all matching pairs.";
    }

    if (questionDraft.type === "Ordering / Sequencing" && !hasFilledValues(questionDraft.listItems)) {
      return "Complete all ordering items in the correct sequence.";
    }

    if (questionDraft.type === "Enumeration" && !hasFilledValues(questionDraft.correctAnswers)) {
      return "Complete all enumeration answers.";
    }

    return "";
  }

  function buildQuestionPayload() {
    const type = questionDraft.type;
    const choices = CHOICE_TYPES.includes(type) ? questionDraft.choices : [];
    const correctAnswers = type === "Multiple Choice" || type === PICTURE_CHOICE_TYPE || type === "True or False" || type === "Identification" || type === "Fill in the Blank"
      ? [questionDraft.correctAnswer.trim()]
      : type === "Matching Type"
        ? questionDraft.pairs
        : questionDraft.correctAnswers.map((answer) => String(answer).trim()).filter(Boolean);
    const config = {
      choices,
      pairs: type === "Matching Type" ? questionDraft.pairs : [],
      orderItems: type === "Ordering / Sequencing" ? questionDraft.listItems : [],
      questionImage: type === PICTURE_CHOICE_TYPE ? questionDraft.questionImageDataUrl : "",
      questionImageName: type === PICTURE_CHOICE_TYPE ? questionDraft.questionImageName : "",
      manualGrading: !AUTO_GRADED_TYPES.has(type),
    };

    return {
      id: questionDraft.id || crypto.randomUUID(),
      title: questionDraft.title.trim(),
      type,
      choices,
      correctAnswer: type === "Matching Type" ? JSON.stringify(questionDraft.pairs) : correctAnswers.join(", "),
      correctAnswers,
      config,
      points: questionDraft.points,
      manualGrading: !AUTO_GRADED_TYPES.has(type),
    };
  }

  function handleAddQuestion() {
    const validationMessage = validateQuestion();
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    const nextQuestion = buildQuestionPayload();
    setQuestions((current) => editingQuestionId
      ? current.map((question) => question.id === editingQuestionId ? nextQuestion : question)
      : [...current, nextQuestion]);
    resetQuestionDraft();
  }

  function handleEditQuestion(question) {
    setEditingQuestionId(question.id);
    setQuestionDraft({
      id: question.id,
      title: question.title,
      type: question.type,
      choices: question.choices?.length ? question.choices : defaultChoices,
      correctAnswer: Array.isArray(question.correctAnswers) ? question.correctAnswers[0] || "" : question.correctAnswer || "",
      correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers : [],
      pairs: question.config?.pairs?.length ? question.config.pairs : defaultPairs,
      listItems: question.config?.orderItems?.length ? question.config.orderItems : defaultListItems,
      questionImageDataUrl: question.config?.questionImage || "",
      questionImageName: question.config?.questionImageName || "",
      points: question.points,
    });
  }

  function handleDeleteQuestion(questionId) {
    setQuestions((current) => current.filter((question) => question.id !== questionId));
    if (editingQuestionId === questionId) resetQuestionDraft();
  }

  async function handleSaveDraft() {
    if (savingRef.current) return;
    if (!isMeaningfulDraft(examForm, questions, questionDraft)) {
      toast.error("Add a course or some exam content before saving a draft.");
      return;
    }
    if (!examForm.courseId) {
      const snapshot = buildDraftSnapshot(examForm, questions, questionDraft);
      persistLocalSnapshot(snapshot, getRecoveryTargetId());
      toast.success("Draft saved locally. Select a course to sync it.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const synced = await syncDraftNow(true);
      if (!synced && hasSupabaseConfig) throw new Error("Draft is saved locally but could not sync yet.");
      queryClient.invalidateQueries({ queryKey: ["professor-exams", user.id] });
      clearActiveCreateRecovery(draftExamId || editId);
      toast.success("Exam saved as draft.");
      navigate("/professor/exams");
    } catch (error) {
      toast.error(error.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleSaveExam() {
    if (savingRef.current) return;
    const validationError = validateExam(examForm, questions);
    if (validationError) { toast.error(validationError); return; }

    if (!examForm.courseId || !examForm.title.trim() || !examForm.examType || !examForm.period || !questions.length) {
      toast.error("Complete exam details and add at least one question.");
      return;
    }

    if (!hasSupabaseConfig || !user?.id) {
      toast.success("Exam saved locally for preview.");
      navigate("/professor/exams");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const status = "Pending Review";
      const { examPayload, questionRows } = buildSavePayload(status);

      const { data: savedId, error: saveError } = await supabase.rpc("save_exam", { p_id: draftExamId || editId || null, p_exam: examPayload, p_questions: questionRows });
      if (saveError) throw saveError;
      queryClient.invalidateQueries({ queryKey: ["professor-exams", user.id] });
      clearActiveCreateRecovery(savedId || draftExamId || editId);
      if (status === "Pending Review") {
        const { data: clusterRows, error: clusterError } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "Cluster Professor")
          .eq("status", "Active");

        if (clusterError) throw clusterError;

        const notificationRows = (clusterRows || []).map((profile) => ({
          user_id: profile.id,
          title: "New exam submitted for review",
          message: `${examForm.title.trim()} is waiting for cluster review.`,
          type: "Exam",
          is_read: false,
        }));

        if (notificationRows.length) {
          const { error: notificationError } = await supabase.from("notifications").insert(notificationRows);
          if (notificationError) toast.error(`Exam saved, but the review notification failed: ${notificationError.message}`);
        }
      }

      toast.success(isEditingExam ? "Exam updated and submitted for approval." : "Exam submitted for approval.");
      navigate("/professor/exams");
    } catch (error) {
      toast.error(error.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handlePublishExam() {
    const validationError = validateExam(examForm, questions);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setPublishConfirmOpen(true);
  }

  async function confirmPublishExam() {
    if (savingRef.current) return;
    const validationError = validateExam(examForm, questions);
    if (validationError) {
      toast.error(validationError);
      setPublishConfirmOpen(false);
      return;
    }

    if (!examForm.courseId || !examForm.title.trim() || !examForm.examType || !examForm.period || !questions.length) {
      toast.error("Complete exam details and add at least one question.");
      return;
    }

    if (!hasSupabaseConfig || !user?.id) {
      toast.success("Exam published locally for preview.");
      setPublishConfirmOpen(false);
      navigate("/professor/exams");
      return;
    }

    savingRef.current = true;
    finalPublishRef.current = true;
    autosavePendingRef.current = false;
    window.clearTimeout(autosaveTimerRef.current);
    setSaving(true);
    try {
      while (autosaveInFlightRef.current) {
        await wait(100);
      }
      const { examPayload, questionRows } = buildSavePayload("Published");
      const { data: savedId, error: saveError } = await supabase.rpc("save_exam", {
        p_id: draftExamId || editId || null,
        p_exam: examPayload,
        p_questions: questionRows,
      });
      if (saveError) throw saveError;
      queryClient.invalidateQueries({ queryKey: ["professor-exams", user.id] });
      clearActiveCreateRecovery(savedId || draftExamId || editId);
      toast.success("Exam published for students.");
      setPublishConfirmOpen(false);
      navigate("/professor/exams");
    } catch (error) {
      toast.error(error.message);
    } finally {
      finalPublishRef.current = false;
      savingRef.current = false;
      setSaving(false);
    }
  }

  function renderQuestionTypeFields() {
    if (!questionDraft.type) return null;

    if (CHOICE_TYPES.includes(questionDraft.type)) {
      return (
        <>
          {questionDraft.type === PICTURE_CHOICE_TYPE ? (
            <label className="professor-question-image-upload">
              <span>{questionDraft.questionImageName || "Upload question picture"}</span>
              <input accept="image/*" onChange={handleQuestionImageUpload} type="file" />
              {questionDraft.questionImageDataUrl ? <img alt="Question preview" decoding="async" loading="lazy" src={questionDraft.questionImageDataUrl} /> : null}
            </label>
          ) : null}
          <div className="professor-choice-grid">
            {questionDraft.choices.map((choice) => (
              <label className="professor-choice-field" key={choice.key}>
                <span>{choice.key}</span>
                <input className="professor-create-input" onChange={(event) => updateChoice(choice.key, event.target.value)} placeholder={`Choice ${choice.key}`} type="text" value={choice.value} />
                {questionDraft.type === "Multiple Select" ? (
                  <label className="professor-correct-checkbox">
                    <input checked={questionDraft.correctAnswers.includes(choice.key)} onChange={() => toggleCorrectChoice(choice.key)} type="checkbox" />
                    Correct
                  </label>
                ) : null}
              </label>
            ))}
            {questionDraft.type === "Multiple Choice" || questionDraft.type === PICTURE_CHOICE_TYPE ? (
              <SelectInput className="professor-create-input professor-correct-answer-select" onChange={(event) => setQuestionValue("correctAnswer", event.target.value)} value={questionDraft.correctAnswer}>
                <option value="" disabled>Correct Answer</option>
                {questionDraft.choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.key}</option>)}
              </SelectInput>
            ) : null}
          </div>
        </>
      );
    }

    if (questionDraft.type === "True or False") {
      return (
        <div className="professor-answer-row">
          <SelectInput className="professor-create-input professor-correct-answer-select" onChange={(event) => setQuestionValue("correctAnswer", event.target.value)} value={questionDraft.correctAnswer}>
            <option value="" disabled>Correct Answer</option>
            <option>True</option>
            <option>False</option>
          </SelectInput>
        </div>
      );
    }

    if (questionDraft.type === "Identification" || questionDraft.type === "Fill in the Blank") {
      return (
        <div className="professor-answer-row">
          <TextInput onChange={(event) => setQuestionValue("correctAnswer", event.target.value)} placeholder="Correct Answer" type="text" value={questionDraft.correctAnswer} />
        </div>
      );
    }

    if (questionDraft.type === "Matching Type") {
      return (
        <div className="professor-complex-question-grid">
          {questionDraft.pairs.map((pair, index) => (
            <div className="professor-pair-row" key={index}>
              <TextInput onChange={(event) => updatePair(index, "left", event.target.value)} placeholder={`Left item ${index + 1}`} value={pair.left} />
              <TextInput onChange={(event) => updatePair(index, "right", event.target.value)} placeholder={`Matching answer ${index + 1}`} value={pair.right} />
            </div>
          ))}
        </div>
      );
    }

    if (questionDraft.type === "Ordering / Sequencing") {
      return (
        <div className="professor-complex-question-grid">
          {questionDraft.listItems.map((item, index) => (
            <label className="professor-order-row" key={index}>
              <span>{index + 1}</span>
              <TextInput onChange={(event) => updateListItem(index, event.target.value)} placeholder={`Item ${index + 1} in correct order`} value={item} />
            </label>
          ))}
        </div>
      );
    }

    if (questionDraft.type === "Enumeration") {
      const answers = questionDraft.correctAnswers.length ? questionDraft.correctAnswers : defaultListItems;
      return (
        <div className="professor-complex-question-grid">
          {answers.map((answer, index) => (
            <label className="professor-order-row" key={index}>
              <span>{index + 1}</span>
              <TextInput onChange={(event) => updateEnumerationAnswer(index, event.target.value)} placeholder={`Accepted answer ${index + 1}`} value={answer} />
            </label>
          ))}
        </div>
      );
    }

    if (questionDraft.type === "File Upload") {
      return <div className="professor-added-empty compact">Students may upload PDF, DOCX, DOC, JPG, or PNG files up to 10MB. This question requires manual grading.</div>;
    }

    return <div className="professor-added-empty compact">This question type requires manual grading.</div>;
  }

  return (
    <section className="professor-create-exam-page">
      <header className="professor-create-header">
        <h1>{isEditingExam ? "Edit Exam" : "Create Exam"}</h1>
        <p>{isEditingExam ? "Revise the rejected exam, save it, then submit it again for cluster approval." : "Build exam details, security settings, deadline, and questions."}</p>
      </header>

      <form className="professor-create-form" onSubmit={(event) => event.preventDefault()}>
        <div className="professor-create-top-grid">
          <section className="professor-create-card professor-details-card">
            <h2>Exam Details</h2>
            <div className="professor-details-grid">
              <SelectInput onChange={(event) => setExamValue("courseId", event.target.value)} value={examForm.courseId}>
                <option value="" disabled>Select Course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.courseCode} - {course.section}</option>)}
              </SelectInput>
              <TextInput onChange={(event) => setExamValue("title", event.target.value)} placeholder="Exam Title" type="text" value={examForm.title} />
              <SelectInput onChange={(event) => setExamValue("examType", event.target.value)} value={examForm.examType}>
                <option value="" disabled>Exam Type</option>
                {examTypes.map((type) => <option key={type}>{type}</option>)}
              </SelectInput>
              <SelectInput disabled={Boolean(presetPeriod) && !isEditingExam} onChange={(event) => setExamValue("period", event.target.value)} value={examForm.period}>
                <option value="" disabled>Select Period</option>
                {periodOptions.map((period) => <option key={period}>{period}</option>)}
              </SelectInput>
              <SelectInput onChange={(event) => setExamValue("semester", event.target.value)} value={examForm.semester}>
                <option value="" disabled>Select Semester</option>
                {semesters.map((semester) => <option key={semester}>{semester}</option>)}
              </SelectInput>
              <TextInput min="1" onChange={(event) => setExamValue("duration", event.target.value)} placeholder="Time Duration (minutes)" type="number" value={examForm.duration} />
              <SelectInput onChange={(event) => setExamValue("attempts", event.target.value)} value={examForm.attempts}>
                <option value="" disabled>Attempts</option>
                {attempts.map((attempt) => <option key={attempt}>{attempt}</option>)}
              </SelectInput>
              <label>Start (local time)<TextInput onChange={(event) => setExamValue("startsAt", event.target.value)} type="datetime-local" value={examForm.startsAt} /></label><label>Deadline (local time)<TextInput onChange={(event) => setExamValue("deadline", event.target.value)} type="datetime-local" value={examForm.deadline} /></label>
            </div>
            <label>Description<textarea className="professor-create-textarea" maxLength={1000} value={examForm.description} onChange={event => setExamValue("description", event.target.value)} /><small>{examForm.description.length} / 1000</small></label>
            <textarea className="professor-create-textarea" onChange={(event) => setExamValue("instructions", event.target.value)} maxLength={5000} placeholder="Exam instructions" value={examForm.instructions} /><small>{examForm.instructions.length} / 5000</small>
          </section>

          <section className="professor-create-card professor-settings-card">
            <h2>Exam Settings</h2>
            <div className="professor-settings-grid">
              {settings.map((setting) => (
                <label className="professor-setting-option" key={setting.key}>
                  <input checked={!!examForm.settings[setting.key]} onChange={() => toggleExamSetting(setting.key)} type="checkbox" />
                  <span>{setting.label}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <section className="professor-create-card professor-question-builder">
          <div className="professor-question-titlebar">
            <h2>Question Builder</h2>
            <div className="professor-question-actions">
              <span className="professor-autosave-status">{autosaveStatus}</span>
              <button className="professor-add-question" onClick={handleAddQuestion} type="button"><FiPlus /> {editingQuestionId ? "Update Question" : "Add Question"}</button>
              <button className="professor-save-draft" disabled={saving} onClick={handleSaveDraft} type="button"><FiSave /> {saving ? "Saving..." : "Save as Draft"}</button>
              <button className="professor-submit-review" disabled={saving} onClick={handleSaveExam} title="Send this exam to the Cluster Professor for review before publishing." type="button"><FiSave /> {saving ? "Saving..." : "Submit for Review"}</button>
              <button className="professor-save-exam" disabled={saving} onClick={handlePublishExam} title="Publish directly without Cluster Professor review." type="button"><FiSave /> Publish</button>
            </div>
          </div>

          <div className="professor-question-fields">
            <TextInput onChange={(event) => setQuestionValue("title", event.target.value)} placeholder="Question Title" type="text" value={questionDraft.title} />
            <SelectInput onChange={(event) => handleQuestionTypeChange(event.target.value)} value={questionDraft.type}>
              <option value="" disabled>Question Type</option>
              {QUESTION_TYPES.map((type) => <option key={type}>{type}</option>)}
            </SelectInput>
            <TextInput min="1" onChange={(event) => setQuestionValue("points", event.target.value)} placeholder="Points" type="number" value={questionDraft.points} />
          </div>

          {renderQuestionTypeFields()}
          {questionDraft.type && !isAutoGraded ? <p className="professor-manual-note">This question type is saved for manual grading.</p> : null}
        </section>

        <aside className="professor-create-card professor-added-questions">
          <h2>Added Questions</h2>
          {questions.length ? (
            <div className="professor-added-list">
              {questions.map((question, index) => (
                <article key={question.id}>
                  <strong>{index + 1}. {question.title}</strong>
                  <span>{question.type} - {question.points} pt{question.points === "1" ? "" : "s"}</span>
                  <span>{question.manualGrading ? "Manual grading required" : `Correct answer: ${question.correctAnswer}`}</span>
                  <div className="professor-added-actions">
                    <button onClick={() => handleEditQuestion(question)} type="button"><FiEdit2 /> Edit</button>
                    <button className="danger" onClick={() => handleDeleteQuestion(question.id)} type="button"><FiTrash2 /> Delete</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="professor-added-empty">No questions added yet.</div>
          )}
        </aside>
      </form>
      {publishConfirmOpen ? (
        <div className="professor-share-backdrop professor-publish-backdrop" onClick={() => saving ? null : setPublishConfirmOpen(false)} role="presentation">
          <section aria-labelledby="create-publish-title" aria-modal="true" className="professor-share-modal professor-publish-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="professor-share-header">
              <div>
                <h2 id="create-publish-title">Publish Exam?</h2>
                <p>This will publish the exam directly without submitting it for Cluster Professor review.</p>
              </div>
              <button aria-label="Close publish confirmation" disabled={saving} onClick={() => setPublishConfirmOpen(false)} type="button">
                <FiX />
              </button>
            </div>
            <div className="professor-delete-summary">
              <strong>{examForm.title || "Untitled Exam"}</strong>
              <span>{selectedCourse ? `${selectedCourse.courseCode} - ${selectedCourse.section}` : "No course selected"} - {examForm.examType || "Exam"} - {examForm.period || "No period"}</span>
              <p>Eligible students may be able to access the exam according to its schedule and availability settings. Do you want to continue?</p>
            </div>
            <div className="professor-delete-actions">
              <button disabled={saving} onClick={() => setPublishConfirmOpen(false)} type="button">Cancel</button>
              <button disabled={saving} onClick={confirmPublishExam} type="button">
                {saving ? "Publishing..." : "Publish Exam"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
