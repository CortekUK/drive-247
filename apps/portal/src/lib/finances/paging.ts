/**
 * Read every row, never a truncated page. Pure (the caller hands in the query).
 *
 * PostgREST answers at most 1,000 rows per request. A total computed from the
 * first page of a busy tenant's ledger is silently wrong — so every Finances
 * read goes through `fetchAllPages`, which asks for `.range(from, to)` until a
 * page comes back short. The query MUST have a stable order (the loader orders
 * by `id`), or rows can move between pages while they are read.
 *
 * supabase-js never throws: a page's `{ error }` is turned into a thrown Error
 * here, so a failed read becomes an error state and never a zero.
 */

export const PAGE_SIZE = 1000;

/** Refuse to total more than this many rows of one read rather than take minutes to do it. */
export const MAX_ROWS = 200_000;

/** Ids per `.in()` filter: keeps a request URL well under the proxy limit (use-payment-plan uses 80). */
export const ID_CHUNK = 80;

export type PageResult<T> = { data: T[] | null; error: unknown };
export type PageFetcher<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

/**
 * One failed read. `message` is the sentence ("Could not load payments: …");
 * the fields carry what PostgREST said, so a development build can show the
 * exact read and error (`devText`) instead of a generic failure.
 */
export class FinanceLoadError extends Error {
  /** Which read failed — "payments", "payment allocations", … */
  readonly label: string;
  /** PostgREST / Postgres code: '42703' (no such column), 'PGRST205' (no such table), '57014' (timeout)… */
  readonly code: string | null;
  /** PostgREST's own message. */
  readonly pgMessage: string;
  readonly details: string | null;
  readonly hint: string | null;
  readonly cause: unknown;
  constructor(label: string, cause: unknown) {
    const e = (cause && typeof cause === "object" ? cause : {}) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const pgMessage = typeof e.message === "string" && e.message ? e.message : String(cause);
    super(`Could not load ${label}: ${pgMessage}`);
    this.name = "FinanceLoadError";
    this.label = label;
    this.code = typeof e.code === "string" && e.code ? e.code : null;
    this.pgMessage = pgMessage;
    this.details = typeof e.details === "string" && e.details ? e.details : null;
    this.hint = typeof e.hint === "string" && e.hint ? e.hint : null;
    this.cause = cause;
  }

  /** "payments — 42703: column payments.x does not exist (details) [hint]", for a development error panel. */
  get devText(): string {
    return [
      `${this.label} — ${this.code ? `${this.code}: ` : ""}${this.pgMessage}`,
      this.details ? `(${this.details})` : "",
      this.hint ? `[${this.hint}]` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
}

export async function fetchAllPages<T>(
  label: string,
  fetchPage: PageFetcher<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new FinanceLoadError(label, error);
    const page = data ?? [];
    for (const r of page) rows.push(r);
    if (page.length < pageSize) return rows;
    if (rows.length >= maxRows) {
      throw new FinanceLoadError(label, `more than ${maxRows} rows — refusing to total a partial read`);
    }
  }
}

export function chunk<T>(items: T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Read rows by id, `ID_CHUNK` ids per request, every chunk paged in full.
 * Chunks run a few at a time. Duplicate and empty ids are dropped first.
 */
export async function fetchAllByIds<T>(
  label: string,
  ids: Iterable<string | null | undefined>,
  fetchChunk: (ids: string[]) => PageFetcher<T>,
  opts: { chunkSize?: number; concurrency?: number } = {},
): Promise<T[]> {
  const unique = Array.from(new Set(Array.from(ids).filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (unique.length === 0) return [];
  const chunks = chunk(unique, opts.chunkSize ?? ID_CHUNK);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const out: T[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = await Promise.all(chunks.slice(i, i + concurrency).map((c) => fetchAllPages(label, fetchChunk(c))));
    for (const rows of batch) for (const r of rows) out.push(r);
  }
  return out;
}
