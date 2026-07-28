/**
 * Fetch a tenant's own Terms & Conditions for inclusion in the rental agreement.
 *
 * WHY THIS EXISTS
 * An operator reported that "a lot of settings in my terms and conditions [are]
 * not included in the agreement itself, which if the person goes through the ad
 * not the website they would never see". He was right. Tenant T&Cs live in the
 * CMS (cms_pages slug='terms' -> cms_page_sections section_key='terms_content')
 * and are shown at /terms on the booking site, but no agreement engine read
 * them. A customer booked directly by the operator therefore signed a contract
 * that did not incorporate the operator's terms at all.
 *
 * Duplicated byte-for-byte to:
 *   apps/portal/src/lib/agreement-terms.ts
 *   apps/booking/src/lib/agreement-terms.ts
 *   supabase/functions/_shared/agreement-terms.ts
 *
 * DESIGN NOTE — this APPENDS to the agreement's existing boilerplate rather
 * than replacing it. The built-in clauses cover insurance, liability and
 * governing law, which most tenant CMS terms pages do not. Replacing would
 * quietly drop them.
 */

/** Minimal shape we need from a CMS section row. */
interface TermsSectionRow {
  section_key: string;
  content: unknown;
  display_order?: number | null;
  is_visible?: boolean | null;
}

/**
 * Pull renderable text out of a CMS section's `content` JSON.
 *
 * The CMS stores heterogeneous shapes per section type, so this is deliberately
 * permissive: it walks the value and collects strings rather than assuming one
 * schema. Returning "" is always safe — the caller omits the whole block.
 */
function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map(extractText).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;
    // Common single-field shapes first, so we keep authored order where we can.
    for (const key of ["html", "body", "text", "content", "value"]) {
      if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
        return (obj[key] as string).trim();
      }
    }
    // Fallback: walk remaining values — but skip presentational metadata.
    // Without this a section of {title:"Terms of Service"} and no body yields
    // the string "Terms of Service", which renders as a Terms heading with the
    // page title as its entire contents. Empty is the honest result there.
    return Object.entries(obj)
      .filter(([key]) => !METADATA_KEYS.has(key))
      .map(([, value]) => extractText(value))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Keys that describe the section rather than being its body text. */
const METADATA_KEYS = new Set([
  "title",
  "heading",
  "subtitle",
  "label",
  "slug",
  "seo",
  "id",
  "icon",
  "image",
  "image_url",
  "sort_order",
  "display_order",
]);

/**
 * True when the string carries markup we should pass through as-is.
 *
 * Requires a recognisable block/inline tag rather than "any angle bracket",
 * because the loose form treated plain prose containing "<" as HTML and passed
 * it through unescaped.
 */
const HTML_TAG_RE =
  /<\/?(p|div|span|h[1-6]|ul|ol|li|br|strong|em|b|i|u|a|table|tr|td|th|thead|tbody|blockquote|pre|code|hr|section|article)\b[^>]*>/i;

function looksLikeHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
}

/**
 * Remove executable/style markup before the block is embedded in a document.
 * The CMS content is operator-authored so this is defence in depth rather than
 * a hostile-input boundary, but a contract is the last place we want a stray
 * script or style tag surviving into a renderer.
 */
function stripUnsafeMarkup(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Escape text destined for an HTML document. Only applied to content that is
 * NOT already HTML, so authored rich text is preserved.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build the Terms & Conditions block for the agreement.
 *
 * @returns HTML to substitute for {{terms_and_conditions}}, or "" when the
 *          tenant has no published terms. Callers MUST treat "" as "render
 *          nothing" — never emit a bare "Terms and Conditions" heading with no
 *          body under it.
 */
export function buildTermsBlock(sections: TermsSectionRow[] | null | undefined): string {
  if (!sections || sections.length === 0) return "";

  // Respect the CMS visibility toggle: a hidden section is not shown to
  // customers on the website, so it must not appear in their contract either.
  const visible = sections.filter((s) => s.is_visible !== false);
  if (visible.length === 0) return "";

  const ordered = [...visible].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );

  const parts = ordered
    .map((s) => extractText(s.content))
    .map((t) => t.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";

  const body = parts
    .map((p) =>
      looksLikeHtml(p)
        ? stripUnsafeMarkup(p)
        : p
            .split(/\n{2,}/)
            .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
            .join("\n"),
    )
    .join("\n");

  return [
    "<h2>Operator Terms &amp; Conditions</h2>",
    body,
  ].join("\n");
}

/**
 * Fetch + build in one call. Accepts any supabase-js-shaped client so the same
 * code runs in a Next route handler and in a Deno edge function.
 *
 * Never throws: T&Cs are additive, and a CMS hiccup must not block an agreement
 * from being sent. On failure the agreement renders exactly as it does today.
 */
export async function fetchTenantTermsBlock(
  supabase: any,
  tenantId: string | null | undefined,
): Promise<string> {
  if (!supabase || !tenantId) return "";
  try {
    const { data: page } = await supabase
      .from("cms_pages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", "terms")
      .eq("status", "published")
      .maybeSingle();

    if (!page?.id) return "";

    const { data: sections } = await supabase
      .from("cms_page_sections")
      .select("section_key, content, display_order, is_visible")
      .eq("page_id", page.id)
      .eq("section_key", "terms_content");

    return buildTermsBlock(sections as TermsSectionRow[] | null);
  } catch (err) {
    console.error("[agreement-terms] failed to load tenant terms:", err);
    return "";
  }
}
