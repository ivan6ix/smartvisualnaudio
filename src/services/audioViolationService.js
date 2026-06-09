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
}) {
  const timestamp = new Date().toISOString();
  let evidenceUrl = null;
  let evidenceType = "audio";
  let description = "Audio level reached 50% or higher for 3 seconds. The previous 10 seconds of audio was recorded.";

  try {
    if (audioBlob?.size) {
      const path = `${studentId}/${exam.id}/${safeTimestamp(timestamp)}.webm`;
      const { error } = await supabase.storage.from("audio-violations").upload(path, audioBlob, {
        contentType: audioBlob.type || "audio/webm",
        upsert: false,
      });
      if (error) throw error;
      evidenceUrl = path;
    }
  } catch (error) {
    window.console.error("[AudioMonitoring]", error);
    if (audioBlob?.size) {
      try {
        evidenceUrl = await blobToDataUrl(audioBlob);
        evidenceType = "audio_inline";
        description = "Audio level reached 50% or higher for 3 seconds. Audio was saved inline because storage upload failed.";
      } catch (inlineError) {
        window.console.error("[AudioMonitoring]", inlineError);
        description = "Audio level reached 50% or higher for 3 seconds, but audio evidence upload failed.";
      }
    } else {
      description = "Audio level reached 50% or higher for 3 seconds, but audio evidence was not available.";
    }
  }

  const basePayload = {
    student_id: studentId,
    exam_id: exam.id,
    professor_id: professorId || exam.professor_id || exam.created_by || null,
    course_id: courseId || exam.course_id || null,
    description,
    severity: "Medium",
    screenshot_url: evidenceUrl,
    evidence_url: evidenceUrl,
    evidence_type: evidenceType,
    audio_level: audioLevel,
    created_at: timestamp,
  };

  let { error: insertError } = await supabase
    .from("violations")
    .insert({ ...basePayload, violation_type: AUDIO_VIOLATION_TYPE });

  if (insertError) {
    window.console.error("[AudioMonitoring]", insertError);
    const fallback = await supabase
      .from("violations")
      .insert({ ...basePayload, violation_type: FALLBACK_AUDIO_VIOLATION_TYPE });
    insertError = fallback.error;
  }

  if (insertError) {
    window.console.error("[AudioMonitoring]", insertError);
    const minimalFallback = await supabase.from("violations").insert({
      student_id: studentId,
      exam_id: exam.id,
      violation_type: FALLBACK_AUDIO_VIOLATION_TYPE,
      description,
      severity: "Medium",
      screenshot_url: evidenceUrl,
      created_at: timestamp,
    });
    insertError = minimalFallback.error;
  }

  if (insertError) {
    const bareFallback = await supabase.from("violations").insert({
      student_id: studentId,
      exam_id: exam.id,
      violation_type: FALLBACK_AUDIO_VIOLATION_TYPE,
      severity: "Medium",
      created_at: timestamp,
    });
    if (bareFallback.error) throw bareFallback.error;
  }

  return { evidenceUrl, timestamp };
}
