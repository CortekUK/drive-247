# Vehicle availability and fleet quotes

## Purpose, location and permissions

Availability explains whether a vehicle can serve a specified booking window. The portal Availability entry maps to /blocked-dates. Rentals has its own calendar, and Fleet Quotes uses /quotes where enabled. Vehicle/availability/rental manager grants are distinct. Fleet Quotes is hidden by the existing lean-area gate; never offer it solely because a route exists.

## Inputs, workflow and effects

Obtain the vehicle and the customer's actual pickup/return dates, times, location and channel. A public listing can disappear because publication is disabled or a vehicle is paused, independently of occupancy. Duration options, supported vehicle statuses, tenant/global blocks and turnaround buffers also matter.

The booking helper rentalOccupiesWindow uses inclusive date overlap and treats overdue Active/Started rentals as occupying the vehicle. A null end is open-ended, not a made-up fixed end. Booking callers select open statuses. Fleet quote rules use times and buffers, recognize valid PAYG closure, and permit exact adjacent time boundaries in cases where the date-only booking helper differs.

Public booking paths, V2 public availability, portal conflicts, Fleet Quotes and the database trigger are not fully unified. The trigger's deployed maintenance/swap clauses are not completely represented by the earlier checked-in definition. A status such as Rented alone is not a universal answer about every future booking window.

## Failure conditions and troubleshooting

Inspect all applicable rules before claiming a cause. An unfinished return is one supported cause, not the default explanation. Maintenance and swaps can create blocked periods; evaluate_vehicle_health is a mutating routine and must not be used as a read-only diagnostic.

The local operational milestone implements reason-bearing V2 checks through `diagnoseVehicleAvailability`; model access is policy-gated. The deployed trigger remains unverified, so checkout results are explicitly partial. No booking write or health evaluator is invoked.

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


## Verified V2 channel distinctions (local operational milestone)

- `useVehicles` and `FleetSeed` share `applyWebsiteVisibility`: status is case-insensitive Available/Rented; is_paused must be false; show_on_website must not be false; is_disposed must not be true. These nullable flags have different SQL semantics. `useVehicle` on a direct vehicle detail page does not apply the listing publication filter.
- With actual start/end dates, `resolveDurationTier` uses calendar-day difference with minimum one day: tenant monthly threshold (default 30), then seven days for weekly, otherwise daily. The corresponding available_daily/weekly/monthly flag must be true. No price conversion is performed. An explicit pickup location permits a null vehicle location or the same location.
- `useVehicleAvailability` excludes Cancelled/Rejected/Closed/Completed via a query before `rentalOccupiesWindow`. Inclusive date overlap or overdue Active/Started occupancy blocks. An unknown non-null status is not silently treated as released. Null end remains open-ended; PAYG closure is not substituted from the distinct Fleet Quote logic.
- Manual blocks include vehicle-specific and null-vehicle tenant-wide rows overlapping inclusively.
- The buffer checks Completed rentals only, with the existing bounded end-date scan and return_time fallback 23:59. Pickup is midnight on the chosen day in the customer's browser timezone. TRAX asks for that timezone; it does not infer it from staff location. Nonexistent/invalid local times produce incomplete coverage. No actual pickup time is invented.
- `createBooking` has side effects and is never invoked by TRAX. Its courtesy overlap query uses `applyCheckoutOverlap`, which excludes Cancelled/Rejected/Closed but includes Completed; it does not apply the date filter's overdue extension. The final database trigger, customer/draft reuse and all write-time validations are outside this read-only diagnosis. A negative precheck is not proof checkout will succeed.
- `useVehicleBookedDates` uses a narrower open-status list and a display horizon for open-ended bookings. No calendar logic or horizon is used to manufacture a rental end date.

The shared pure rules are generated into the backend artifact and parity-checked. Truncated queries and failed reads cannot establish complete availability. Different reads are observations, not an atomic booking lock.

Sources: `v2/apps/web/src/lib/vehicles/availability-rules.ts` (rentalOccupiesWindow, applyWebsiteVisibility, applyCheckoutOverlap, bufferOccupiesPickup, durationTierForDays), `v2/apps/web/src/hooks/use-vehicle-availability.ts`, `v2/apps/web/src/hooks/use-vehicles.ts`, `v2/apps/web/src/components/fleet/fleet-seed.ts`, `v2/apps/web/src/lib/booking/create-booking.ts`, `supabase/functions/trax-support/support/operational-tools.ts`. Tests: `trax-operational.test.ts`.

<!-- trax:v2-availability:en -->
First distinguish missing from the V2 website, unavailable for selected dates, and checkout rejection. Use the actual vehicle and booking window; do not invent dates. The V2 fleet requires Available/Rented status, pause explicitly off, website publication not off and disposal not on. With dates it also checks the vehicle's duration flag; a selected pickup location must match or the vehicle can have no assigned location.
For website date availability, use the customer's browser timezone. Open rental overlap is inclusive; overdue Active/Started rentals can keep a car occupied, and an absent end remains open-ended. Vehicle and fleet-wide blocked periods and the tenant turnaround buffer are separate checks. The buffer uses pickup-day midnight, Completed rentals and the recorded return time (23:59 if absent). Another blocker may remain after a return.
Checkout's read-only precheck differs: it can include Completed rentals and does not add the date filter's overdue rule. The final database trigger and other write-time validations have not been run by TRAX, so this result is partial and cannot promise a booking will succeed. If a receiving handover or PAYG closure is recorded but the blocking rental is still open, review the conflict rather than repeating a return action. Check Again must rerun current reads. An operator's physical-return report is not independent system evidence.
<!-- /trax -->
<!-- trax:v2-availability:ur-Latn -->
Pehle samjhein: gaari V2 website par nazar nahi aa rahi, chuni hui dates par unavailable hai, ya checkout reject hota hai? Asal gaari aur booking dates lein; dates khud na banayein. Website fleet mein Available/Rented status, pause off, publication off na ho aur disposal on na ho zaroori hai. Dates hon to duration option bhi enabled ho; chuni hui pickup location vehicle ki location se match kare ya vehicle par location na lagi ho.
Date availability ke liye customer ke browser ka timezone lein. Rental dates inclusive hain. Overdue Active/Started rental bhi gaari rok sakta hai; end date na ho to khud end na banayein. Vehicle ya poori fleet ke blocked dates aur turnaround buffer alag checks hain. Buffer pickup day ki midnight, Completed rentals aur recorded return time use karta hai; time na ho to 23:59. Return ke baad bhi doosra blocker reh sakta hai.
Checkout ka read-only precheck alag hai: Completed rental bhi count ho sakta hai. Final database trigger aur write-time validations TRAX run nahi karta, is liye checkout result partial hai, booking success ki guarantee nahi. Receiving ya PAYG closure recorded ho lekin rental abhi open ho to conflict review karein; return dobara na chalayein. Check Again fresh records dekhta hai. Aap ka kehna ke car aur keys wapis hain operator ki report hai, independent verification nahi.
<!-- /trax -->
