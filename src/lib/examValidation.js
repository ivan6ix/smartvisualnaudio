export function toLocalDateTime(value) {
 if (!value) return "";
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) return "";
 return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
export function validateExam(form, questions) {
 if (!form.title.trim() || form.title.length > 200) return "Exam title is required and must be 200 characters or fewer.";
 if ((form.description || "").length > 1000) return "Description must be 1000 characters or fewer.";
 if ((form.instructions || "").length > 5000) return "Instructions must be 5000 characters or fewer.";
 if (form.duration && (!Number.isInteger(Number(form.duration)) || Number(form.duration)<1 || Number(form.duration)>1440)) return "Duration must be a whole number from 1 to 1440 minutes.";
 if (form.attempts && !["1 attempt","2 attempts","3 attempts","Unlimited"].includes(form.attempts)) return "Select a valid attempt limit.";
 for (const field of ["startsAt","deadline"]) if (form[field] && !Number.isFinite(new Date(form[field]).getTime())) return "Enter valid schedule dates.";
 if (form.startsAt && form.deadline && new Date(form.deadline)<=new Date(form.startsAt)) return "Deadline must be after the start.";
 if (questions.length > 500) return "Use 500 questions or fewer.";
 for (const q of questions) {
  if (!q.title?.trim() || q.title.length>5000) return "Question text is required and must be 5000 characters or fewer.";
  if (!Number.isFinite(Number(q.points)) || Number(q.points)<=0 || Number(q.points)>1000) return "Question points must be greater than zero and at most 1000.";
  if ((q.correctAnswer || "").length>2000) return "Correct answers must be 2000 characters or fewer.";
  if ((q.choices || []).some(c=>String(c.value ?? c).length>2000)) return "Answer choices must be 2000 characters or fewer.";
 }
 return "";
}
export function examAvailability(settings, now=Date.now()) {
 if(settings?.archived) return "Archived";
 if(settings?.startsAt && new Date(settings.startsAt).getTime()>now) return "Scheduled";
 if(settings?.deadline && new Date(settings.deadline).getTime()<=now) return "Expired";
 return "Available";
}
