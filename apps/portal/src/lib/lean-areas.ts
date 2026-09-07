/**
 * Lean-product area gates.
 *
 * The lean v2 product ships a deliberately smaller surface than v1. Areas that
 * v1 tenants depend on but the lean product does not carry are hidden HERE,
 * in the presentation layer only — nothing is removed.
 *
 * That distinction is load-bearing. Measured against production:
 *   - `enquiries_enabled`      is ON for 51 tenants
 *   - `lead_management_enabled` is ON for 3 tenants (4 live rows)
 *   - `automations_enabled`     is ON for 1 tenant
 * Enquiries in particular is one of the most-used features in the product.
 * Deleting any of it would be an outage, so this gate decides what a lean
 * tenant's operator SEES; the routes, hooks, components, edge functions and
 * cron jobs behind them are untouched and keep serving everyone else.
 *
 * Keyed on tenant SLUG, not tenant id.
 * ------------------------------------
 * The same tenant has a DIFFERENT primary key in every environment —
 * `northwind` is 6e5c544f-… in production but 8e6bc88f-… on the staging
 * branch, because staging was seeded rather than cloned. An id-keyed gate
 * therefore resolves to the ungated path on localhost with no error and no
 * failed build: the code is right, the build is right, and the screen simply
 * never changes. The slug is stable across every environment, so it cannot
 * drift that way.
 *
 * TODO: fold into `lib/v2.ts` once the in-flight v2 gating work lands. That
 * module owns the same idea (id-keyed, with both environments' ids listed);
 * this one exists separately only to avoid editing a file another session is
 * currently rewriting. When merging, prefer this module's slug key.
 */

/**
 * Tenants running the lean v2 product, by slug.
 *
 * Annotated `readonly string[]` rather than written `as const` ON PURPOSE.
 * `as const` narrows the element type to the literal union `'northwind'`,
 * which narrows `Array.prototype.includes` to accept only that literal — so
 * `LEAN_TENANTS.includes(someString)` stops being a membership test and
 * becomes a compile error. Portal builds with `ignoreBuildErrors: true`, so
 * that error is discarded at build time and the gate ships broken. The
 * annotation keeps `.includes()` type-checking against `string`.
 */
const LEAN_TENANTS: readonly string[] = ['northwind'];

/**
 * Areas hidden from lean tenants.
 *
 * `quotes` is here for a different reason than the other three, and the
 * difference is worth recording. Enquiries/Leads/Automations are v1 areas the
 * lean product does not carry. Fleet Quotes was briefly DELETED from main
 * instead of gated (43b97af1, reverted in 5acae08a) on the mistaken reading
 * that it was the same kind of thing. It was not: its nav entry sat
 * unconditionally next to Rentals behind no flag, so all 35+ paying tenants
 * had it. Hiding it from the canary belongs here, in the presentation layer,
 * exactly like the other three — the route, hook and pricing rules stay on
 * main and keep serving everyone else.
 *
 * `tesla` is the same story, and a costlier one. The Tesla Fleet integration
 * was DELETED from main (2ee1fd13 + 40dbdcbb, both reverted in c37e0f55)
 * rather than gated. Jangram Rentals — a live Denver operator with 6 Teslas,
 * 5 of them wired to the Fleet API — lost automatic Supercharger billing for
 * the duration: no hourly poll, no session-to-rental matching, no Supercharger
 * line to Charge or Waive. Open Bay Rental also has the integration connected.
 * Only the UI is gated here; the edge functions, `tesla-sync-engine` and cron
 * job 36 `sync-tesla-charges-hourly` are deliberately NOT touched, because the
 * canary has no Tesla vehicles and no Tesla connection — the server side is
 * already inert for it, and reaching into that path would put the very billing
 * we just repaired back at risk.
 *
 * `welcome` is the Welcome Pack — the in-portal operator guide at `/welcome`.
 * It is gated here rather than removed because it is being READ RIGHT NOW:
 * `welcome_pack_reads` holds 184 rows from 16 operators across 14 tenants,
 * the newest at 2026-09-02 20:45 UTC, against 12 chapters / 59 sections /
 * 62 FAQs of content. Deleting it from main would take the guide from all 35+
 * paying tenants at once to hide it from one canary — the exact inversion the
 * Fleet Quotes and Tesla Fleet removals above already cost us. So the route,
 * the components, the `use-welcome-pack` hook, the four `welcome_pack_*`
 * tables and the super-admin authoring screen in apps/admin all stay exactly
 * where they are and keep serving everyone else; only what northwind SEES
 * changes.
 *
 * `owners` is Vehicle Owners + Owner Payouts — the per-vehicle ownership
 * splits, the payout runs, and the CSV export that settles them. It is gated
 * here rather than removed because it is settling real money right now:
 * `vehicle_owners_enabled` is ON for 7 tenants, `vehicle_owners` holds 9 rows
 * across 4 tenants, and `owner_payouts` holds 19 rows — 15 of them Global
 * Motion Transport's, totalling 4,978.55 in `net_owed`, with
 * `owner_payout_lines` underneath. GMT is a live Chicago operator that pays
 * three vehicle owners out of this screen; deleting it from main would take
 * their payout ledger away to hide one nav group from one canary, the same
 * inversion Fleet Quotes and Tesla Fleet already cost us twice.
 *
 * So nothing moves: the three routes, four dialogs, four hooks, the
 * `vehicle_owners` / `owner_payouts` / `owner_payout_lines` tables, the
 * `vehicles.owner_id` column, the five migrations and the two
 * `permissions.ts` tab keys all stay exactly where they are. Note in
 * particular that the `permissions.ts` wiring is deliberately untouched:
 * `canView` treats an unmapped route as ALLOWED, so removing a tab key while
 * the route still exists would WIDEN manager access rather than narrow it.
 *
 * Northwind already has `vehicle_owners_enabled = false`, so the two sidebar
 * groups are dark for it today — but the flag gates only the nav. The routes
 * answer a typed URL regardless, the Settings → Features switch lets the
 * canary turn the whole thing back on, and the Reports export card, the
 * vehicle-detail Ownership panel and the vehicles-list Owner column/filter
 * are not behind the flag at all and render for every tenant today. This gate
 * is what actually closes those, and only for the canary.
 *
 * `expenses` is the Expense Tracker at `/expenses`. Same reasoning, and the
 * same refusal to delete: `vehicle_expenses` holds 57 rows across three
 * tenants, 11 of them Flow Auto Rentals' — 2,364.64 of real spend, newest
 * 2026-08-10 — with the internal `test` tenant holding 41 and `drive-247`
 * five. Removing it from main would take a live operator's cost ledger away
 * to hide one nav row from one canary, the inversion Fleet Quotes and Tesla
 * Fleet already cost us twice.
 *
 * P&L IS A DIFFERENT FEATURE AND IS NOT TOUCHED. The two meet in exactly one
 * place, and it is in the database, not in React: the trigger
 * `vehicle_expense_pnl_trigger` on `vehicle_expenses` runs
 * `handle_vehicle_expense_pnl()`, which writes/updates/deletes the matching
 * `pnl_entries` row keyed `'vexp:' || id`. That path is server-side and fires
 * for any writer, so a presentation-layer gate cannot reach it — which is the
 * whole reason the gate is safe. `pnl_entries` carries 12,559 rows across 31
 * tenants; `/reports`, `/pl-dashboard`, `/reports/vehicle-profitability` and
 * the `get-vehicle-profitability` edge function all read `pnl_entries` and
 * never `vehicle_expenses`, and none of them import anything from
 * `components/expenses/` or call a `use-expense*` hook. They are deliberately
 * NOT gated.
 *
 * Northwind has 0 rows in `vehicle_expenses` and 0 in `pnl_entries`, so this
 * gate takes nothing away from it — it only stops offering a screen the lean
 * product does not carry. The route, the nine components, the three hooks,
 * `lib/expense-utils.ts`, the `vehicle_expenses` / `expense_categories` /
 * `expense_ai_summaries` tables, the private `expense-receipts` bucket, the
 * `generate-expense-summary` edge function and the nine migrations all stay
 * exactly where they are. So does the `permissions.ts` wiring: `canView`
 * treats an unmapped route as ALLOWED, so pulling the `expenses` tab key
 * while the route still exists would WIDEN manager access, not narrow it.
 *
 * `accounting` is Xero + Zoho Books — the Settings > Accounting tab, both OAuth
 * pairs, the sync worker, the token refresher, the mappings and backfill
 * screens, and the super-admin Finance Sync tab in apps/admin. It is the
 * clearest case in this list of why the gate belongs here and not in a delete,
 * because the delete was actually attempted: 41 files and 6,578 lines came off
 * main (3e3d24af) before being restored.
 *
 * The production numbers cut the OPPOSITE way to Owner Payouts and Expenses,
 * and that is the interesting part. `integration_xero` is on for 0 of the 57
 * tenants and `integration_zoho_books` for exactly 1 — `test`, the internal
 * tenant, which also owns all 3 rows of `accounting_connections`. Nobody live
 * is using it. What made the removal wrong was not the data it would have
 * stranded; it was that this tab is the ONLY way any of the other 56 tenants
 * could ever connect a ledger. Deleting it did not hide a feature from one
 * canary, it withdrew an unshipped feature from everyone — and took two live
 * refund paths with it, since reject-rental and cancel-rental-refund each
 * fire-and-forget a void into the accounting side.
 *
 * WHAT THIS GATE CANNOT REACH, and must not:
 *  - `financial_events` (7,635 rows) and `financial_event_sync_state` (6,616)
 *    are filled by the `ledger_entries` trigger and the nine
 *    `enqueue_financial_event` callers. Server-side, fires for every writer,
 *    unreachable from React — which is exactly why gating is safe.
 *  - P&L is a DIFFERENT feature. `pnl_entries` holds 12,559 rows across 31
 *    tenants; `/reports`, `/pl-dashboard`, `/reports/vehicle-profitability`
 *    and the `get-vehicle-profitability` edge function read it directly and
 *    have never needed a Xero or Zoho connection. Their one point of contact
 *    with accounting was a shared tenant-resolution helper, and that now lives
 *    at `_shared/resolve-tenant.ts` rather than under `_shared/accounting/`,
 *    so even the implied coupling is gone. None of them is gated.
 *
 * Northwind has both flags false, 0 connections, 0 `financial_events` and 0
 * `pnl_entries` — no accounting footprint at all — so this gate is purely
 * cosmetic for the canary and costs nothing to anyone else. `permissions.ts`
 * is deliberately untouched for the same reason as Expenses and Owners, with
 * one extra twist that matters more here: `canViewSettings` opens with
 * `if (!settingsKey) return true;`, so dropping the `accounting` →
 * `settings.accounting` mapping would EXPOSE the tab to every manager,
 * including those never granted it. Removing the key widens access.
 *
 * `cmd` is CheckMyDriver (Modives) driver-licence verification and `inshur`
 * is the Inshur / Period Z fleet-insurance integration. Both were DELETED
 * from main (92f3a57b, 66dbb8a4) and are being restored and gated here
 * instead, for the same reason as everything above it: a delete hides the
 * feature from ONE canary by withdrawing it from the other 56 tenants.
 *
 * These two keys are registered AHEAD of their call sites on purpose. An area
 * that is gated but never registered is silently inert — `isAreaHidden`
 * returns false, the screen never changes, and nothing errors. That exact bug
 * shipped once already with `fleet-health`. Registering first makes the
 * failure mode impossible in the other direction: an unused key gates nothing.
 *
 * `tenant-health` is the super-admin Tenant Health Score screen. It lives in
 * apps/admin, which is not tenant-scoped, so the key here is a placeholder for
 * any portal-side surface only.
 *
 * ── The four `settings-*` keys ───────────────────────────────────────────────
 *
 * `settings-payments`, `settings-messaging`, `settings-insurance` and
 * `settings-esign` are a DIFFERENT KIND of entry from everything above, and the
 * difference is the whole reason they are safe.
 *
 * Every key above hides a feature the lean product does not carry. These four
 * hide a SECOND COPY of a feature the lean product very much does carry. The
 * canary now has `/integrations` — twelve cards, each opening a panel that
 * fully manages its integration — so a lean tenant had two places to configure
 * Stripe, Square, Twilio, Bonzah and BoldSign, which is one more than any
 * operator can keep straight. Nothing is being taken away; a duplicate is.
 *
 * MEASURED AGAINST PRODUCTION (63 tenant rows) at the time of gating:
 *   - 53 tenants on `payment_model = 'own'`, 2 on `payment_provider = 'square'`
 *   - 7 tenants hold Twilio SMS credentials, 3 have `twilio_voice_enabled`
 *   - 35 tenants have `integration_bonzah = true`
 *   - 49 tenants are on `boldsign_mode = 'live'`
 * Those are live money and live comms paths on the OTHER 56 tenants, all of
 * which reach them through exactly these Settings tabs — `/integrations` is
 * `notFound()` for every one of them (`isV2('appearance', slug)`). Deleting a
 * tab would therefore not tidy the canary, it would take Stripe onboarding,
 * Twilio setup, Bonzah credentials and the BoldSign mode switch off 56 paying
 * operators at once. Which is the inversion Fleet Quotes, Tesla Fleet and
 * Accounting already cost this project three times. So: presentation only.
 *
 * WHAT THIS GATE DOES NOT DO, deliberately:
 *
 *  - It does not hide `blacklist`. The Global Blacklist is a booking/risk rule,
 *    not an integration, and it has no card on the board. It is RELOCATED into
 *    "Booking Rules" for lean tenants (see `app-sidebar-v2.tsx`) so that the
 *    now-empty "Integrations" settings group disappears rather than sitting
 *    next to a real Integrations page holding one unrelated row.
 *
 *  - It does not make the `insurance` tab UNRENDERABLE. Bonzah's 10-step
 *    application wizard — file uploads, signature pad, graded quiz, draft
 *    autosave — lives only in `components/settings/bonzah-onboarding/`, and the
 *    board's own Bonzah panel DEEP-LINKS BACK TO IT (`ONBOARDING_HREF =
 *    "/settings?tab=insurance"` in `_panels/bonzah.tsx`). Hiding that body
 *    would leave "Start the Bonzah application" pointing at nothing. So the tab
 *    leaves the navigation, and the body narrows to the wizard alone — the one
 *    thing the panel does not carry. That is not a duplicate surface; it is the
 *    panel's own sub-screen, reached only from the panel.
 *
 *  - It does not silently drop the ~20 deep links that already point at these
 *    tabs (`use-platform-status`, `use-setup-guide`, `use-setup-status`, the
 *    dashboard Bonzah widgets, `stripe-connect-status.ts`, …) — nor the two
 *    OAuth callbacks, `stripe-oauth-callback` and `square-oauth-callback`,
 *    which HARDCODE `/settings?tab=payments&oauth=…|&square=…` as the landing
 *    and are edge functions this work must not touch (V2_PLAN §7). A hidden tab
 *    with a board home hands off to it instead, query string intact, so an
 *    operator returning from Stripe or Square lands on the card rather than on
 *    a bounced-to-General settings page. See `settingsTabBoardTarget`.
 *
 * ── `reports`, `pl-dashboard`, `reminders` ───────────────────────────────────
 *
 * The first two are the SAME KIND of entry as the four `settings-*` keys above:
 * they hide a second (and third) copy of something the lean product now carries
 * once. `/insights` replaces both — one screen, an honest money model, and none
 * of the clutter Ghulam asked to be rid of. Leaving all three in the rail meant
 * an operator had three places to ask "did I make money?" and got three
 * different answers, because the two originals disagree with each other and
 * with reality (they count the vehicle PURCHASE PRICE as an operating cost, so
 * they told a profitable operator like RevTek it was down 101,538 when it was
 * up 21,553).
 *
 * `reminders` is a plain lean-surface cut: the canary's product does not carry
 * the reminders queue.
 *
 * ALL THREE ARE GATED, NOT DELETED, and the reason is the one this file has now
 * paid for three times (Fleet Quotes, Tesla Fleet, Vehicle Owners):
 *
 *   - `pnl_entries` holds 12,559 rows across 31 tenants. `/reports`,
 *     `/pl-dashboard`, `/reports/vehicle-profitability` and the
 *     `generate-export` edge function all read it, and `generate-export` is the
 *     ONLY export backend in the product — an operator's CSV and XLSX downloads
 *     come out of it.
 *   - `reminders` holds 642 rows across 19 tenants, the newest written
 *     2026-09-06 — i.e. it is being used right now, today.
 *
 * So the routes, the components, the hooks, the views, the edge function and
 * the `reports` / `pl_dashboard` / `reminders` keys in `permissions.ts` all stay
 * exactly where they are and keep serving the other 56 tenants. Only what the
 * canary SEES changes. Note in particular that the `permissions.ts` wiring must
 * NOT be removed alongside a gate: `canAccessRoute` treats an unmapped route as
 * ALLOWED, so deleting a tab key while the route still answers would WIDEN
 * manager access rather than narrow it.
 *
 * `/reminders/analytics` rides the same `reminders` key by prefix match, so it
 * is covered by the same gate with no second entry.
 */
export const LEAN_HIDDEN_AREAS = [
  'enquiries',
  'leads',
  'automations',
  'quotes',
  'tesla',
  'welcome',
  'owners',
  'expenses',
  'accounting',
  'fleet-health',
  'cmd',
  'inshur',
  'tenant-health',
  'settings-payments',
  'settings-messaging',
  'settings-insurance',
  'settings-esign',
  'reports',
  'pl-dashboard',
  'reminders',
] as const;

export type LeanHiddenArea = (typeof LEAN_HIDDEN_AREAS)[number];

/**
 * Should `area` be hidden from the tenant identified by `tenantSlug`?
 *
 * Fails OPEN on every unknown: a null, undefined or not-yet-resolved slug
 * gets everything it has today. The gate exists to take three areas away from
 * one canary tenant — never to take them away from a tenant whose identity we
 * simply have not resolved yet (the slug is null for a tick on first paint,
 * and stays null on an unrecognised host).
 */
export function isAreaHidden(
  area: LeanHiddenArea,
  tenantSlug: string | null | undefined,
): boolean {
  if (!tenantSlug) return false;
  if (!LEAN_HIDDEN_AREAS.includes(area)) return false;
  return isLeanTenant(tenantSlug);
}

/**
 * Is this tenant on the lean v2 product?
 *
 * Same fail-open contract as `isAreaHidden`: an unresolved slug is NOT lean, so
 * every gate built on this keeps v1 behaviour until the tenant is known.
 */
export function isLeanTenant(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return LEAN_TENANTS.includes(tenantSlug);
}

/**
 * The lean product has NO test modes — BoldSign is always live.
 *
 * Resolves the mode a *tenant* signs in. Lean tenants get `live` whatever
 * `tenants.boldsign_mode` says; everyone else keeps the historical default of
 * `test` unless the column explicitly says `live`.
 *
 * SCOPE — tenant-level resolution only. Callers still prefer the mode recorded
 * on the agreement/rental row when there is one, and that history is NOT
 * rewritten: a document created in the BoldSign sandbox must keep being read
 * with the sandbox key or it 404s. New records for a lean tenant simply record
 * `live`, because creation resolves through here.
 *
 * Mirrored, because the three runtimes cannot share a module:
 *  - booking : apps/booking/src/lib/lean-tenants.ts
 *  - edge fns: supabase/functions/_shared/lean-tenants.ts
 * Every mirror must carry the same tenant list.
 */
export function resolveBoldSignMode(
  tenantMode: string | null | undefined,
  tenantSlug: string | null | undefined,
): 'test' | 'live' {
  if (isLeanTenant(tenantSlug)) return 'live';
  return tenantMode === 'live' ? 'live' : 'test';
}

/**
 * Should test/live mode switches, TEST badges and sandbox-override UI be hidden?
 *
 * PRESENTATION ONLY, and the distinction is load-bearing. This changes nothing
 * about what a tenant's mode actually IS: `tenants.stripe_mode` and
 * `tenants.bonzah_mode` are untouched, and the 66 edge functions that branch on
 * `stripe_mode` keep seeing exactly what they saw before. A lean tenant still
 * transacts in whatever mode its columns say — it is simply not shown a switch
 * and a badge for a concept the lean product does not have.
 *
 * Flipping a lean tenant's Stripe to live for real is a money decision, not a
 * UI cleanup, and is deliberately NOT done here.
 */
export function isTestModeUiHidden(tenantSlug: string | null | undefined): boolean {
  return isLeanTenant(tenantSlug);
}

/* ── Settings tabs the Integrations board now owns ─────────────────────────── */

/**
 * Settings tab value → the lean area that hides it.
 *
 * ONE map, read by every navigation surface, because the alternative already
 * shipped a bug. Before this existed the E-Signatures tab was filtered out of
 * the mobile trigger row and its body was blanked — but nobody filtered the
 * DESKTOP sidebar, so a lean tenant saw "E-Signatures" in the settings nav and
 * got an empty page when they clicked it. Tesla had the mirror-image defect:
 * both nav surfaces hid it, but `?tab=tesla` typed by hand still selected a tab
 * whose body rendered nothing. Three call sites, three chances to disagree.
 *
 * `accounting`, `inshur` and `tesla` are folded in here rather than left on
 * their own booleans so that the next tab added cannot repeat it.
 */
const SETTINGS_TAB_AREAS: Readonly<Record<string, LeanHiddenArea>> = {
  payments: 'settings-payments',
  messaging: 'settings-messaging',
  insurance: 'settings-insurance',
  esign: 'settings-esign',
  accounting: 'accounting',
  inshur: 'inshur',
  tesla: 'tesla',
};

/**
 * Should this Settings tab be hidden from the settings NAVIGATION?
 *
 * Navigation is the desktop sidebar group list and the mobile trigger row.
 * Whether the tab's BODY still renders is a separate question — see
 * `settingsTabBoardCard`, and note that `insurance` deliberately answers
 * `true` here while remaining renderable.
 *
 * Fails OPEN, like everything else in this module: an unrecognised tab value or
 * an unresolved slug is not hidden, so the 56 non-canary tenants and the tick
 * before `tenantSlug` resolves both keep today's navigation exactly.
 */
export function isSettingsTabHidden(
  tabValue: string,
  tenantSlug: string | null | undefined,
): boolean {
  const area = SETTINGS_TAB_AREAS[tabValue];
  if (!area) return false;
  return isAreaHidden(area, tenantSlug);
}

/**
 * Which board card a hidden Settings tab hands the operator off to, or `null`.
 *
 * `null` is not "no destination"; it means the tab's body must KEEP RENDERING
 * for a lean tenant even though the tab has left the navigation:
 *
 *  - `insurance` — the Bonzah application wizard lives only in Settings and the
 *    board's Bonzah panel links back into it (`ONBOARDING_HREF`). Redirecting
 *    would send that link to the board it came from, which is a loop.
 *
 *    WHEN THE WIZARD MOVES INSIDE THE BONZAH DIALOG (in flight separately),
 *    this becomes a one-line change: return `'Bonzah'` here instead of falling
 *    through to `null`, and drop the `hideInsuranceNav ? … : …` branch on the
 *    `insurance` TabsContent in `settings/page.tsx`. Do it in that ORDER and
 *    only once `ONBOARDING_HREF` no longer points at `/settings?tab=insurance`
 *    — flipping this first turns the panel's own "Start the Bonzah application"
 *    button into a redirect back to the panel.
 *  - `accounting` / `inshur` — already hidden by their own gates, which do not
 *    render a body at all. There is nothing to hand off.
 *
 * `tesla` DOES get a target: its body was already blanked for lean tenants, so
 * a typed `?tab=tesla` was landing on an empty page rather than the card that
 * now manages it.
 *
 * The value is the board CARD NAME to open, or `''` for the bare grid — never a
 * URL, so the caller keeps ownership of the query string and can merge the
 * incoming search params in. That merge is the point: `?oauth=…`, `?square=…`
 * and `?reason=…` are how a returning OAuth flow reports its outcome, and the
 * board reads them (`useSquareOAuthReturn`, and the board's own `?open=`
 * handling) exactly as the Settings tab used to.
 *
 * A card name here must match `_panels/registry.ts` EXACTLY — the board looks
 * the name up in its `integrations` list and silently opens nothing on a miss.
 * The test file pins these against the registry for that reason.
 */
export const SETTINGS_TAB_BOARD_ROUTE = '/integrations';

export function settingsTabBoardCard(tabValue: string): string | null {
  switch (tabValue) {
    // Two cards, and no way to tell from a bare `?tab=payments` which the
    // operator wanted — Stripe Connect and Square both live under it. The grid
    // itself is the honest landing.
    case 'payments':
      return '';
    case 'messaging':
      return 'Twilio Messages';
    case 'esign':
      return 'BoldSign';
    case 'tesla':
      return 'Tesla';
    default:
      return null;
  }
}
