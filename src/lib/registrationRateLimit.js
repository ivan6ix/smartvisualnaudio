export const REGISTRATION_DEVICE_EMAIL_LIMIT = 10;

const REGISTRATION_DEVICE_STORAGE_KEY = "smartvisualnaudio.registration.device-v1";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function readDeviceRegistration(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(REGISTRATION_DEVICE_STORAGE_KEY) || "{}");
    return Array.isArray(parsed.emails) ? parsed.emails.map(normalizeEmail).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeDeviceRegistration(storage, emails) {
  storage.setItem(
    REGISTRATION_DEVICE_STORAGE_KEY,
    JSON.stringify({
      emails: [...new Set(emails.map(normalizeEmail).filter(Boolean))],
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function getRegistrationLimitStatus(storage, email) {
  if (!storage) return { allowed: true, remaining: REGISTRATION_DEVICE_EMAIL_LIMIT };

  const normalizedEmail = normalizeEmail(email);
  const emails = [...new Set(readDeviceRegistration(storage))];
  const alreadyRegistered = normalizedEmail && emails.includes(normalizedEmail);
  const remaining = Math.max(REGISTRATION_DEVICE_EMAIL_LIMIT - emails.length, 0);

  return {
    allowed: alreadyRegistered || emails.length < REGISTRATION_DEVICE_EMAIL_LIMIT,
    remaining,
  };
}

export function recordRegistrationEmail(storage, email) {
  if (!storage) return;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const emails = readDeviceRegistration(storage);
  if (emails.includes(normalizedEmail)) return;
  writeDeviceRegistration(storage, [...emails, normalizedEmail]);
}
