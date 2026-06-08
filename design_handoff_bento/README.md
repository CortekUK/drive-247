# Handoff: Bento Design System for the Drive247 portal

## What this is
A complete package to migrate the Drive247 **portal** (tenant rental-admin) app — and the
**super-admin** app — to a new design system called **Bento**: a calm, light-first,
Apple-flavoured look with rounded "tile" cards, a single violet accent, oversized Sora
headings/numerals, IBM Plex Mono figures, true dark mode, and snappy spring interactions.

It’s written so a developer (or Claude Code) who wasn’t in the original conversation can roll
it out **page by page across the entire application** without breaking any logic.

## What’s in here
| File | Purpose |
|------|---------|
| `DESIGN_SYSTEM.md` | The spec: exact color tokens (light+dark) mapped to your shadcn vars, typography, spacing, radius, motion, every component recipe, page layout patterns, and the required states. **Binding.** |
| `SHADCN_MAPPING.md` | Every Bento recipe → the shadcn/Radix component it’s built from, how to theme it with tokens + CVA variants, and how to add its motion. **Use shadcn everywhere.** |
| `ANIMATION.md` | The motion system: tooling, easing/spring tokens, a per-component/per-page animation catalogue, reduced-motion + performance rules. **Bento is animation-heavy.** |
| `ROLLOUT_PLAYBOOK.md` | The process: Phase 0 (tokens/fonts), Phase 1 (component layer + shell), Phase 2 (page-by-page), the per-page checklist, the page inventory, and a **copy-paste prompt template** for Claude Code. |
| `GLASS.md` | Glassmorphism add-on — tokens (light+dark), the CSS recipe, where to use glass vs solid, the shadcn mapping, and legibility/perf guardrails. |
| `IMPROVEMENTS.md` | Ideas to take it further — command palette, optimistic UI, per-tenant accent, charts, Storybook, a11y, responsive, perf — sequenced by impact. |
| `reference/` | The HTML prototypes that define the look & feel (rental admin dashboard/list/fleet/customers, the interactive Rentals screen, and the full New Rental Agreement form) plus their supporting JS/JSX. |
| `CLAUDE.md` | Drop this into your repo root so every Claude Code session automatically follows the system. |

## About the design files
The files in `reference/` are **design references created in HTML** — prototypes showing the
intended look and behavior. They are **not** production code to copy verbatim. The task is to
**recreate these designs in your existing stack** (Next.js + Tailwind + shadcn/ui), using its
established components and patterns — by re-skinning the design tokens and composing a small
Bento component layer, then applying it page by page.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final. Recreate
them faithfully. Exact values are in `DESIGN_SYSTEM.md`; when in doubt, open the matching file
in `reference/` and read the inline styles.

## How to instruct Claude Code (the short version)
1. Drop `design_handoff_bento/` into your repo (and copy `CLAUDE.md` to the repo root).
2. **Phase 0 + 1 first** — one session: have Claude Code apply the tokens + fonts
   (`DESIGN_SYSTEM.md §3–§5`) and build the Bento component layer + app shell
   (`ROLLOUT_PLAYBOOK.md` Phase 0–1). Review in light + dark.
3. **Then go page by page** — one session per page using the **prompt template** at the bottom
   of `ROLLOUT_PLAYBOOK.md`. Follow the suggested page order. Review each PR in light + dark
   before moving on.
4. Keep a `MIGRATION.md` tracker of every route’s status.

The golden rule, repeated everywhere: **presentation only — never change data fetching,
routing, permissions, validation, or business logic.**

## Files referenced by the prototypes
- `reference/Bento Rental Admin.html` → dashboard / rentals / fleet / customers in light+dark
  (uses `bento-data.js`, `bento-theme.js`, `ui.jsx`, `bento-shell.jsx`, `bento-screens-1.jsx`,
  `bento-screens-2.jsx`, `design-canvas.jsx`).
- `reference/Bento Rentals Prototype.html` → the interactive Rentals screen: segmented filter,
  search, detail side-sheet, new-rental modal, dark toggle (uses `bento-data.js`,
  `bento-theme.js`, `ui.jsx`).
- `reference/New Rental Agreement Prototype.html` → the full create-form: checklist, live
  preview, validation, loading skeleton, multi-step creation overlay, dark (uses
  `rental-new-data.js`, `bento-theme.js`, `ui.jsx`, `rn-controls.jsx`, `rn-sections.jsx`).
- `reference/bento-theme.js` is the canonical token source (light + dark) — mirror it into
  `DESIGN_SYSTEM.md §3` values when in doubt.

To preview a prototype, open the `.html` file in a browser (they load fonts from Google Fonts
and React via CDN).
