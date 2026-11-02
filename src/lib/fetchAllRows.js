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

// Looking rows up by a list of ids puts every id in the request address, which grows about 40 characters per id
// and is rejected when too long. This splits the ids into batches (each read in full) that load in parallel.
// buildQuery(batchIds, selectOptions) returns a fresh query for one batch, ordered by a unique column.
export const IDS_PER_REQUEST = 200;

export async function fetchRowsByIds(ids, buildQuery, { batchSize = IDS_PER_REQUEST } = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { data: [], error: null };
  const batches = [];
  for (let start = 0; start < unique.length; start += batchSize) batches.push(unique.slice(start, start + batchSize));
  const results = await Promise.all(batches.map((batch) => fetchAllRows((options) => buildQuery(batch, options))));
  const rows = [];
  for (const result of results) {
    if (result.error) return { data: null, error: result.error };
    rows.push(...result.data);
  }
  return { data: rows, error: null };
}
