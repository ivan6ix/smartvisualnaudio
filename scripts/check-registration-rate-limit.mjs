import assert from "node:assert/strict";

import {
  REGISTRATION_DEVICE_EMAIL_LIMIT,
  getRegistrationLimitStatus,
  recordRegistrationEmail,
} from "../src/lib/registrationRateLimit.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const storage = createStorage();

assert.equal(REGISTRATION_DEVICE_EMAIL_LIMIT, 10);
assert.deepEqual(getRegistrationLimitStatus(storage, "first@student.edu"), {
  allowed: true,
  remaining: 10,
});

for (let index = 1; index <= 10; index += 1) {
  recordRegistrationEmail(storage, `Student${index}@Example.edu`);
}

assert.deepEqual(getRegistrationLimitStatus(storage, "student5@example.edu"), {
  allowed: true,
  remaining: 0,
});
assert.deepEqual(getRegistrationLimitStatus(storage, "student11@example.edu"), {
  allowed: false,
  remaining: 0,
});

recordRegistrationEmail(storage, "student5@example.edu");
assert.deepEqual(getRegistrationLimitStatus(storage, "student11@example.edu"), {
  allowed: false,
  remaining: 0,
});

assert.deepEqual(getRegistrationLimitStatus(createStorage({ "smartvisualnaudio.registration.device-v1": "not-json" }), "fresh@example.edu"), {
  allowed: true,
  remaining: 10,
});
