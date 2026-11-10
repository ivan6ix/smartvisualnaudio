// Live camera object monitoring policy during the exam. Uses the same prohibited-object rules as the environment
// scan. A clear sighting from a trained detector (COCO-SSD, Roboflow) is a violation at once, with no warning first.
// The OWL-ViT model, the only one that knows what paper looks like, only guesses, so its sighting must repeat on two
// of its checks in a row before it counts.
import { DETECTION_RULES, NEAR_OBJECT_MIN_AREA, findDetectionRule, normalizePrediction } from "./environmentScan.js";

// Categories watched during the exam and the violation type each records. People are handled by face monitoring.
export const LIVE_OBJECT_CATEGORIES = {
  phone: { type: "PHONE_DETECTED", label: "Phone" },
  tablet: { type: "PHONE_DETECTED", label: "Tablet" },
  laptop: { type: "GADGET_DETECTED", label: "Laptop" },
  calculator: { type: "GADGET_DETECTED", label: "Calculator" },
  smartwatch: { type: "GADGET_DETECTED", label: "Smartwatch" },
  notes: { type: "NOTES_DETECTED", label: "Notes or papers" },
  book: { type: "NOTES_DETECTED", label: "Book" },
};

// A guessing detector's sighting counts after this many of its checks in a row.
export const LIVE_GUESS_CONFIRM_SAMPLES = 2;
// A violation event ends only after this many clean checks in a row (by a detector that can see the item), so a
// phone that stays in view is one violation, not one per second.
export const LIVE_CLEAR_SAMPLES = 3;

// Best confidence per watched category in one sample, split by trusted and guessing detectors.
// Papers and books smaller than a small share of the picture are a shelf in the background, not in the student's hand.
export function getLiveSampleConfidences(predictions = []) {
  const reliable = {};
  const guess = {};
  predictions.forEach((raw) => {
    const prediction = normalizePrediction(raw);
    const rule = prediction && findDetectionRule(prediction.label);
    if (!rule || !LIVE_OBJECT_CATEGORIES[rule.category] || prediction.confidence < rule.floor) return;
    if (rule.nearOnly && prediction.areaRatio !== null && prediction.areaRatio < NEAR_OBJECT_MIN_AREA) return;
    const target = prediction.guess ? guess : reliable;
    target[rule.category] = Math.max(target[rule.category] || 0, prediction.confidence);
  });
  return { reliable, guess };
}

function getRule(category) {
  return DETECTION_RULES.find((rule) => rule.category === category);
}

// Stateful monitor. observe() takes { ok: true, predictions, guessChecked } for a successful detector run (where
// guessChecked says whether the guessing detector looked at this sample) or { ok: false } for a technical failure,
// and returns actions:
//   { type: "violation", category, violationType, confidence, message } - once per continuous event
//   { type: "cleared", category, violationType } - the event ended; a later detection is a new event
// There is no warning step: a sighting either becomes a violation or is ignored.
// Technical failures change nothing: they neither confirm, extend nor clear an event.
export function createLiveObjectMonitor() {
  const state = Object.fromEntries(Object.keys(LIVE_OBJECT_CATEGORIES).map((category) => [category, { active: false, bySeenGuess: false, guessStreak: 0, cleanStreak: 0 }]));

  return {
    observe(sample) {
      if (!sample?.ok || !Array.isArray(sample.predictions)) return [];
      const { reliable, guess } = getLiveSampleConfidences(sample.predictions);
      const guessChecked = Boolean(sample.guessChecked);
      const actions = [];

      Object.entries(state).forEach(([category, entry]) => {
        const rule = getRule(category);
        const { label, type } = LIVE_OBJECT_CATEGORIES[category];
        const reliableConfidence = reliable[category] || 0;
        const guessConfidence = guess[category] || 0;

        if (entry.active) {
          // Only a check that could have seen the item counts as clean: the guessing detector runs less often, and
          // the trained detectors cannot see paper, so an event it started only clears on its own checks.
          const seen = reliableConfidence > 0 || guessConfidence > 0;
          const couldSee = entry.bySeenGuess ? guessChecked : true;
          if (seen) entry.cleanStreak = 0;
          else if (couldSee) entry.cleanStreak += 1;
          if (entry.cleanStreak >= LIVE_CLEAR_SAMPLES) {
            Object.assign(entry, { active: false, bySeenGuess: false, guessStreak: 0, cleanStreak: 0 });
            actions.push({ type: "cleared", category, violationType: type });
          }
          return;
        }

        if (guessChecked) entry.guessStreak = guessConfidence >= rule.flag ? entry.guessStreak + 1 : 0;
        const reliableHit = reliableConfidence >= rule.flag;
        const guessHit = entry.guessStreak >= LIVE_GUESS_CONFIRM_SAMPLES;
        if (!reliableHit && !guessHit) return;

        const confidence = reliableHit ? reliableConfidence : guessConfidence;
        Object.assign(entry, { active: true, bySeenGuess: !reliableHit, guessStreak: 0, cleanStreak: 0 });
        actions.push({ type: "violation", category, violationType: type, confidence, message: `${label} detected in camera view (${Math.round(confidence * 100)}%).` });
      });

      return actions;
    },
    activeTypes() {
      return new Set(Object.entries(state).filter(([, entry]) => entry.active).map(([category]) => LIVE_OBJECT_CATEGORIES[category].type));
    },
  };
}
