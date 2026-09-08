import { supabase } from "../lib/supabase";

const AUDIO_VIOLATION_TYPE = "AUDIO_DETECTED";
const FALLBACK_AUDIO_VIOLATION_TYPE = "BACKGROUND_VOICE";

function safeTimestamp(value) {
  return value.replace(/[:.]/g, "-");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function uploadAudioViolation({
  audioBlob,
  audioLevel,
  courseId,
  exam,
  professorId,
  studentId,
  triggeredAt,
  onRecorded,
}) {
  const timestamp = triggeredAt || new Date().toISOString();
  const initialDescription = "Background voice or loud audio was detected for at least 3 seconds.";
  const corePayload = {
    student_id: studentId,
    exam_id: exam.id,
    violation_type: AUDIO_VIOLATION_TYPE,
    description: initialDescription,
    severity: "Medium",
    created_at: timestamp,
  };
  let violationId = null;
  let inserted = null;
  let insertError = null;
  const minimalPayload = {
    student_id: studentId,
    exam_id: exam.id,
    severity: "Medium",
    created_at: timestamp,
  };
  for (const payload of [
    corePayload,
    { ...minimalPayload, violation_type: AUDIO_VIOLATION_TYPE },
    { ...corePayload, violation_type: FALLBACK_AUDIO_VIOLATION_TYPE },
    { ...minimalPayload, violation_type: FALLBACK_AUDIO_VIOLATION_TYPE },
  ]) {
    const result = await supabase.from("violations").insert(payload).select("id").single();
    inserted = result.data;
    insertError = result.error;
    if (!insertError) break;
  }
  if (insertError) throw insertError;
  violationId = inserted?.id;
  const limitReached = onRecorded?.({ violationId, timestamp }) === true;

  const resolvedAudioBlob = await audioBlob;
  let evidenceUrl = null;
  let evidenceType = "audio";
  let description = "Audio level reached 50% or higher for 3 seconds. The next 10 seconds of audio was recorded for review.";

  try {
    if (resolvedAudioBlob?.size) {
      const path = `${studentId}/${exam.id}/${safeTimestamp(timestamp)}.webm`;
      const { error } = await supabase.storage.from("audio-violations").upload(path, resolvedAudioBlob, {
        contentType: resolvedAudioBlob.type || "audio/webm",
        upsert: false,
      });
      if (error) throw error;
      evidenceUrl = path;
    }
  } catch (error) {
    window.console.error("[AudioMonitoring]", error);
    if (resolvedAudioBlob?.size) {
      try {
        evidenceUrl = await blobToDataUrl(resolvedAudioBlob);
        evidenceType = "audio_inline";
        description = "Audio level reached 50% or higher for 3 seconds. The 10-second audio clip was saved inline because storage upload failed.";
      } catch (inlineError) {
        window.console.error("[AudioMonitoring]", inlineError);
        description = "Audio level reached 50% or higher for 3 seconds, but the 10-second audio evidence upload failed.";
      }
    } else {
      description = "Audio level reached 50% or higher for 3 seconds, but the 10-second audio evidence was not available.";
    }
  }

  if (limitReached) description = "Audio violation recorded. Recording stopped at the violation limit; any captured audio was retained. The exam reached 5 violations and automatic submission was triggered.";

  const evidencePayload = {
    professor_id: professorId || exam.professor_id || exam.created_by || null,
    course_id: courseId || exam.course_id || null,
    description,
    screenshot_url: evidenceUrl,
    evidence_url: evidenceUrl,
    evidence_type: evidenceType,
    audio_level: audioLevel,
  };
  if (violationId) {
    const { error: updateError } = await supabase
      .from("violations")
      .update(evidencePayload)
      .eq("id", violationId)
      .eq("student_id", studentId);
    if (updateError) {
      window.console.warn("[AudioMonitoring] Violation saved, but evidence metadata update failed.", updateError);
    }
  }

  return { evidenceUrl, timestamp, violationId };
}
