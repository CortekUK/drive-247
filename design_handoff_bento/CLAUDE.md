# CLAUDE.md — Bento Design System (project rules)

This repo is migrating its UI to the **Bento design system**. On any UI work, follow the spec
in `design_handoff_bento/DESIGN_SYSTEM.md` and the process in
`design_handoff_bento/ROLLOUT_PLAYBOOK.md`. Reference prototypes live in
`design_handoff_bento/reference/`.

## Non-negotiables
- **Presentation only.** Never change data fetching, hooks, routing, permissions, Zod schemas,
  or edge-function calls when restyling. Keep every handler wired to the same logic.
- **Use the tokens, not hard-coded colors.** Style via the CSS variables / Tailwind tokens
  defined in `globals.css` (see DESIGN_SYSTEM.md §3). No raw hex in components. No Inter/Roboto.
- **shadcn/ui everywhere.** Build every UI element from shadcn (Radix) components wearing Bento
  CVA variants — never hand-roll primitives. See `SHADCN_MAPPING.md` for the recipe→component
  table. This keeps the theme consistent and gives accessibility for free.
- **Animation-heavy, by the system.** Every page gets motion from `ANIMATION.md`: route enter,
  staggered tile/row entrances, count-up KPIs, spring overlays, sliding nav/segmented indicator,
  hover lift, and animated state transitions (skeleton↔content, error shake, success draw).
  Transform/opacity only; reuse the motion tokens; always honour `prefers-reduced-motion`.
- **Compose from the Bento component layer** (`components/bento/*`) over shadcn primitives.
  If a component is missing, add it there per DESIGN_SYSTEM.md §7 + SHADCN_MAPPING.md — don’t
  one-off it.
- **Every data view ships its states:** loading skeleton, empty, error, and (for forms/actions)
  submitting → success — in light **and** dark, each with its motion.
- **Dark-mode gotcha:** do NOT CSS-`transition` `background-color`/`color`/`border-color` whose
  value is a CSS variable (Chromium freezes it). Swap the theme instantly; fade a one-shot
  overlay if you want softness. (DESIGN_SYSTEM.md §6.)

## Look & feel (quick reference)
- Rounded white **tiles** (radius 18–22) on a soft canvas; 1px `--border`; soft shadow.
- One **violet** accent does the signalling. Status colors are muted (DESIGN_SYSTEM.md §3.2).
- **Sora** for headings/KPIs/buttons (700–800, tight tracking); **IBM Plex Mono** tabular for
  figures/plates/codes. Quiet uppercase eyebrows over big numbers.
- Snappy motion: spring (`cubic-bezier(.34,1.56,.64,1)`) for pops; iOS curve for sheets;
  press-scale on click.
- Patterns: dashboard = bento grid w/ hero + feature tiles; list = stat tiles + table tile +
  segmented filter; detail = header + KPI strip + 2-col; form = checklist + sections + sticky
  live preview. (DESIGN_SYSTEM.md §8.)

## Glass (optional material)
Glassmorphism (`GLASS.md`) is for **floating chrome + overlays** (auth, dialogs, sheets,
popovers, command palette, toasts, map panels, detail headers) — **not** dense tables/dashboards
(keep those solid `--card` for readability + perf). Glass needs an ambient backdrop to read.
Use the `.glass` recipe + tokens; honour `prefers-reduced-transparency`; never transition
var()-driven colours.

## Working rhythm
Do Phase 0 (tokens/fonts) and Phase 1 (component layer + shell) before any page work. Then
migrate **one page per change**, run the per-page acceptance checklist in the playbook, and
stop for review in light + dark before the next page. Track route status in `MIGRATION.md`.
