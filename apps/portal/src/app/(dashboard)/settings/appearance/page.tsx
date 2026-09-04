import { AppearanceSettings } from '@/components/settings/appearance/appearance-settings';

/**
 * Settings → Appearance — the portal's theming screen, for every tenant.
 *
 * HISTORY, because the shape of this file has changed twice and the reason
 * matters more than the three lines below.
 *
 * This screen was built on `improv/portal-side`, ungated, for all tenants. It
 * never merged. When v2 landed on `main` the same screen came back as the first
 * v2 area, and — following V2_PLAN.md §3 — was gated to the `northwind` canary
 * with `notFound()` as the off state, on the reasoning that "Appearance is new,
 * so there is no v1 behaviour here to change".
 *
 * That reasoning was sound for a v2 rollout and wrong for this screen: the
 * effect was that 56 of 57 tenants lost the only place in the product where
 * they can pick a brand colour and see their portal repaint around them. Ghulam
 * asked for it back, so the gate is gone and this route renders for everyone.
 *
 * NOT a v2 rollout by the back door:
 *   - `lib/v2.ts` is untouched. `V2_AREAS.appearance` still gates
 *     `/integrations`, and `.v2-theme` on <body> is still northwind-only.
 *   - So northwind sees this screen in v2 tokens and every other tenant sees it
 *     in their own branded v1 tokens. The `ui-v2` primitives the screen is
 *     built from read the SAME custom-property names v1 already defines
 *     (`--primary`, `--border`, `--muted`…); `.v2-theme` only overrides their
 *     values. Outside that class they resolve against the tenant's own brand,
 *     which on a screen whose whole job is previewing that brand is the
 *     correct answer rather than a compromise.
 *   - No other route's rendering changes. This one currently 404s for everyone
 *     but the canary, so there is no behaviour here to regress.
 *
 * Permissions are unchanged: the screen reuses the EXISTING `settings.branding`
 * manager-permission key via `canEditSettings('branding')`, so a viewer-level
 * manager gets the same read-only treatment they get on the Branding tab. No
 * new tab key, no fail-open path.
 *
 * A server component with no gate left to resolve, so it does no async work —
 * `AppearanceSettings` is the client component that does everything.
 */
export default function AppearancePage() {
  return <AppearanceSettings />;
}
