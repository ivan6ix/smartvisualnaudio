import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAssignedProfessorLabel,
  isCanonicalProfessorId,
} from "../src/lib/courseOwnership.js";

const uuid = "ceae50b6-ee07-4e51-99e1-b2b2204b7018";

assert.equal(isCanonicalProfessorId(uuid), true);
assert.equal(isCanonicalProfessorId("Professor Name"), false);
assert.equal(isCanonicalProfessorId("professor@example.com"), false);

assert.equal(
  buildAssignedProfessorLabel({ name: "Ivan Caburnay", email: "ivan@example.com", employeeNumber: "EMP-1" }),
  "Ivan Caburnay - EMP-1 - ivan@example.com",
);
assert.equal(
  buildAssignedProfessorLabel({ full_name: "Mark Wilson", email: "mark@example.com" }),
  "Mark Wilson - mark@example.com",
);
assert.equal(
  buildAssignedProfessorLabel({ email: "prof@example.com" }),
  "prof@example.com",
);

const coursesPage = readFileSync("src/pages/Courses.jsx", "utf8");
assert.ok(coursesPage.includes("buildAssignedProfessorLabel"), "Admin course form should render disambiguated professor labels.");
assert.ok(coursesPage.includes('queryKey: ["professor-courses", professorId]'), "Admin course creation should invalidate the assigned professor course query.");
assert.ok(coursesPage.includes('queryKey: ["professor-dashboard", professorId]'), "Admin course creation should invalidate the assigned professor dashboard query.");
