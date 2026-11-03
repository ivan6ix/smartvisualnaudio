export const PASSWORD_MIN_LENGTH = 6;

// Set on accounts the Admin creates or resets (their password is known to the Admin). Cleared in the same
// request that sets the user's own password.
export const MUST_CHANGE_PASSWORD_KEY = "must_change_password";

export function mustChangePassword(authUser) {
  return authUser?.user_metadata?.[MUST_CHANGE_PASSWORD_KEY] === true;
}

export function updateOwnPassword(supabase, newPassword) {
  return supabase.auth.updateUser({ password: newPassword, data: { [MUST_CHANGE_PASSWORD_KEY]: false } });
}

export function validateNewPassword({ newPassword, confirmPassword }) {
  if (!newPassword || !confirmPassword) return "Enter and confirm your new password.";
  if (newPassword.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`;
  if (newPassword !== confirmPassword) return "Passwords do not match.";
  return "";
}

export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }) {
  if (!currentPassword || !newPassword || !confirmPassword) return "Current password, new password, and confirmation are required.";
  if (newPassword.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`;
  if (newPassword !== confirmPassword) return `Use at least ${PASSWORD_MIN_LENGTH} characters and matching passwords.`;
  return "";
}

export async function changeAuthenticatedPassword({ supabase, email, currentPassword, newPassword, confirmPassword }) {
  const validationError = validatePasswordChange({ currentPassword, newPassword, confirmPassword });
  if (validationError) return { ok: false, error: validationError };
  if (!supabase || !email) return { ok: false, error: "Unable to verify your current password. Please log in again." };

  const verification = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (verification.error) {
    return { ok: false, error: "Current password could not be verified." };
  }

  const update = await updateOwnPassword(supabase, newPassword);
  if (update.error) return { ok: false, error: update.error.message || "Unable to update password." };

  return { ok: true };
}
