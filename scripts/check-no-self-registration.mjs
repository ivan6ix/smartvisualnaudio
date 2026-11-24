/* global console */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Students no longer create their own accounts: the administrator creates every account (one at a time or
// through Bulk Register), so the sign-in screens point to the administrator instead of a registration page.
assert.equal(existsSync("src/pages/Register.jsx"), false, "The self-registration page is removed.");
assert.equal(existsSync("src/lib/registrationRateLimit.js"), false, "The registration rate limit went with the page.");

const app = readFileSync("src/App.jsx", "utf8");
assert.doesNotMatch(app, /pages\/Register/, "App must not load the removed registration page.");
assert.match(app, /<Route path="\/register" element=\{<Navigate to="\/login" replace \/>\} \/>/, "Old /register links land on sign in.");

const auth = readFileSync("src/context/AuthContext.jsx", "utf8");
assert.doesNotMatch(auth, /auth\.signUp\(/, "The app must not sign users up itself.");
assert.doesNotMatch(auth, /\bregister\b/, "AuthContext no longer offers register().");

for (const file of ["src/pages/Login.jsx", "src/components/landing/SignInDialog.jsx", "src/components/landing/LandingPage.jsx", "src/components/landing/content.js"]) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /\/register/, `${file} must not link to a registration page.`);
  assert.doesNotMatch(source, /Create (an )?account/i, `${file} must not offer to create an account.`);
}
for (const file of ["src/pages/Login.jsx", "src/components/landing/SignInDialog.jsx"]) {
  assert.match(readFileSync(file, "utf8"), /No account yet\? Your administrator creates accounts for students and staff\./, `${file} tells people who creates accounts.`);
}
assert.match(readFileSync("src/components/landing/content.js", "utf8"), /account your institution's administrator created for you/);

console.log("No self-registration checks passed.");
