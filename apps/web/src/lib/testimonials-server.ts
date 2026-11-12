// The "Operators building on Drive247" quotes on the landing page.
//
// Managed by super admins on Customer management → Testimonials and stored in
// `operator_testimonials`; anon can read the published rows (RLS), so this is a
// plain PostgREST GET with the public key.
//
// READ FRESH ON EVERY REQUEST: the landing page already
// renders per request, and an admin who edits a quote expects to see it on the
// next reload.
//
// FAILS SOFT. On missing env, an HTTP error or a timeout the section shows the
// built-in quotes it shipped with (`TESTIMONIALS` in constants) rather than
// vanishing. A successful read that returns no rows means the admins have
// unpublished everything, and the section is hidden.

import { TESTIMONIALS } from "@/lib/constants";

// The page waits this long for the quotes. 1.5s timed out often from a dev machine.
const FETCH_TIMEOUT_MS = 4000;

/*
 * The last quotes read, kept for this server process: a slow or failed read shows them
 * rather than jumping back to the built-in ones. A failure is a quiet one-line warning,
 * not an error: it is handled, and a logged error became a permanent issue in the Next.js
 * dev overlay (with the whole DOMException printed under it).
 */
let lastGood: Testimonial[] | null = null;
const fallBack = (why: string) => {
  console.warn(`[testimonials] ${why}; showing ${lastGood ? "the last quotes read" : "the built-in quotes"}.`);
  return lastGood ?? FALLBACK_TESTIMONIALS;
};

export interface Testimonial {
  id: string;
  name: string;
  initials: string;
  role: string | null;
  fleetSize: string | null;
  location: string | null;
  stars: number;
  before: string;
  bold: string;
  after: string;
}

interface Row {
  id: string;
  operator_name: string;
  role: string | null;
  fleet_size: number | null;
  location: string | null;
  rating: number;
  quote: string;
  highlight: string | null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** Bold the first occurrence of `highlight` inside `quote`; plain if absent. */
function splitQuote(quote: string, highlight: string | null) {
  const h = highlight?.trim();
  const at = h ? quote.indexOf(h) : -1;
  if (!h || at < 0) return { before: quote, bold: "", after: "" };
  return { before: quote.slice(0, at), bold: h, after: quote.slice(at + h.length) };
}

/*
 * Text saved through a mis-set encoding comes back with UTF-8 read as Windows-1252
 * ("Setup was painless â€” we were live"). Put the usual punctuation back.
 */
const MOJIBAKE: [RegExp, string][] = [
  [/â€”/g, "—"],
  [/â€“/g, "–"],
  [/â€™/g, "’"],
  [/â€˜/g, "‘"],
  [/â€œ/g, "“"],
  [/â€[\u009d�"]/g, "”"],
  [/â€¦/g, "…"],
  [/Â(?=\s)/g, ""],
];
const repair = (text: string) => MOJIBAKE.reduce((t, [bad, good]) => t.replace(bad, good), text);

/*
 * Every quote kept short (user, 2026-11-12: "testimonials are this much, don't write large
 * ones"): no more than about the Miami quote's length. The highlighted words always stay,
 * with the rest of their sentence; whole sentences either side are added back, nearest
 * first, while they fit.
 */
const QUOTE_MAX = 140;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
export function shortenQuote(q: { before: string; bold: string; after: string }) {
  const total = q.before + q.bold + q.after;
  if (total.length <= QUOTE_MAX) return q;
  if (!q.bold) {
    const parts = sentences(q.before.trim());
    let kept = parts[0] ?? q.before;
    for (const s of parts.slice(1)) {
      if ((kept + " " + s).length > QUOTE_MAX) break;
      kept += " " + s;
    }
    return { before: kept, bold: "", after: "" };
  }
  // The highlight's own sentence: the unfinished tail of what comes before it and the
  // unfinished head of what follows.
  const beforeParts = sentences(q.before);
  const afterParts = sentences(q.after.trimStart());
  const lead = /[.!?]\s*$/.test(q.before) || !q.before.trim() ? "" : beforeParts.pop() ?? "";
  const tail = /^[.!?]/.test(q.after.trimStart()) || /[.!?]\s*$/.test(q.bold) ? "" : afterParts.shift() ?? "";
  let before = lead ? lead + (q.before.endsWith(" ") ? " " : "") : "";
  let after = tail ? (q.after.startsWith(" ") ? " " : "") + tail : "";
  const size = () => (before + q.bold + after).length;
  while (afterParts.length || beforeParts.length) {
    const next = afterParts[0];
    if (next && size() + next.length + 1 <= QUOTE_MAX) {
      after += " " + afterParts.shift();
      continue;
    }
    const prev = beforeParts[beforeParts.length - 1];
    if (prev && size() + prev.length + 1 <= QUOTE_MAX) {
      before = beforeParts.pop() + " " + before;
      continue;
    }
    break;
  }
  return { before, bold: q.bold, after };
}

function fromRow(r: Row): Testimonial {
  return {
    id: r.id,
    name: r.operator_name,
    initials: initialsOf(r.operator_name),
    role: r.role,
    fleetSize: r.fleet_size ? `${r.fleet_size}-vehicle fleet` : null,
    location: r.location,
    stars: Math.min(5, Math.max(1, r.rating)),
    ...shortenQuote(splitQuote(repair(r.quote), r.highlight ? repair(r.highlight) : null)),
  };
}

export const FALLBACK_TESTIMONIALS: Testimonial[] = TESTIMONIALS.map((t) => ({ id: t.name, ...t, ...shortenQuote(t) }));

export async function fetchTestimonials(): Promise<Testimonial[]> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) return FALLBACK_TESTIMONIALS;

  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/v1/operator_testimonials` +
        "?select=id,operator_name,role,fleet_size,location,rating,quote,highlight" +
        "&is_published=eq.true&order=sort_order.asc,created_at.asc",
      {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!res.ok) return fallBack(`read failed (HTTP ${res.status})`);
    const rows = (await res.json()) as Row[];
    if (!Array.isArray(rows)) return fallBack("read returned no list");
    lastGood = rows.map(fromRow);
    return lastGood;
  } catch (error) {
    const why = error instanceof Error && error.name === "TimeoutError" ? `read took over ${FETCH_TIMEOUT_MS / 1000}s` : `read failed (${error instanceof Error ? error.message : String(error)})`;
    return fallBack(why);
  }
}
