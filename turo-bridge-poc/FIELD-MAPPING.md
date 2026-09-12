# Turo → Drive247 field mapping

Canonical implementation doc: [`../TURO_DRIVE247_EXTENSION_IMPLEMENTATION.md`](../TURO_DRIVE247_EXTENSION_IMPLEMENTATION.md).
This file is the field-level detail that document points at.

**One direction only.** Every arrow below runs Turo → Drive247. Nothing in this
document has a reverse. No Drive247 value is ever written to Turo, and no
request this extension makes to turo.com is anything but a `GET`.

---

## Why the mapping is alias-driven

Turo has no published API for this data, and the two builds we have seen (US and
GB) name the same field differently. So every field is read through a **list of
aliases tried in order**, and the alias that actually matched is recorded
alongside the value.

That record is the point. When Turo renames something, the extension does not
guess and does not silently drop the field — it reports *"no key matched"* with
the list of names it tried, which turns a rename into a one-line fix instead of
an investigation.

Source of truth: `KEYS` in `supabase/functions/turo-bridge-ingest/index.ts`.

---

## 1. Bookings — Turo trip → `turo_bridge_reservations`

| Drive247 column | Turo keys tried, in order | Required? | Notes |
|---|---|---|---|
| `reservation_id` | `reservation_id`, `reservationId`, `id`, `tripId`, `trip_id`, `reservationCode` | **Yes** | Half of the dedupe key. No id → the trip is rejected, never invented. |
| `starts_at` | `starts_at`, `startsAt`, `start`, `startTime`, `pickupTime`, `tripStart`, `startDateTime` | **Yes** | Normalised to ISO. |
| `ends_at` | `ends_at`, `endsAt`, `end`, `endTime`, `returnTime`, `tripEnd`, `endDateTime` | **Yes** | **A missing end date rejects the trip.** A guessed end frees a car that is still rented. |
| `guest_name` | `guest_name`, `guestName`, `renterName`, `renter_name`, `guest`, `driverName` | No | Customer data. Never logged. |
| `turo_guest_id` | `turo_guest_id`, `turoGuestId`, `guestId`, `guest_id`, `renterId`, `driverId` | No | Best identity for a repeat guest. |
| `vehicle_label` | `vehicle_label`, `vehicleLabel`, `vehicleName`, `vehicle_name`, `listingName`, `vehicle` | No | What the operator sees when mapping the car. |
| `vehicle_plate` | `vehicle_plate`, `vehiclePlate`, `plate`, `licensePlate`, `license_plate`, `registration`, `reg` | No | **The only safe join key** — see §4. |
| `turo_vehicle_id` | `turo_vehicle_id`, `turoVehicleId`, `vehicleId`, `vehicle_id`, `listingId`, `listing_id` | No | Stable across a rename; preferred for mapping. |
| `turo_status` | `turo_status`, `turoStatus`, `tripStatus`, `trip_status`, `state`, `reservationStatus` | No | **Turo's word, never ours.** Kept apart from `status`, which is our own import lane. |
| `total_amount` | `total_amount`, `totalAmount`, `total`, `earnings`, `tripTotal`, `amount` | No | |
| `currency` | `currency`, `currencyCode`, `currency_code` | No | Upper-cased. |
| `raw.__turo_timezone` | `timezone`, `timeZone`, `tz`, `locationTimezone` | No | **Only when actually read.** Never assumed — a wrong timezone moves a booking by hours. |
| `superseded_by_reservation_id` | `previousReservationId`, `originalReservationId`, `rebookedFrom`, … | No | ⚠ The aliases read **new → old**; the column stores **old → new**. The direction is inverted on write. |

Also written, by us and not by Turo:

| Column | Meaning |
|---|---|
| `tenant_id` | **From the credential. Never from the request body.** |
| `source` | `turo` (live) or `fixture` (bundled demo). The one thing stopping demo data being mistaken for a booking. |
| `raw` | The whole original object, capped at 64 KB — so a wrongly-mapped column costs one NULL, not the booking. |
| `unmapped` | Every field we could not find, **with the aliases we tried**. |
| `field_confidence` | What evidence each value came from. |
| `last_seen_job_id` | How reconcile knows a booking is still there. |

---

## 2. Customers — Turo guest → `turo_bridge_customers`

Derived **server-side** from the bookings that just landed, not sent separately:
the wire format does not change, an older extension starts populating customers
the moment the function deploys, and the guest can never disagree with the
booking it came from.

| Column | Source |
|---|---|
| `turo_guest_id` | The trip's guest id |
| `display_name` | The trip's guest name |
| `match_key` | **`GENERATED ALWAYS`** — `gid:<guest id>`, or `nm:<normalised name>` when there is no id |
| `display_name_norm` | **`GENERATED ALWAYS`** from `display_name` |
| `match_state` | Always `unmatched` on arrival |
| `matched_customer_id` | Always `NULL` on arrival |

**One row per person, not per booking.** Three trips by one guest produce one
customer.

**Nothing is auto-matched.** Deciding a Turo guest *is* a particular Drive247
customer merges two people's histories, so it stays an operator decision — the
same reasoning that keeps `confirmed_by NOT NULL` on the vehicle map.

`match_key` and `display_name_norm` are generated columns: guest identity is
**derived by the database**, not asserted by whichever client happened to call.

---

## 3. Vehicles — deliberately not auto-mapped

Turo vehicle identity travels **on the booking** (`turo_vehicle_id`,
`vehicle_label`, `vehicle_plate`), and the portal builds its mapping queue from
staged bookings plus the Drive247 fleet.

`turo_vehicle_map` is **not** written by the sync. `confirmed_by` is `NOT NULL`
by design: a mapping says "this Turo car IS that Drive247 car", and getting it
wrong blocks the wrong vehicle's calendar. A human confirms it once, through
`turo-bridge-confirm-vehicle-map`.

**Known gap:** a Turo car with no bookings never reaches the queue. Harmless
today — mapping only matters when there is something to import — but a full
fleet sync would need a staging table that does not yet exist.

---

## 4. Why the plate is the join key

Measured on this database:

- `vehicles.reg` — **unique across all 461 rows.** Safe to join on.
- `vehicles.vin` — **326 distinct values across 400 rows.** Not unique, so a VIN
  match is a *hint* that needs confirming, never an automatic mapping.

Hence the ladder the portal shows, strongest first: `turo_vehicle_id` →
`plate_exact` → `label_plate_parsed` → `vin_unique` → `vin_ambiguous` →
`label_fuzzy` → `unbound`. Everything below `plate_exact` is labelled
*"check this"* on screen.

---

## 5. After promotion — where it lands in the portal

Promotion is an **operator action**, never automatic. Once done:

| Drive247 record | Turo provenance kept |
|---|---|
| `rentals` | `turo_reservation_id`, `turo_promoted_at`, `turo_total_amount`, `turo_vehicle_match`, `turo_promotion_batch_id`, `source` |
| `customers` | `turo_guest_ref`, `turo_promotion_batch_id` |
| `blocked_dates` | `source_type = 'turo'`, `turo_reservation_uid`, `turo_job_id` |

This is what answers *"which of my customers came from Turo?"* — they become
**ordinary Drive247 records** that carry a Turo marker, not a parallel system.

`promote` refuses `source = 'fixture'` outright, and refuses entirely unless the
notification-suppression triggers are installed, so a promotion cannot email or
text a guest or write a payments-ledger receivable.

---

## 6. Fields we deliberately do not take

| Not taken | Why |
|---|---|
| Turo password | Never asked for. The extension reads the session already open in the browser. |
| Guest email / phone | Not needed to prevent a double-booking, and it is somebody's contact data. Add it only when a use demands it. |
| Guest photo, profile, reviews | No use in Drive247. |
| Turo payout and fee breakdown | `total_amount` is enough for reconciliation. |
| Messages between host and guest | Private, and out of scope. |

Minimising what is read is the point: every extra field is another thing to
store, secure, and explain.
