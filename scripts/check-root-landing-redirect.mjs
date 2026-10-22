/* global console, URL */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const protectedRoute = readFileSync(new URL("../src/routes/ProtectedRoute.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

assert.match(protectedRoute, /<Navigate to=\{pathname === "\/" \? "\/landing" : "\/login"\} replace \/>/, "Signed-out visits to the bare domain must open the landing page; other protected paths go to sign in.");
assert.match(app, /<Route path="\/landing" element=\{<LandingPage \/>\} \/>/, "The landing route must stay public.");

console.log("root landing redirect ok");
