import "server-only";

/**
 * The published Terms / Privacy document, read on the server.
 *
 * Structurally a copy of `lib/plans-server.ts`, and for the same reasons: an
 * anon-key PostgREST read, tagged for ISR rather than `no-store`, with a hard
 * timeout and a total refusal to throw.
 *
 * WHY IT NEVER THROWS
 * -------------------
 * `/terms` and `/privacy` are prerendered at build time. A function that throws
 * here fails `next build`, which means a Supabase blip — or simply this table
 * not existing yet — would take the whole marketing site down rather than one
 * page. Every failure path returns `null`, and every caller reads `null` as
 * "serve the document that is compiled into the bundle".
 *
 * That is also what makes this safe to ship before the table exists. Until
 * `ops/platform_legal_documents.sql` is applied, the read 404s, this returns
 * `null`, and both pages render exactly what they render today.
 *
 * NOT the tenant rental terms. Those live in `cms_pages` and are served
 * per-tenant by apps/booking — a different contract between a renter and an
 * operator, under A2P 10DLC carrier review. See the header of
 * `apps/booking/src/app/terms/page.tsx`.
 */

export type LegalDocumentSlug = "terms" | "privacy";

export interface LegalDocument {
  slug: LegalDocumentSlug;
  version: string;
  title: string;
  bodyMd: string;
  effectiveDate: string | null;
}

/**
 * Long, because legal copy changes a few times a year and every second here is
 * a second of cache hit on a page that is otherwise static. A super admin who
 * needs it live sooner can redeploy; that is a far better trade than making a
 * public page uncacheable for an edit that happens twice a year.
 */
const LEGAL_REVALIDATE_SECONDS = 3600;

/** Matches `plans-server.ts`. A slow read must not hold a build open. */
const FETCH_TIMEOUT_MS = 5000;

const COLUMNS = "slug,version,title,body_md,effective_date";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the row rather than trusting it.
 *
 * A published document with an empty body would render a blank legal page,
 * which is worse than rendering the previous one — so a row that fails this is
 * treated as absent and the caller falls back.
 */
function toDocument(row: unknown, slug: LegalDocumentSlug): LegalDocument | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;

  if (!isNonEmptyString(r.body_md)) return null;
  if (!isNonEmptyString(r.title)) return null;
  if (!isNonEmptyString(r.version)) return null;

  return {
    slug,
    version: r.version,
    title: r.title,
    bodyMd: r.body_md,
    effectiveDate: isNonEmptyString(r.effective_date) ? r.effective_date : null,
  };
}

export async function fetchLegalDocument(
  slug: LegalDocumentSlug,
): Promise<LegalDocument | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    // Not an error worth shouting about: a preview build without Supabase env
    // is a normal thing, and the compiled document is a complete answer.
    return null;
  }

  const endpoint =
    `${baseUrl.replace(/\/$/, "")}/rest/v1/platform_legal_documents` +
    `?select=${COLUMNS}&slug=eq.${slug}&is_published=is.true&limit=1`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: LEGAL_REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      // The body carries PostgREST's reason, which is the difference between
      // "table not created yet" and "the read policy is wrong". Both fall back;
      // only one of them is something to fix.
      const detail = await res.text().catch(() => "");
      console.error(
        `[legal] platform_legal_documents read failed for "${slug}" (HTTP ${res.status}) — ` +
          `serving the compiled document. ${detail.slice(0, 500)}`,
      );
      return null;
    }

    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;

    return toDocument(body[0], slug);
  } catch (error) {
    console.error(
      `[legal] platform_legal_documents read threw for "${slug}" — serving the ` +
        `compiled document.`,
      error,
    );
    return null;
  }
}
