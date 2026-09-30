import assert from "node:assert/strict";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_FILE_SIZE_BYTES,
  AVATAR_OUTPUT_MIME_TYPE,
  buildAvatarPath,
  getAvatarFileValidationError,
} from "../src/lib/avatarSettings.js";
import { changeAuthenticatedPassword } from "../src/lib/settingsSecurity.js";
import { getProfileMenuRoutes } from "../src/lib/profileMenuRoutes.js";

const expectedRoutes = {
  Admin: { profile: "/profile", security: "/security", notifications: "/notifications" },
  Professor: { profile: "/professor/profile", security: "/professor/security", notifications: "/professor/notifications" },
  Student: { profile: "/student/profile", security: "/student/security", notifications: "/student/notifications" },
  "Cluster Professor": { profile: "/cluster/profile", security: "/cluster/security", notifications: "/cluster/notifications" },
  Dean: { profile: "/dean/profile", security: "/dean/security", notifications: "/dean/notifications" },
};

for (const [role, routes] of Object.entries(expectedRoutes)) {
  assert.deepEqual(getProfileMenuRoutes(role), routes);
}
assert.deepEqual(getProfileMenuRoutes("Unknown"), expectedRoutes.Admin);

assert.equal(AVATAR_BUCKET, "profile-pictures");
assert.equal(AVATAR_OUTPUT_MIME_TYPE, "image/png");
assert.equal(AVATAR_MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
assert.equal(buildAvatarPath("user-123"), "user-123/avatar.png");
assert.throws(() => buildAvatarPath(""), /User ID is required/);
assert.equal(getAvatarFileValidationError({ type: "image/jpeg", size: 1024 }), "");
assert.equal(getAvatarFileValidationError({ type: "text/plain", size: 1024 }), "Please upload an image file.");
assert.equal(getAvatarFileValidationError({ type: "image/png", size: AVATAR_MAX_FILE_SIZE_BYTES + 1 }), "Profile picture must be 5MB or smaller.");

{
  const calls = [];
  const supabase = {
    auth: {
      signInWithPassword: async (credentials) => {
        calls.push(["verify", credentials.email, credentials.password]);
        return { error: { message: "Invalid login credentials" } };
      },
      updateUser: async () => {
        calls.push(["update"]);
        return { error: null };
      },
    },
  };
  const result = await changeAuthenticatedPassword({
    supabase,
    email: "person@example.edu",
    currentPassword: "wrong-current",
    newPassword: "new-secret",
    confirmPassword: "new-secret",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /current password/i);
  assert.deepEqual(calls, [["verify", "person@example.edu", "wrong-current"]]);
}

{
  const calls = [];
  const supabase = {
    auth: {
      signInWithPassword: async (credentials) => {
        calls.push(["verify", credentials.email, credentials.password]);
        return { error: null };
      },
      updateUser: async (payload) => {
        calls.push(["update", Object.keys(payload), payload.password]);
        return { error: null };
      },
    },
  };
  const result = await changeAuthenticatedPassword({
    supabase,
    email: "person@example.edu",
    currentPassword: "current-secret",
    newPassword: "new-secret",
    confirmPassword: "new-secret",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ["verify", "person@example.edu", "current-secret"],
    ["update", ["password"], "new-secret"],
  ]);
}

{
  const supabase = {
    auth: {
      signInWithPassword: async () => {
        throw new Error("verification should not run");
      },
    },
  };
  const result = await changeAuthenticatedPassword({
    supabase,
    email: "person@example.edu",
    currentPassword: "current-secret",
    newPassword: "long-enough",
    confirmPassword: "different",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /matching passwords/i);
}
