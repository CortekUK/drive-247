# Individual rental full-month date-box calendar

Payment Plan uses `rental-period-calendar.tsx` and its dedicated CSS. The sidebar
shows every real date of the selected month, beginning with 1. The grid fills the
available sidebar height, with a 42px minimum row height, bold 17px numbers, 2px
gaps and responsive columns. Dates outside this rental's periods remain neutral.
Only date numbers appear in tiles. A compact month heading and a small Manage
button sit above the grid; longer histories retain month navigation. There is no
inner card, permanent period breakdown, horizontal scrolling, or artificial dates.
Rental-only tab padding is 10px vertically and 12px horizontally.

The rental calendar is isolated to `rental-period-calendar.tsx`, its CSS,
`rental-plan.tsx` and the rental-only `rental-period-days.ts` date presentation.
The full-month follow-up changes only the CSS and date presentation. The main Rentals, customer
and vehicle calendars retain their shared line renderer. No shared calendar,
navigation, routes, queries, permissions, Messages or Activity components were edited.

Original and extension fills use the V2 indigo/violet chart accent family, with
deterministic shades assigned by extension sequence. Status colors are not used.
The same shade appears in date boxes, hover/focus previews and dialog indicators,
including across month changes. Dark mode uses the existing theme with readable
foreground text. Period names remain available on hover, keyboard focus and date
selection, rather than being repeated in every tile.

`rental-period-days.ts` projects the existing `rentalSegments` data onto
calendar dates. It reuses the existing booking boundaries, including return times
and midnight/exclusive endpoints. If two recorded periods share part of a date,
that date box contains both proportional fills, with both names in its preview
and selected-date details. Gaps stay neutral.
No rental, extension or billing data is changed by this presentation.

Manage opens the detailed period list, recorded context, extension action and
discard-preview control. Selecting a date opens this same supporting dialog with
the selected date identified. Show dates returns to that period in the sidebar.
The calendar itself remains embedded and visible without opening a dialog.

The existing manual-extension dialog and validation are retained. Its action now
lives in Manage; preview confirmation adds new colored dates and updates the next
extension boundary. Cancel makes no changes. New extensions remain local,
explicitly unsaved previews, with a compact preview count below the grid. Recorded
extensions are labeled separately in Manage. Dialogs return focus to their opener.
Existing edit permissions govern extension actions; open-ended/unsupported rentals
continue to show the existing manual-preview limitation.

Validation:

- 68 focused and existing tests passed, including five date-box boundary tests.
- Targeted TypeScript checks passed. The broader portal still has existing type errors.
- Both `scripts/verify-timeline-v2.cjs` and `scripts/verify-rental-periods.cjs` passed.
  Browser cases include sequential previews, cancellation, discard, tab persistence,
  recorded/shared dates, month/year boundaries, stable shade assignments, matching
  detail swatches, responsive keyboard navigation, focus restoration, read-only
  access, loading/error/empty states, dark mode and mobile dialogs. The broader
  browser script also exercises main/customer/vehicle calendars for regressions.
- Content hashes confirmed 76 protected shared/main/customer/vehicle and detail
  component files were unchanged during the full-month follow-up.

Development fixtures live under `app/playground/timeline/`; production components
never import them. Screenshots are in `../timeline-review/rental-full-month/`, including
`two-extensions.png`, `manage.png`, `selected-date.png`, `recorded-extensions.png`,
`two-extensions-dark.png`, `cross-month.png`, `long-rental.png`, `year-boundary.png`
and `mobile.png`.
They show the production calendar component with isolated fixtures. Authenticated
live tenant pages and backend writes were not exercised during this review.
