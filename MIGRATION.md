# Bento Migration Tracker — `apps/portal`

Branch: `feat/bento-design-system` · Spec: `design_handoff_bento/`
Rule: **presentation only** — never change data fetching, hooks, routing, permissions, Zod, or edge calls.

Status legend: ⬜ todo · 🟡 in-review · ✅ done

## Phase 0 — Foundation
- ✅ Fonts: Sora + IBM Plex Mono via `next/font/google` (`app/layout.tsx`)
- ✅ Tokens: Bento palette (light + dark) in `src/global.css`, names kept
- ✅ `--bento-*` extras added (both themes) + Tailwind utilities (`bento-*`, `shadow-bento`, `bg-bento-hero`, `rounded-tile`)
- ✅ `--radius: 0.85rem`; Tailwind `fontFamily.sans/mono` → font vars
- ✅ Dark toggle verified gotcha-safe (instant `.dark` swap; tenant branding preserved)

## Phase 1 — Component layer + shell
- ✅ `lib/motion.ts` (ease/dur/springs + stagger/fade/route/shake variants)
- ✅ `components/bento/*` (batch 1): Tile (default/feature/hero/warn/inset), KpiTile (+count-up),
      Eyebrow, Money, StatusPill (+statusTone map), Segmented (sliding indicator),
      EmptyState, ErrorState, StateSwitch, useCountUp, barrel `index.ts`
- ✅ `components/bento/*` (batch 2): SectionCard, TableTile (+bentoTable), SideSheet, Modal,
      Stepper, ProcessOverlay, Shimmer/KpiTileSkeletonRow/TableSkeleton
- ✅ Shell: active sidebar item is already a primary-weak pill via token inheritance;
      page container padding bumped; route-enter transition wired in `(dashboard)/layout.tsx`
- ✅ `components/bento/route-transition.tsx`
- ✅ Full Bento layer typechecks with 0 errors

## Glass material (GLASS.md add-on) ✅
- Tokens `--glass / --glass-2 / --glass-border / --glass-input-bg / --glass-shadow / --glass-blur / --glass-scrim`
  (light + dark) in `global.css`
- `.glass`, `.glass-input`, `.glass-rim` utilities + `@supports` + `prefers-reduced-transparency` fallbacks + `floaty` blob keyframe
- `GlassBackdrop` component (brand-tinted drifting blobs) + Tile `variant="glass"`
- Applied to shared overlays: Dialog/AlertDialog/Sheet content + frosted scrims, Popover, DropdownMenu,
  HoverCard, Command palette, Sonner toast → glass everywhere across all pages automatically
- Bento `Modal` + `SideSheet` inherit glass; Auth screens (login + reset) full glass + ambient backdrop
- Solid `--card` kept for dense data (tables/dashboards/long forms) per spec; 0 new type errors

## Phase 2 — fan-out: multi-agent, grouped by feature ✅ COMPLETE
- 16 agents (17 units), all 76 routes restyled, 110 files edited, **0 logic changes reported**
- Global typecheck: 146 errors (vs 147 baseline → 0 net new); all 76 routes return HTTP 200,
  no compile/runtime errors in the dev log
- Fixed 1 foundation bug surfaced by the run: `SectionCard` `title` collided with Tile's HTML
  `title` attr → `Omit<..., "title">`

### Documented exceptions (intentional, not bugs)
- **Bonzah brand pink** (`#CC004A`) kept as raw hex where paired with the Bonzah logo (3rd-party identity)
- **Recharts series colors** kept literal (data-viz encoding, not chrome — the spec's documented exception)
- A few **informational blue alerts** use theme-aware Tailwind `blue-*` (no raw hex); tokenize later if desired
- Largest pages (`/rentals/new` ~5.6k lines, `/rentals/[id]` ~6.5k lines): header + states + section
  containers re-tiled; deep inner bodies inherit tokens but weren't exhaustively re-composed (follow-up polish)

## Phase 2 — Pages (pattern: D=dashboard, L=list, F=form, T=detail, G=gallery, S=settings, A=auth)

### High-traffic core
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 1 | `/` (dashboard) | D | ✅ |
| 2 | `/rentals` | L | ✅ |
| 3 | `/rentals/new` | F | ✅ |
| 4 | `/rentals/[id]` | T | ✅ |
| 5 | `/rentals/analytics` | D | ✅ |
| 6 | `/vehicles` | G | ✅ |
| 7 | `/vehicles/[id]` | T | ✅ |
| 8 | `/vehicles/analytics` | D | ✅ |
| 9 | `/customers` | L | ✅ |
| 10 | `/customers/[id]` | T | ✅ |
| 11 | `/customers/analytics` | D | ✅ |

### Finance
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 12 | `/payments` | L | ✅ |
| 13 | `/payments/[id]` | T | ✅ |
| 14 | `/payments/analytics` | D | ✅ |
| 15 | `/invoices` | L | ✅ |
| 16 | `/expenses` | L | ✅ |
| 17 | `/credits` | L | ✅ |
| 18 | `/credits/analytics` | D | ✅ |
| 19 | `/fines` | L | ✅ |
| 20 | `/fines/[id]` | T | ✅ |
| 21 | `/fines/new` | F | ✅ |
| 22 | `/fines/analytics` | D | ✅ |
| 23 | `/owner-payouts` | L | ✅ |
| 24 | `/pl-dashboard` | D | ✅ |
| 25 | `/pl-dashboard/monthly/[month]` | D | ✅ |
| 26 | `/reports` | D | ✅ |

### Operations
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 27 | `/pending-bookings` | L | ✅ |
| 28 | `/enquiries` | L | ✅ |
| 29 | `/messages` | L | ✅ |
| 30 | `/reminders` | L | ✅ |
| 31 | `/reminders/analytics` | D | ✅ |
| 32 | `/blocked-dates` (Availability) | L | ✅ |
| 33 | `/blocked-customers` | L | ✅ |
| 34 | `/documents` | L | ✅ |
| 35 | `/documents/analytics` | D | ✅ |
| 36 | `/insurance` | L | ✅ |
| 37 | `/insurances` | L | ✅ |
| 38 | `/insurances/analytics` | D | ✅ |
| 39 | `/agreements` | L | ✅ |
| 40 | `/agreements/analytics` | D | ✅ |
| 41 | `/plates` | L | ✅ |
| 42 | `/plates/[id]` | T | ✅ |
| 43 | `/vehicle-owners` | L | ✅ |
| 44 | `/vehicle-owners/[id]` | T | ✅ |
| 45 | `/audit-logs` | L | ✅ |

### Growth / content
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 46 | `/promotions` | L | ✅ |
| 47 | `/testimonials` | L | ✅ |
| 48 | `/subscription` | D | ✅ |
| 49 | `/users` | L | ✅ |

### CMS
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 50 | `/cms` | D | ✅ |
| 51 | `/cms/home` | F | ✅ |
| 52 | `/cms/about` | F | ✅ |
| 53 | `/cms/fleet` | F | ✅ |
| 54 | `/cms/contact` | F | ✅ |
| 55 | `/cms/privacy` | F | ✅ |
| 56 | `/cms/terms` | F | ✅ |
| 57 | `/cms/promotions` | L | ✅ |
| 58 | `/cms/reviews` | L | ✅ |
| 59 | `/cms/site-settings` | F | ✅ |
| 60 | `/cms/blog` | L | ✅ |
| 61 | `/cms/blog/[id]` | F | ✅ |
| 62 | `/cms/blog/categories` | L | ✅ |
| 63 | `/cms/blog/settings` | F | ✅ |

### Settings
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 64 | `/settings` (+ 22 tabs) | S | ✅ |
| 65 | `/settings/users` | L | ✅ |
| 66 | `/settings/blacklist` | L | ✅ |
| 67 | `/settings/reminders` | F | ✅ |
| 68 | `/settings/email-templates` | L | ✅ |
| 69 | `/settings/email-templates/[key]` | F | ✅ |
| 70 | `/settings/agreement-templates` | L | ✅ |
| 71 | `/settings/agreement-templates/edit` | F | ✅ |

### Auth / utility
| # | Route | Pattern | Status |
|---|-------|---------|--------|
| 72 | `/login` | A | ✅ |
| 73 | `/reset-password` | A | ✅ |
| 74 | `/terms` | A | ✅ |
| 75 | `/veriff-callback` | A | ✅ |
| 76 | `/payment-preview` | (preview) | ✅ |
