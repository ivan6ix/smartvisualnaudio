import assert from "node:assert/strict";
import {
  CARD_PAGE_SIZE,
  DENSITIES,
  getListPageSlice,
  getListPreferenceKeys,
  readStoredListValue,
  normalizeDensity,
  normalizeListView,
  TABLE_PAGE_SIZE,
  toNextListPage,
  writeStoredListValue,
} from "../src/lib/listView.js";

function createStorage(shouldThrow = false) {
  const values = new Map();
  return {
    getItem(key) {
      if (shouldThrow) throw new Error("blocked");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (shouldThrow) throw new Error("blocked");
      values.set(key, value);
    },
  };
}

assert.equal(normalizeListView("cards", "table"), "cards");
assert.equal(normalizeListView("table", "cards"), "table");
assert.equal(normalizeListView("bad", "table"), "table");
assert.equal(normalizeDensity("comfortable"), "comfortable");
assert.equal(normalizeDensity("compact"), "compact");
assert.equal(normalizeDensity("dense"), "dense");
assert.equal(normalizeDensity("giant"), "compact");
assert.deepEqual(DENSITIES, ["comfortable", "compact", "dense"]);

assert.equal(CARD_PAGE_SIZE, 12);
assert.equal(TABLE_PAGE_SIZE, 20);
assert.equal(toNextListPage({ currentPage: 3, currentPageSize: 12, nextPageSize: 20, totalItems: 80 }), 2);
assert.equal(toNextListPage({ currentPage: 2, currentPageSize: 20, nextPageSize: 12, totalItems: 80 }), 2);
assert.equal(toNextListPage({ currentPage: 99, currentPageSize: 12, nextPageSize: 20, totalItems: 3 }), 1);
assert.equal(toNextListPage({ currentPage: 4, currentPageSize: 20, nextPageSize: 12, totalItems: 0 }), 1);

const page = getListPageSlice(Array.from({ length: 25 }, (_, index) => index), 3, 12);
assert.equal(page.page, 3);
assert.equal(page.totalPages, 3);
assert.deepEqual(page.rows, [24]);

const professorCourses = getListPreferenceKeys("professor", "courses");
const professorExams = getListPreferenceKeys("professor", "exams");
const studentCourses = getListPreferenceKeys("student", "courses");
assert.notEqual(professorCourses.view, professorExams.view);
assert.notEqual(professorCourses.view, studentCourses.view);
assert.equal(professorCourses.view, "smart-proctoring:list-view:professor:courses");
assert.equal(professorCourses.cardDensity, "smart-proctoring:card-density:professor:courses");
assert.equal(professorCourses.tableDensity, "smart-proctoring:table-density:professor:courses");

const storage = createStorage();
storage.setItem(professorCourses.view, "cards");
storage.setItem(professorCourses.cardDensity, "dense");
storage.setItem(professorCourses.tableDensity, "comfortable");
assert.equal(storage.getItem(professorCourses.view), "cards");
assert.equal(storage.getItem(professorCourses.cardDensity), "dense");
assert.equal(storage.getItem(professorCourses.tableDensity), "comfortable");
assert.equal(readStoredListValue(createStorage(true), "x", "fallback"), "fallback");
assert.doesNotThrow(() => writeStoredListValue(createStorage(true), "x", "cards"));
