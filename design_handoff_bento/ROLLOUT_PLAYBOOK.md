# Bento Rollout Playbook — page by page

How to migrate the **entire** Drive247 portal (and admin) app to the Bento design system
without breaking anything, using Claude Code, one page at a time.

Read `DESIGN_SYSTEM.md` first — this playbook assumes its tokens and components exist.

---

## The big idea

1. **Do the foundation once** (Phase 0 + 1): tokens, fonts, and a small reusable Bento
   component layer + app shell. After this, ~80% of every page is already on-brand because
   shadcn components inherit the new tokens.
2. **Then go page by page** (Phase 2) in small, reviewable PRs. Each page is one focused
   session with the same checklist and acceptance bar.
3. **Never touch logic.** Only presentation: markup, classes, component swaps, and the
   loading/empty/error/dark states. Keep all hooks, queries, routing, permissions, Zod
   schemas, and edge-function calls identical.

Work on a branch. One PR per page (or per small group). Review light **and** dark each time.

---

## Phase 0 — Foundation (do first, one PR)

1. Add fonts with `next/font/google`: **Sora** (400–800) and **IBM Plex Mono** (400–600).
   Wire `--font-sans: Sora` and a `--font-mono` and expose them in `tailwind.config.ts`
   (`theme.extend.fontFamily`).
2. In `globals.css`, replace the `:root` and `.dark` token **values** with the Bento palette
   from `DESIGN_SYSTEM.md §3` (convert hex → the HSL-triplet format the file already uses;
   keep variable names). Add the `--bento-*` variables in both `:root` and `.dark`.
3. Set shadcn base `--radius` to `0.85rem`.
4. Add `--bento-*` colours to `tailwind.config.ts` so they’re usable as classes
   (e.g. `bg-[hsl(var(--bento-tile))]` or named utilities).
5. Verify the dark toggle uses the §6 gotcha-safe approach (instant class swap; no transition
   on var-driven colours). Add the one-shot overlay fade if desired.

**Acceptance:** app builds; existing pages already look lighter/violet; dark mode flips
cleanly with readable text; no logic changed.

---

## Phase 1 — Shared component layer + shell (one or two PRs)

1. Build the Bento components from `DESIGN_SYSTEM.md §7` **as shadcn variants/wrappers**
   (see `SHADCN_MAPPING.md`) under `components/bento/` (or extend `components/ui/`):
   `Tile`, `KpiTile`, `FeatureTile`, `WarnTile`, `HeroTile`, `Segmented` (on `Tabs`),
   `StatusPill` (on `Badge`), `Stepper`, `Toggle` (on `Switch`), `DataTable` (Bento-styled),
   `SideSheet` (on `Sheet`), `Modal` (on `Dialog`), `Toast` (Sonner), `SectionCard`,
   `Skeleton`, `Eyebrow`, `Money`, `EmptyState`, `ErrorState`, `ProcessOverlay`. Add the
   motion from `ANIMATION.md` to each (entrances, hover, state transitions).
2. Re-skin the **app shell**: sidebar/rail (active = primary-weak pill), top header
   (title + actions + light/dark toggle), page container (padding/max-width).
3. Port the **icon set** (the prototypes use a small inline-SVG `Icon`; or use `lucide-react`
   which the app already has — match stroke ~1.7).

**Acceptance:** the shell matches the prototypes in light + dark; the component library is
importable and documented with a one-line usage each.

---

## Phase 2 — Page-by-page migration

Suggested order (highest-traffic / most-shared-patterns first, so later pages get easier):

**Portal (tenant) app — `apps/portal`:**
1. Dashboard (`/`) — dashboard pattern
2. Rentals list (`/rentals`) — list pattern
3. New Rental (`/rentals/new`) — create-form pattern ✅ already prototyped
4. Rental detail (`/rentals/[id]`) — detail pattern
5. Vehicles (`/vehicles`) + Vehicle detail (`/vehicles/[id]`) — gallery + detail
6. Customers (`/customers`) + Customer detail (`/customers/[id]`)
7. Payments (`/payments`) + Payment detail · Invoices · Expenses
8. Fines (+ `[id]`, `/new`) · Insurance / Insurances
9. Pending bookings · Enquiries · Messages · Reminders
10. Reports · P&L dashboard · Owner payouts · Credits
11. Agreements · Plates (+ `[id]`) · Availability · Blocked customers · Audit logs
12. Promotions · Testimonials · Vehicle owners
13. Settings (+ sub-pages: users, blacklist, email/agreement templates, reminders)
14. Subscription · CMS section (home/about/fleet/blog/etc.)
15. Auth screens (login / invite) — apply tokens + a centered Tile

**Admin (super-admin) app — `apps/admin`:** Dashboard · Rental Companies (+ detail) ·
Blacklist · Contact Requests · Mode Requests · Bonzah Onboarding · Announcements · Audit
Logs · OpenAI Usage · Settings · Manage Admins. (Same patterns; the admin currently uses a
neon-purple theme — replace it with these tokens too.)

> Map each page to ONE pattern from `DESIGN_SYSTEM.md §8` and reuse the components. If a page
> needs a pattern that doesn’t exist yet, add it to the spec first, then build.

### Per-page process (repeat for every page)

1. **Read** the current page + its components and hooks. List what it renders and which data
   it fetches. **Do not change** the data layer.
2. **Classify** it (dashboard / list / detail / form / gallery / settings) per §8.
3. **Map** each existing UI element to a Bento component (§7). Replace bespoke markup with the
   Bento component layer; keep props/handlers wired to the same logic.
4. **Lay out** with the pattern: tiles on the canvas, correct grid/gaps, oversized numbers,
   mono figures, status pills, segmented filters.
5. **Implement all states** (§9): loading skeleton, empty, error, submitting/success — in
   addition to the populated state.
6. **Verify** acceptance (below) in light **and** dark, at desktop and a narrow width.

### Per-page acceptance checklist
- [ ] Only presentation changed — data/queries/routing/permissions/validation untouched.
- [ ] Built from **shadcn/Radix** components + Bento variants (SHADCN_MAPPING.md) — nothing
      hand-rolled; no hard-coded hex, no Inter.
- [ ] Matches the relevant §8 pattern; tiles, radius, spacing, type scale correct.
- [ ] **Animated** per ANIMATION.md: route enter, staggered tiles/rows, count-up KPIs, spring
      overlays, sliding nav/segmented indicator, hover lift, state transitions — transform/
      opacity only, and correct under `prefers-reduced-motion`.
- [ ] Figures use IBM Plex Mono tabular; headings/KPIs use Sora with tight tracking.
- [ ] Status pills use the §7 status map.
- [ ] Loading (skeleton), empty, and error states implemented (with their motion).
- [ ] Light **and** dark both correct and readable; dark toggle doesn’t freeze (§6).
- [ ] Responsive: no overflow/clipping at a narrow width.
- [ ] Keyboard/focus rings present; hit targets ≥ 40px.
- [ ] No new console errors; types/build pass.

---

## Copy-paste prompt template for Claude Code

> Run this once per page. Fill in the page path.

```
You are migrating ONE page of our Next.js portal to the **Bento design system**.

Read these first and treat them as binding:
- design_handoff_bento/DESIGN_SYSTEM.md  (tokens, components, patterns, required states)
- design_handoff_bento/SHADCN_MAPPING.md  (build every element from shadcn + Bento variants)
- design_handoff_bento/ANIMATION.md  (the motion system — this page must be animated)
- design_handoff_bento/ROLLOUT_PLAYBOOK.md  (process + acceptance checklist)
- design_handoff_bento/reference/  (HTML prototypes — the source of truth for look & feel;
  recreate their style in our React/Tailwind/shadcn stack, don't copy HTML verbatim)

TARGET PAGE: <path, e.g. apps/portal/src/app/(dashboard)/rentals/page.tsx>

Rules:
- Change PRESENTATION ONLY. Do not touch data fetching, hooks, routing, permissions, Zod
  schemas, or edge-function calls. Keep every handler wired to the same logic.
- Build EVERY element from shadcn/Radix components wearing Bento variants (SHADCN_MAPPING.md).
  Don't hand-roll primitives. Compose from components/bento/*; add missing ones there.
- ANIMATE it per ANIMATION.md: route enter, staggered tile/row entrances, count-up KPIs,
  spring overlays, sliding indicators, hover lift, skeleton↔content / error-shake / success
  transitions. Transform/opacity only; reuse the motion tokens; honour prefers-reduced-motion.
- Implement ALL states: loading skeleton, empty, error, and (for forms/actions)
  submitting→success. Plus the normal populated state.
- Build light AND dark together. Do NOT CSS-transition var()-driven colors (see §6 gotcha).

Process:
1. Summarize what this page currently renders and what data it uses (confirm you won't change it).
2. Classify it against DESIGN_SYSTEM.md §8 and tell me the pattern + which Bento components
   you'll use.
3. Implement the redesign.
4. Run through the Per-page acceptance checklist in the playbook and report pass/fail on each
   (including: shadcn-based, animated per ANIMATION.md, reduced-motion safe).

Then stop so I can review in light and dark before the next page.
```

---

## Tips for a smooth rollout

- **Stop after each page** for human review — don’t let it run the whole app unattended.
- Keep a **migration tracker** (a checklist issue or `MIGRATION.md`) listing every route and
  its status (todo / in-review / done).
- When you find a recurring widget (e.g. the money cell, the status pill, the rental row),
  **promote it to the Bento component layer** and reuse — pages should get faster over time.
- If two pages disagree on a pattern, fix the **spec** first, then both pages.
- Screenshot light + dark of each finished page into the tracker so drift is visible.
