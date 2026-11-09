import assert from 'node:assert/strict';

const helpers = await import('../src/lib/violationAlerts.js');

assert.equal(helpers.VIOLATION_ALERT_DURATION_MS, 8000);
assert.equal(helpers.MAX_VIOLATION_ALERTS, 3);

// At most three pop-ups show; older ones become "+N more".
let stack = { alerts: [], hiddenCount: 0 };
for (const id of ['a', 'b', 'c']) stack = helpers.addViolationAlert(stack, { id });
assert.deepEqual(stack.alerts.map((alert) => alert.id), ['a', 'b', 'c']);
assert.equal(stack.hiddenCount, 0);
stack = helpers.addViolationAlert(stack, { id: 'd' });
stack = helpers.addViolationAlert(stack, { id: 'e' });
assert.deepEqual(stack.alerts.map((alert) => alert.id), ['c', 'd', 'e']);
assert.equal(stack.hiddenCount, 2);
stack = helpers.removeViolationAlert(stack, 'd');
assert.deepEqual(stack.alerts.map((alert) => alert.id), ['c', 'e']);
assert.equal(stack.hiddenCount, 2);
stack = helpers.removeViolationAlert(helpers.removeViolationAlert(stack, 'c'), 'e');
assert.deepEqual(stack, { alerts: [], hiddenCount: 0 });

assert.equal(helpers.describeViolationPlace({ examTitle: 'QWE3', courseCode: 'DYBITHci321', section: 'A' }), 'QWE3 · DYBITHci321 · Section A');
assert.equal(helpers.describeViolationPlace({}), 'Exam');

assert.equal(helpers.formatViolationType('fullscreen_exit'), 'Fullscreen Exit');
assert.equal(helpers.formatViolationType('tab_switch'), 'Tab Switch');
assert.equal(helpers.formatViolationType('unknown_new_type'), 'Unknown New Type');

assert.doesNotThrow(() => helpers.playViolationAlertSound({}));
