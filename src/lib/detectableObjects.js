// Objects a professor can turn on or off for each exam. An item that is on is looked for by the environment scan
// and the live camera, and counts as a violation when seen. An item that is off is ignored completely.
// Another person is not listed: it is always checked.
// Saved in exam_settings.detectObjects as the list of items that are on. Exams saved before this setting existed
// have no list, so every item stays on for them.
export const DETECTABLE_OBJECTS = [
  { category: "phone", label: "Phone" },
  { category: "tablet", label: "Tablet" },
  { category: "laptop", label: "Laptop" },
  { category: "calculator", label: "Calculator" },
  { category: "smartwatch", label: "Smartwatch" },
  { category: "second_screen", label: "Second monitor or TV" },
  { category: "notes", label: "Notes or papers" },
  { category: "book", label: "Book" },
];

export const ALL_DETECTABLE_CATEGORIES = DETECTABLE_OBJECTS.map((item) => item.category);
const KNOWN = new Set(ALL_DETECTABLE_CATEGORIES);

// The items that are on, in the list's order. Anything that is not a list means "every item".
export function normalizeDetectObjects(value) {
  if (!Array.isArray(value)) return [...ALL_DETECTABLE_CATEGORIES];
  const chosen = new Set(value.map((item) => String(item)).filter((item) => KNOWN.has(item)));
  return ALL_DETECTABLE_CATEGORIES.filter((category) => chosen.has(category));
}

// Whether a detection category counts. Categories outside the list (another person) always count, and so does
// everything when no list is given.
export function isObjectDetected(enabledCategories, category) {
  if (!Array.isArray(enabledCategories) || !KNOWN.has(category)) return true;
  return enabledCategories.includes(category);
}

// Turns one item on or off, keeping the list's order.
export function toggleDetectObject(enabledCategories, category) {
  const current = normalizeDetectObjects(enabledCategories);
  const next = current.includes(category) ? current.filter((item) => item !== category) : [...current, category];
  return normalizeDetectObjects(next);
}

// Labels of the items that are off, which students may keep with them.
export function allowedObjectLabels(enabledCategories) {
  const enabled = normalizeDetectObjects(enabledCategories);
  return DETECTABLE_OBJECTS.filter((item) => !enabled.includes(item.category)).map((item) => item.label);
}
