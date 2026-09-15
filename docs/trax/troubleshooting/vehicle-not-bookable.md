# A returned car is not bookable

This is a documented operator playbook, not a live diagnostic result.

1. Identify the actual vehicle, booking channel, pickup/return dates, times and relevant location. Resolve ambiguity before selecting a record.
2. Review public visibility, pause/vehicle state and allowed duration. A missing listing is different from a date conflict.
3. Review relevant rentals and vehicle/global blocked periods. An overdue Active/Started rental can still occupy a car in booking logic. Open-ended rentals need their actual closure rules.
4. If the previous customer reportedly returned the car, distinguish that report from the recorded receiving handover. Inspect the blocking rental, not an unrelated customer page.
5. If no return is recorded, authorized staff can use the existing rental return workflow. It can close the rental and attempt hold release/notifications. TRAX must not execute it.
6. If return receipt and rental/PAYG state disagree, review the discrepancy rather than repeating a side-effecting action.
7. Check the same requested window again after the existing workflow completes. Another booking, block or buffer can remain.

The local model-backed flow can execute this playbook for V2 website visibility/date availability and the limited checkout prechecks. If the model is unconfigured it returns labelled guidance only. Entity resolution uses exact IDs/registration/rental numbers first; ambiguous results require selection. Date availability requires the actual dates and customer browser timezone. Missing-website diagnosis can run without a date window, explicitly omitting duration/location filters not supplied.

Each response carries canonical findings, source records, observation times, evaluated checks and limitations. A rental blocker without rental-view permission is disclosed only as a generic blocker; its identity and receiving history are withheld. Block details similarly require Availability access. Check Again reruns the server-held diagnostic with current authorization and fresh reads. A still-present block or buffer must remain visible after the operator completes the existing return elsewhere.

The checkout trigger is not invoked by a trial INSERT. Its deployed maintenance/swap drift remains an explicit coverage limit. No TRAX method calls markKeyHanded, evaluate_vehicle_health, createBooking, a payment helper or a generic RPC.

Regression fixtures include an overdue Active rental without receiving, a recorded receiving/open-status conflict, PAYG closure conflict, pause/publication/duration/location exclusion, overlapping fleet-wide blocks, turnaround buffers, restricted evidence, partial query limits and API failure. The browser fixture simulates a completed return followed by a remaining fleet-wide block. Fixtures never create or modify production bookings.
