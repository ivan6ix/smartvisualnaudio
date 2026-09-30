import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notificationBell = readFileSync('src/components/NotificationBell.jsx', 'utf8');
const professorLayout = readFileSync('src/pages/professor/ProfessorLayout.jsx', 'utf8');
const professorScores = readFileSync('src/pages/professor/ProfessorScores.jsx', 'utf8');
const styles = readFileSync('src/styles.css', 'utf8');

assert.ok(
  !notificationBell.includes('View all'),
  'Notification dropdown should not include the redundant View all action.',
);
assert.ok(
  notificationBell.includes('Mark all read'),
  'Notification dropdown should keep a compact Mark all read action.',
);
assert.ok(
  notificationBell.includes('notification-item-copy'),
  'Notification item title/message copy should be grouped separately from metadata.',
);

assert.ok(
  professorLayout.includes('ProfessorViolationAlerts'),
  'Professor layout should mount live violation alerts across the professor portal.',
);
assert.ok(
  !professorLayout.includes('.from("notifications")') && !professorLayout.includes(".from('notifications')"),
  'Live violation alerts must not write persistent notifications.',
);
assert.ok(
  professorLayout.includes('postgres_changes') && professorLayout.includes('table: "violations"'),
  'Professor live alerts should subscribe to inserted violations.',
);

assert.ok(
  professorScores.includes('ProfessorScoreExamCards'),
  'Professor Scores card view should use a scores-specific card layout.',
);
assert.ok(
  styles.includes('--professor-score-card-min'),
  'Professor Scores cards should define readable responsive min widths.',
);
assert.ok(
  styles.includes('html[data-theme="light"] .list-view-segment button.active'),
  'Light theme must explicitly style the active list-view segmented control.',
);
assert.ok(
  styles.includes('.notification-item-copy'),
  'Notification dropdown CSS should prevent copy compression.',
);
assert.ok(
  styles.includes('.professor-violation-toast'),
  'Professor live violation toast styles should exist.',
);
