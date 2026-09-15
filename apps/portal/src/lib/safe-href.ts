/**
 * The href we are willing to put in the DOM, or `null` to drop the link.
 *
 * Moved here, unchanged, from components/dashboard-v2/announcement-carousel.tsx
 * so the hero-tab featured deck (components/shared/featured-deck-v2.tsx) and the
 * route matcher in lib/featured-cards.ts use the SAME check as the dashboard
 * carousel instead of a second copy that could drift. The carousel and its
 * detail dialog import it from here.
 *
 * `cta_url` is free text typed into the super-admin form and it lands in an
 * `href` unmodified. A `javascript:` or `data:` href EXECUTES on click, so a
 * paste accident — or anyone who ever gets a write on this table — becomes
 * script running in an operator's authenticated portal session. Only an
 * absolute http(s) URL or a same-origin path survives; anything else renders no
 * button at all, because a missing CTA is better than that one.
 *
 * Note this is the href only. `body_html` still goes through
 * `dangerouslySetInnerHTML` unsanitised — see the comment at that call site,
 * now in components/dashboard-v2/announcement-detail-dialog.tsx.
 *
 * KNOWN GAP, recorded rather than changed (changing it would change the
 * dashboard carousel): `/\evil.com` passes, and browsers resolve a leading
 * `/\` exactly like `//`, i.e. off-origin. `resolveSameOriginPath` in
 * lib/featured-cards.ts closes that for the deck by resolving through `URL`
 * and comparing origins.
 *
 * Declared as a plain `function` and exported by name at the bottom on purpose:
 * __tests__/hooks/feature-announcements-gate.test.ts lifts this declaration out
 * of the source text with a `^function safeHref` pattern.
 */
function safeHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Same-origin path. `//evil.com` is protocol-relative and NOT same-origin,
  // so a second slash disqualifies it.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return null;
}

export { safeHref };
