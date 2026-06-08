# How to improve Bento further

Ideas to take the system past "pretty pages" into a genuinely great product. Grouped by
effort/impact — pick from the top.

## High impact, do soon
1. **Global command palette (⌘K)** — built on shadcn `Command` (cmdk). Jump to any page,
   search customers/vehicles/rentals, and run actions ("New rental", "Mark returned"). Makes a
   dense admin feel fast and pro. Pairs with the motion system (spring modal).
2. **Optimistic UI + animated mutations** — on create/update/delete, update the cache
   immediately and animate the row/tile in/out (TanStack Query `onMutate` + `AnimatePresence`).
   The New Rental flow already mimics this; make it real everywhere.
3. **Toast/undo for destructive actions** — every delete/cancel shows a Sonner toast with
   **Undo** for ~5s instead of a blocking confirm. Fewer modals, safer.
4. **Empty states with purpose** — each list/section gets a designed empty tile (icon + one
   line + primary action), not a blank table. Big perceived-quality win.
5. **Per-tenant brand accent** — the platform is white-label. Inject each tenant’s brand color
   into `--primary` at runtime (from `branding-config`) while keeping the Bento neutrals. One
   system, many brands.

## Interaction & UX depth
6. **Density toggle** (Comfortable / Compact) — a token-level spacing switch for power users
   managing big fleets; persists per user.
7. **Keyboard shortcuts** — `n` new rental, `/` search, `j/k` row nav, `g d` go dashboard.
   Show a `?` cheatsheet. Wire via Radix-friendly handlers.
8. **Drag-to-dismiss sheets + swipe** — finish the iOS feel on the detail sheet; on touch,
   swipe rows for quick actions.
9. **Inline editing** — edit a rental’s dates/price/notes in place (popover + Form) instead of
   a full page; animate the commit.
10. **Saved views & filters** — let operators save segmented-filter + search combinations on
    list pages (Rentals, Payments).
11. **Realtime presence & live updates** — you already use Supabase realtime; surface "updated
    just now" pulses and live KPI count-ups on the dashboard.

## Visuals & data
12. **Charts as first-class** — adopt shadcn Chart (Recharts) with the Bento `--chart-*`
    tokens and draw-in animation; add sparklines to KPI tiles and a real revenue/utilization
    view on the dashboard and detail pages.
13. **Skeletons that match exactly** — per-page skeletons (not a generic block) so the
    load→content cross-fade is seamless.
14. **Micro-illustrations / iconography pass** — a small consistent icon + spot-illustration
    set for empty/success/error states.
15. **Print / PDF styling** — rental agreements, invoices and reports deserve a clean Bento
    print stylesheet (you already generate PDFs).

## Foundation & quality
16. **Storybook for the Bento layer** — document every component + variant + state in light and
    dark; it becomes the living spec and speeds every future page.
17. **Visual regression tests** (Chromatic/Playwright snapshots) for light + dark — catch drift
    as pages migrate.
18. **CSS `@theme` / token pipeline** — if you move to Tailwind v4, express tokens once and
    generate both themes; or keep a single `tokens.ts` as the source and generate the CSS.
19. **Accessibility pass** — colour-contrast audit of the muted status colours on tinted bg,
    focus-visible everywhere, reduced-motion verified, full keyboard paths (Radix gives most of
    this — verify it).
20. **Responsive / tablet & mobile** — define how tiles reflow (4→2→1 cols), how the rail
    becomes a bottom bar or drawer, and how sheets become bottom sheets on phones. Operators
    check things on the lot from a phone.
21. **Performance budget** — virtualize long tables, lazy-load charts/sheets, cap stagger,
    keep animations on transform/opacity (see ANIMATION §5). Set a Lighthouse/INP target.
22. **Theme/brand QA harness** — a hidden `/__bento` route rendering every component in every
    state × light/dark × a couple of tenant accents, for fast eyeballing during the rollout.

## Sequencing suggestion
Foundation (Storybook + visual regression + per-tenant accent) → command palette + optimistic
UI + empty states → charts + density + shortcuts → responsive + a11y + perf. Each is
independently shippable and compounds.
