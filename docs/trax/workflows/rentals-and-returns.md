# Rentals and return handover

## Purpose, location and permissions

Rentals connect a customer, vehicle, dates and fulfilment steps. Open Rentals, then the rental record. The main Calendar View remains an entry point on the Rentals list. In V2, the record's stages are Customer, Vehicle, When & where, Extras, Agreement, Insurance, Payments and Handover. The default stage is Customer; its heading does not turn this into the separate customer detail page.

Active head_admin, admin, ops and viewer staff can view ordinary rental guidance; managers need a rentals grant. Viewing does not permit editing. A viewer cannot complete return; a manager needs rentals/editor for an edit-oriented link. The existing native return mutation's deployed policies still require verification. Finance capabilities are withheld in TRAX regardless of rental access.

## Prerequisites and workflow

A record must belong to the current tenant. Select the correct customer and vehicle, establish the actual pickup/return window, and complete the requirements shown by the application. Approval, collection/payment, insurance and agreements are separate checks. Do not assume one status proves all prerequisites passed.

The giving handover writes a handover timestamp and can activate a rental when approval and payment requirements pass. It can place a deposit hold and send notifications. Receiving handover closes the rental, updates vehicle status and attempts hold release and completion notification. These operations are not one transaction; a failed hold release can leave a separate follow-up task after the keys were recorded.

PAYG closure also has a dedicated finalization flow. A manual status change is not a substitute for settling that workflow. Fixed rental periods and extensions must retain their original dates; the Payment Plan calendar includes explicitly unsaved frontend extension previews. A preview is not a persisted extension or a billing change.

## Blockers and safe troubleshooting

A car can remain occupied while an Active/Started rental is overdue and not released in the booking logic. Confirm the record before completing any return. A customer saying keys were returned is useful reported evidence, not proof of a saved handover. If return timestamps and rental state conflict, do not repeat an action blindly. Inspect the existing record and seek authorized operational review.

A successful return does not prove a deposit was released or that another booking/block/buffer no longer applies. The guidance below explains the workflow; Phase 1 cannot diagnose a live rental.

## Prepared support sections

<!-- trax:rentals:en -->
Open **Rentals**, then select the rental. Review the customer, vehicle, dates and the requirements shown on that record. Approval, agreement, insurance, payment and handover are separate steps; completing one does not prove the others are finished. In V2 these are contextual stages, starting with Customer. Use the existing controls for changes you are permitted to make.
<!-- /trax -->
<!-- trax:rentals:ur-Latn -->
**Rentals** kholein aur rental select karein. Customer, gaari, dates aur record par dikhayi gayi requirements dekhein. Approval, agreement, insurance, payment aur handover alag steps hain; aik step complete hone se baqi complete nahi hote. V2 mein ye stages hain aur pehla Customer hai. Tabdeeli sirf apni ijazat ke mutabiq existing controls se karein.
<!-- /trax -->
<!-- trax:returns:en -->
To record a returned car, open the rental and its **Handover** stage in V2, or the existing key-handover section in the other layout. Authorized staff confirm receipt there. This can close the rental, update the vehicle and attempt deposit-hold release and a completion notification. If the record already shows receipt or contains conflicting states, review it before repeating the action. Physical return and the system's recorded return are separate facts.
<!-- /trax -->
<!-- trax:returns:ur-Latn -->
Wapas aayi gaari record karne ke liye rental kholein. V2 mein **Handover** stage, aur doosre layout mein key-handover section dekhein. Authorized staff wahin receipt confirm kare. Is se rental close, vehicle update aur deposit hold release aur notification ki koshish ho sakti hai. Agar receipt pehle se recorded hai ya states mukhtalif hain, action dohrane se pehle review karein. Gaari ka wapas aana aur system mein return record hona alag baatein hain.
<!-- /trax -->

## Source and test references

- `apps/portal/src/components/rentals-v2/rental-detail/stages.ts`: STAGES, readStage, stageHref.
- `apps/portal/src/hooks/use-key-handover.ts`: useKeyHandover, markKeyHanded.
- `supabase/functions/finalize-payg-rental/index.ts`: dedicated PAYG closure.
- `docs/rental-period-calendar.md`: original and preview extension periods.
- `apps/portal/src/__tests__/lib/trax-support.test.ts`: guidance, ownership and navigation restrictions.
- Native return workflow end-to-end/transaction guarantees: **not verified**.

