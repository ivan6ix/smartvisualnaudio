import assert from 'node:assert/strict';

const helpers = await import('../src/lib/violationAlerts.js');

assert.equal(helpers.VIOLATION_ALERT_DURATION_MS, 3000);
assert.equal(helpers.MAX_VIOLATION_ALERTS, 4);

assert.equal(helpers.formatViolationType('fullscreen_exit'), 'Fullscreen Exit');
assert.equal(helpers.formatViolationType('tab_switch'), 'Tab Switch');
assert.equal(helpers.formatViolationType('unknown_new_type'), 'Unknown New Type');

assert.doesNotThrow(() => helpers.playViolationAlertSound({}));
