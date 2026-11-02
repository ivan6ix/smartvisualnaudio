// Supabase's API returns at most 1000 rows per request (its "max rows" setting), whatever .limit() asks for, so a
// large table read in one request is silently cut off. This reads every row: the first page asks for an exact
// count, then the remaining pages load in parallel.
//
// buildQuery(selectOptions) must return a fresh query whose .select(columns, selectOptions) receives the options
// and whose order is stable (end with a unique column such as id), so pages neither overlap nor skip rows.
export const ROWS_PER_REQUEST = 1000;

export async function fetchAllRows(buildQuery, { pageSize = ROWS_PER_REQUEST, maxRows = 100000 } = {}) {
  const first = await buildQuery({ count: "exact" }).range(0, pageSize - 1);
  if (first.error) return { data: null, error: first.error };
  const rows = [...(first.data || [])];
  const total = Math.min(maxRows, Number.isFinite(first.count) ? first.count : rows.length);
  if (total <= rows.length) return { data: rows, error: null };

  const pages = [];
  for (let from = pageSize; from < total; from += pageSize) {
    pages.push(buildQuery(undefined).range(from, Math.min(total, from + pageSize) - 1));
  }
  for (const page of await Promise.all(pages)) {
    if (page.error) return { data: null, error: page.error };
    rows.push(...(page.data || []));
  }
  return { data: rows, error: null };
}
