// Deactivated accounts may not sign in or keep using the system.

export const DEACTIVATED_ACCOUNT_MESSAGE = "This account has been deactivated. Contact the administrator to reactivate it.";

export function isDeactivatedStatus(status) {
  return String(status || "").trim().toLowerCase() === "deactivated";
}

// Supabase Auth refuses an account the administrator deactivated (it is banned) with "User is banned".
export function signInErrorMessage(error) {
  const message = String(error?.message || "");
  if (error?.code === "user_banned" || /user is banned/i.test(message)) return DEACTIVATED_ACCOUNT_MESSAGE;
  return message || "Sign-in failed. Try again.";
}
