export function getAttemptLimit(settings) {
  const rawValue = settings?.attemptLimit ?? settings?.attempts ?? "Unlimited";
  const value = String(rawValue).trim().toLowerCase();
  if (!value || value.includes("unlimited")) return Infinity;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Infinity;
}

export function countUsedExamAttempts(attemptRows = []) {
  return attemptRows.length;
}

export function countUsedExamAttemptsByExam(attemptRows = []) {
  return attemptRows.reduce((items, attempt) => {
    if (!attempt?.exam_id) return items;
    return {
      ...items,
      [attempt.exam_id]: (items[attempt.exam_id] || 0) + 1,
    };
  }, {});
}

export function getExamAttemptEligibility(exam, attemptsTaken = 0, now = Date.now()) {
  const settings = exam?.exam_settings || exam?.examSettings || {};
  const attemptLimit = getAttemptLimit(settings);
  const usedAttempts = Number(attemptsTaken || exam?.attemptsTaken || 0);
  const unlimited = !Number.isFinite(attemptLimit);
  const startsAt = settings.startsAt ? new Date(settings.startsAt).getTime() : null;
  const deadline = settings.deadline ? new Date(settings.deadline).getTime() : null;

  if (settings.archived) {
    return { allowed: false, reason: "Archived", attemptLimit, usedAttempts, remainingAttempts: 0, unlimited };
  }
  if (startsAt && Number.isFinite(startsAt) && startsAt > now) {
    return { allowed: false, reason: "Scheduled", attemptLimit, usedAttempts, remainingAttempts: unlimited ? Infinity : Math.max(0, attemptLimit - usedAttempts), unlimited };
  }
  if (deadline && Number.isFinite(deadline) && deadline <= now) {
    return { allowed: false, reason: "Expired", attemptLimit, usedAttempts, remainingAttempts: unlimited ? Infinity : Math.max(0, attemptLimit - usedAttempts), unlimited };
  }
  if (!unlimited && usedAttempts >= attemptLimit) {
    return { allowed: false, reason: "Attempts Exhausted", attemptLimit, usedAttempts, remainingAttempts: 0, unlimited };
  }

  return {
    allowed: true,
    reason: "Available",
    attemptLimit,
    usedAttempts,
    remainingAttempts: unlimited ? Infinity : Math.max(0, attemptLimit - usedAttempts),
    unlimited,
  };
}

export function formatAttemptUsage(eligibility) {
  if (!eligibility) return "";
  if (eligibility.unlimited) return `${eligibility.usedAttempts} / Unlimited`;
  return `${eligibility.usedAttempts} / ${eligibility.attemptLimit}`;
}
