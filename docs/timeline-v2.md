# V2 rental timeline

A shared date-first timeline connects the Rentals calendar with the customer and
vehicle context panels. The individual rental Payment Plan now uses a dedicated
[date-box calendar](rental-period-calendar.md), following the later rental-only
design instruction. The existing V2 tenant gates and routes are
unchanged. The main calendar stays at Rentals → Calendar View.

The complete reference PDF was rendered and visually inspected before changes:
pages 1–6 contain the references; page 7 is blank. The upper screenshot on page 3
was treated as the rental workflow. The later manual-extension requirement takes
precedence over the sketch's “auto” label.

## Entry points

| Route | Integration |
| --- | --- |
| `/rentals` → Calendar View | `rentals-v2/rentals-list-v2.tsx` mounts `ConnectedTimeline` with all bookings. Rental is the default perspective. |
| `/rentals/[id]` | `rental-detail/right-rail.tsx`: Payment Plan is first, with Messages and Activity preserved. |
| `/customers/[id]` | `customer-detail/overview-rail.tsx`: Timeline sits beside At a glance. |
| `/vehicles/[id]` | `vehicles-v2/overview-rail.tsx`: Timeline joins Overview and Activity. |

The existing V2 desktop rail widths and breakpoints are preserved. Legacy pages
use a 360px right rail at 1440px and a context dialog below that width. At smaller widths,
an accessible dialog provides the same contextual tabs. Messages mount only when
that tab opens; merely opening Payment Plan does not mark the conversation read.

All four legacy route branches also mount these shared components. This rollout
has no tenant-name checks; reads and actions still use the existing tenant and
permission context. Legacy Rentals search, status and payment-mode filters carry
into the calendar.

## Shared components

All new production components are in `apps/portal/src/components/timeline-v2/`.

| Component | Responsibility |
| --- | --- |
| `date-grid.tsx` | Shared daily cells, sticky date/identity axes, compact grouped rows, cell prices and endpoint placement. |
| `legacy-detail-timeline.tsx` | Right-hand calendar tabs on tenants using the older record layouts. |
| `model.ts` | Calendar-day arithmetic, real pickup/return boundaries, clipping, lanes, identities and recorded rental segments. |
| `use-timeline-data.ts` | Tenant and record scoped reads, pagination, actual rates, daily overrides and extension history. |
| `timeline-board.tsx` | Shared date axis, perspective control, search, record/status filters, navigation, today, date selection, tooltips and stable booking popovers. |
| `connected-timeline.tsx` | Live integration, permission gates, shared state between compact/expanded views, existing block mutation and existing calendar tools. |
| `rental-plan.tsx`, `rental-period-calendar.tsx`, `rental-period-days.ts` | Rental-only colored date boxes, original/extension periods, monthly navigation and the moving next-date action. |
| `timeline-dialogs.tsx` | Manual extension preview and vehicle-specific blocking forms with inline validation. |
| `history-shortcuts.tsx` | Navigation to earlier, current and next bookings for the selected record. |
| `vehicle-pricing.tsx` | Separate daily, weekly and monthly amounts, with unavailable rates identified. |
| `context-rail.tsx`, `timeline.css` | Contextual tabs, responsive panels, V2 theme styling, focus and reduced-motion treatment. |

## Working behavior

- Rental, Vehicle and Customer perspectives label the same underlying bookings.
  Switching perspective preserves IDs, dates and status; row grouping changes to
  rental, vehicle or customer identity. Short booking hit areas receive separate
  lanes when needed without stretching their actual durations.
- Date headers, sticky identities, daily cells and thin strokes share one scrolling container. Overlaps get
  separate lanes, clipped bookings show continuation, and selecting a date includes
  rentals that started earlier. Open-ended rentals retain an unknown end.
- Week, two-week, calendar-month and custom windows are supported. Custom date
  windows are limited to 93 days for presentation, not as a rental policy.
- Scoped customer and vehicle queries include history outside the current window.
  Record shortcuts navigate that history without inventing availability rules.
- Vehicle date cells use stored custom daily prices or the stored daily base rate.
  Weekly/monthly rates are never divided into daily prices. Registration hiding
  follows the existing tenant setting.
- Block dates uses the existing `useCalendarBlocks().createBlock` mutation and
  availability permission. The dialog names the vehicle and inclusive date range.
  Existing tenant-wide blocks are displayed. Blocking does not move bookings.
- “Pricing & existing tools” preserves access to the previous calendar's controls.
  The previous pricing controls remain available; both main calendar entry points
  now use the shared date grid.

## Local preview and deferred work

Manual extension creation is **unsaved local state**. The original period stays
visible as colored date boxes, extensions are numbered, and “+” moves to the next date.
Each preview starts on the next calendar date, as specified in the reference.
Cancel changes nothing. Previews survive contextual tab switching and are discarded
when the view unmounts or reloads. The individual rental uses monthly navigation
and its period key for long plans, with no horizontal date scrolling.

Recorded extension rows retain their stored dates and return boundaries. The new
dialog does not invoke the existing financial extension workflow. Open-ended,
pay-as-you-go and automatic-billing rentals show an unsupported manual-preview state.

Persisting these new manual previews, automatic extensions and installment flows
remain backend work. No billing calculations, schema changes or pricing predictions
were added.

## Verification

From the repository root:

```sh
npm run dev:portal
node scripts/verify-timeline-v2.cjs
node scripts/check-timeline-v2-types.cjs
```

From `apps/portal` (use `npm.cmd` in Windows PowerShell):

```sh
npm run test -- src/__tests__/lib/timeline-v2.test.ts src/__tests__/components/timeline-data.test.tsx src/__tests__/lib/rental-gate-dismissal.test.ts src/__tests__/lib/lean-areas.test.ts
```

- 68 focused and existing regression tests passed, including rental date boxes, tenant/record scoping,
  1,001-row pagination, registration visibility, date boundaries and lane layout.
- The targeted TypeScript check passed for 28 full source files and changed lines
  in all four legacy route integrations. It reports 19 existing route diagnostics
  outside the changed lines instead of claiming the old pages are type-clean.
  The full portal is not type-clean: its broader check reports existing errors in
  generated routes, React types, financial screens, Supabase types and other areas.
- Browser checks passed at 1440px, 1366px and 390px, including perspective invariance,
  date selection, month lengths, horizontal alignment, keyboard focus, filters,
  cancellation, inline validation, three extensions, prices, blocks and UI states.
  Checks also cover short bookings, dense overlaps in narrow panels, 91-day ranges,
  sticky identities, neutral stroke rendering, and week/two-week views fitting the
  laptop content width without horizontal scrolling.
  Portalled dialogs/popovers also honor reduced motion.
- `git diff --check` passed. `npm run v1:check` could not run its database checks
  because `SUPABASE_ACCESS_TOKEN` is unavailable.

The development-only preview is `/playground/timeline`. Fixtures live only in that
directory and tests; production views never import them. The route returns 404
outside development. The preview's block action is explicitly local, while the
live adapter calls the existing mutation.

Screenshots are generated in `../timeline-review/browser/`, relative to the repo:
`main.png`, `rental.png`, `rental-extensions.png`, `customer.png`, `vehicle.png`,
`main-laptop.png`, `main-vehicles.png`, `main-month.png`, `main-long-range.png`,
`main-dense.png`, `customer-dense-panel.png`, `vehicle-dense-panel.png`, plus
dialog, dark-theme, mobile, laptop-panel and empty/error/loading captures.
These show the production timeline components with isolated fixture records and
a labeled context-layout harness, rather than authenticated live detail pages.

Authenticated live reads/writes and Turo's live behavior remain unverified. No live
bookings, prices or account settings were changed during verification. The
unidentified element above the old calendar was retained pending identification.
