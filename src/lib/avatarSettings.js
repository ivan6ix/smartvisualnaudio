export const AVATAR_BUCKET = "profile-pictures";
export const AVATAR_OUTPUT_MIME_TYPE = "image/png";
export const AVATAR_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function buildAvatarPath(userId) {
  if (!userId) throw new Error("User ID is required for avatar storage.");
  return `${userId}/avatar.png`;
}

export function getAvatarFileValidationError(file) {
  if (!file?.type?.startsWith("image/")) return "Please upload an image file.";
  if (file.size > AVATAR_MAX_FILE_SIZE_BYTES) return "Profile picture must be 5MB or smaller.";
  return "";
}
