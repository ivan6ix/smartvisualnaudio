// Live camera object monitoring policy. Uses the same prohibited-object rules as the environment
// scan and adds temporal confirmation so a single noisy frame never becomes a violation.
import { DETECTION_RULES, findDetectionRule, normalizePrediction } from "./environmentScan.js";

// Categories watched during the exam and the violation type each records. People are handled by
// face monitoring, and notes/books are left to the pre-exam scan to avoid background-shelf alerts.
export const LIVE_OBJECT_CATEGORIES = {
  phone: { type: "PHONE_DETECTED", label: "Phone" },
  tablet: { type: "PHONE_DETECTED", label: "Tablet" },
  laptop: { type: "GADGET_DETECTED", label: "Laptop" },
  calculator: { type: "GADGET_DETECTED", label: "Calculator" },
  audio_device: { type: "GADGET_DETECTED", label: "Earbuds or headphones" },
  smartwatch: { type: "GADGET_DETECTED", label: "Smartwatch" },
};

export const LIVE_MONITOR_WINDOW = 6;
// Confirmed when 2 of the last 6 successful samples reach the rule's flag confidence, or 4 of them
// reach its floor (a persistent lower-confidence object).
export const LIVE_CONFIRM_SAMPLES = 2;
export const LIVE_PERSIST_SAMPLES = 4;
// A confirmed event ends only after this many consecutive clean samples.
export const LIVE_CLEAR_SAMPLES = 3;

// Highest confidence per watched category in one detection sample.
export function getLiveSampleConfidences(predictions = []) {
  const confidences = {};
  predictions.forEach((raw) => {
    const prediction = normalizePrediction(raw);
    const rule = prediction && findDetectionRule(prediction.label);
    if (!rule || !LIVE_OBJECT_CATEGORIES[rule.category] || prediction.confidence < rule.floor) return;
    confidences[rule.category] = Math.max(confidences[rule.category] || 0, prediction.confidence);
  });
  return confidences;
}

function getRule(category) {
  return DETECTION_RULES.find((rule) => rule.category === category);
}

// Stateful monitor. observe() takes { ok: true, predictions } for a successful detector run or
// { ok: false } for a technical failure, and returns actions:
//   { type: "violation", category, violationType, confidence, message } - once per continuous event
//   { type: "uncertain", category, confidence, message } - once per unconfirmed episode, never a violation
//   { type: "cleared", category, violationType } - the event ended; a later detection is a new event
// Technical failures change nothing: they neither confirm, extend nor clear an event.
export function createLiveObjectMonitor() {
  const state = Object.fromEntries(Object.keys(LIVE_OBJECT_CATEGORIES).map((category) => [category, { history: [], active: false, uncertainNotified: false, cleanStreak: 0 }]));

  return {
    observe(sample) {
      if (!sample?.ok || !Array.isArray(sample.predictions)) return [];
      const confidences = getLiveSampleConfidences(sample.predictions);
      const actions = [];

      Object.entries(state).forEach(([category, entry]) => {
        const rule = getRule(category);
        const confidence = confidences[category] || 0;
        entry.history = [...entry.history, confidence].slice(-LIVE_MONITOR_WINDOW);
        const { label, type } = LIVE_OBJECT_CATEGORIES[category];

        if (entry.active) {
          entry.cleanStreak = confidence ? 0 : entry.cleanStreak + 1;
          if (entry.cleanStreak >= LIVE_CLEAR_SAMPLES) {
            Object.assign(entry, { active: false, uncertainNotified: false, cleanStreak: 0, history: [] });
            actions.push({ type: "cleared", category, violationType: type });
          }
          return;
        }

        const atFlag = entry.history.filter((value) => value >= rule.flag).length;
        const atFloor = entry.history.filter((value) => value >= rule.floor).length;
        const best = Math.max(...entry.history);
        if (atFlag >= LIVE_CONFIRM_SAMPLES || atFloor >= LIVE_PERSIST_SAMPLES) {
          Object.assign(entry, { active: true, cleanStreak: 0 });
          actions.push({ type: "violation", category, violationType: type, confidence: best, message: `${label} detected in camera view (${Math.round(best * 100)}%).` });
          return;
        }
        if (confidence && !entry.uncertainNotified) {
          entry.uncertainNotified = true;
          actions.push({ type: "uncertain", category, confidence, message: `Possible ${label.toLowerCase()} in camera view. Remove it from view; it is being verified.` });
        }
        if (!atFloor) entry.uncertainNotified = false;
      });

      return actions;
    },
    activeTypes() {
      return new Set(Object.entries(state).filter(([, entry]) => entry.active).map(([category]) => LIVE_OBJECT_CATEGORIES[category].type));
    },
  };
}
