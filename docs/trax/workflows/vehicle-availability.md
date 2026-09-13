# Vehicle availability and fleet quotes

## Purpose, location and permissions

Availability explains whether a vehicle can serve a specified booking window. The portal Availability entry maps to /blocked-dates. Rentals has its own calendar, and Fleet Quotes uses /quotes where enabled. Vehicle/availability/rental manager grants are distinct. Fleet Quotes is hidden by the existing lean-area gate; never offer it solely because a route exists.

## Inputs, workflow and effects

Obtain the vehicle and the customer's actual pickup/return dates, times, location and channel. A public listing can disappear because publication is disabled or a vehicle is paused, independently of occupancy. Duration options, supported vehicle statuses, tenant/global blocks and turnaround buffers also matter.

The booking helper rentalOccupiesWindow uses inclusive date overlap and treats overdue Active/Started rentals as occupying the vehicle. A null end is open-ended, not a made-up fixed end. Booking callers select open statuses. Fleet quote rules use times and buffers, recognize valid PAYG closure, and permit exact adjacent time boundaries in cases where the date-only booking helper differs.

Public booking paths, V2 public availability, portal conflicts, Fleet Quotes and the database trigger are not fully unified. The trigger's deployed maintenance/swap clauses are not completely represented by the earlier checked-in definition. A status such as Rented alone is not a universal answer about every future booking window.

## Failure conditions and troubleshooting

Inspect all applicable rules before claiming a cause. An unfinished return is one supported cause, not the default explanation. Maintenance and swaps can create blocked periods; evaluate_vehicle_health is a mutating routine and must not be used as a read-only diagnostic.

Phase 1 provides guidance only. No availability decision, booking-window validation or live recheck is implemented here. Phase 2 must verify deployed trigger definitions and characterize each booking channel before exposing a reason-bearing shared check.

<!-- trax:availability:en -->
A car can be missing or unbookable for several reasons: website visibility, pause or vehicle state, the selected rental duration, another rental, blocked dates or turnaround time. An overdue rental still recorded as active can also hold the vehicle. Start with the correct vehicle and the customer's actual dates and times, then review the vehicle and Availability screens. A recorded return does not rule out another blocker.
<!-- /trax -->
<!-- trax:availability:ur-Latn -->
Gaari nazar na aane ya book na hone ki kai wajah ho sakti hain: website visibility, pause ya vehicle state, rental duration, doosra rental, blocked dates ya turnaround time. Overdue rental jo abhi active recorded hai bhi gaari rok sakta hai. Sahi gaari aur customer ki asal dates aur times se shuru karein, phir vehicle aur Availability screens dekhein. Return recorded hone ke bawajood doosra blocker ho sakta hai.
<!-- /trax -->

## Sources and tests

- `apps/booking/src/lib/vehicle-availability.ts`: rentalOccupiesWindow, OPEN_RENTAL_STATUSES.
- `apps/booking/src/components/MultiStepBookingWidget.tsx`: listing, search and pre-book checks.
- `apps/booking/src/app/booking/vehicles/page.tsx`: public selection filters.
- `apps/portal/src/lib/fleet-quote.ts`: rentalBlocksQuoteWindow, blockBlocksQuoteWindow, buildFleetQuote.
- `supabase/functions/fleet-quote-api/index.ts`: generated quote consumer; not a new TRAX tool.
- `supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql`: check_rental_overlap.
- `supabase/migrations/20260823130000_fleet_health_defect_fixes.sql`: documented deployed drift.
- `apps/portal/src/__tests__/lib/fleet-quote.test.ts`: occupancy, PAYG, buffers and date validation.
- `apps/portal/src/__tests__/lib/fleet-quote-sync.test.ts`: generated parity.

