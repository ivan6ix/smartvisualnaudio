/* global console, URL */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const protectedRoute = readFileSync(new URL("../src/routes/ProtectedRoute.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

assert.match(protectedRoute, /<Navigate to=\{pathname === "\/" \? "\/landing" : "\/login"\} replace \/>/, "Signed-out visits to the bare domain must open the landing page; other protected paths go to sign in.");
assert.match(app, /<Route path="\/landing" element=\{<SignedOutRoute><LandingPage \/><\/SignedOutRoute>\} \/>/, "The landing route stays public; signed-in users are sent to their dashboard.");
assert.match(app, /<Route path="\/login" element=\{<SignedOutRoute><Login \/><\/SignedOutRoute>\} \/>/, "Back from the dashboard must not show the sign-in page to a signed-in user.");

// Signing in replaces the sign-in page in the browser history, and a signed-in user never sees it again.
const signedOut = readFileSync(new URL("../src/routes/SignedOutRoute.jsx", import.meta.url), "utf8");
assert.match(signedOut, /hasLoggedInThisSession && user\) return <Navigate to=\{homeForRole\(user\.role\)\} replace \/>/);
for (const file of ["../src/pages/Login.jsx", "../src/components/landing/SignInDialog.jsx"]) {
  assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /navigate\(homeForRole\(signedInUser\?\.role\), \{ replace: true \}\)/, `${file} must replace the sign-in page in history.`);
}

console.log("root landing redirect ok");
