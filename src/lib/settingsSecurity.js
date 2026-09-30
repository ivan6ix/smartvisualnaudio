export const PASSWORD_MIN_LENGTH = 6;

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

  const update = await supabase.auth.updateUser({ password: newPassword });
  if (update.error) return { ok: false, error: update.error.message || "Unable to update password." };

  return { ok: true };
}
