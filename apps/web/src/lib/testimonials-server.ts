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

const FETCH_TIMEOUT_MS = 1500;

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

function fromRow(r: Row): Testimonial {
  return {
    id: r.id,
    name: r.operator_name,
    initials: initialsOf(r.operator_name),
    role: r.role,
    fleetSize: r.fleet_size ? `${r.fleet_size}-vehicle fleet` : null,
    location: r.location,
    stars: Math.min(5, Math.max(1, r.rating)),
    ...splitQuote(r.quote, r.highlight),
  };
}

export const FALLBACK_TESTIMONIALS: Testimonial[] = TESTIMONIALS.map((t) => ({ id: t.name, ...t }));

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
    if (!res.ok) {
      console.error(`[testimonials] read failed (HTTP ${res.status}) — showing the built-in quotes.`);
      return FALLBACK_TESTIMONIALS;
    }
    const rows = (await res.json()) as Row[];
    return Array.isArray(rows) ? rows.map(fromRow) : FALLBACK_TESTIMONIALS;
  } catch (error) {
    console.error("[testimonials] read failed — showing the built-in quotes.", error);
    return FALLBACK_TESTIMONIALS;
  }
}
