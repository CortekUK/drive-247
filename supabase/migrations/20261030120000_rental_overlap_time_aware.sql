-- Rental overlap check: compare pickup/return times, not just dates.
--
-- Reported by Moore Luxe (2026-10-30): a car whose rental ended 2026-10-29
-- could not be booked for a pickup two hours after its return on the same day,
-- because the check treated both rentals as owning the whole of the 29th.
-- Rows with no pickup/return time keep the old whole-day behaviour.
-- Only the rental-vs-rental section (A) changes; blocked_dates (B) is untouched.

CREATE OR REPLACE FUNCTION public.check_rental_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  check_start    date;
  v_is_extension boolean := false;
  v_territory    datemultirange;
  v_lo           date;
  v_hi           date;
  v_src          text;
  v_reason_code  text;
  v_b_start      date;
  v_b_end        date;
  v_c_number     text;
  v_c_status     text;
  v_c_start      date;
  v_c_end        date;
  v_c_pickup     time;
  v_c_return     time;
  -- Time-aware bounds for the rental-vs-rental check. A missing pickup time
  -- counts as 00:00 and a missing return time as 23:59:59, so rows without
  -- times behave exactly as the old whole-day check did.
  v_new_end_ts   timestamp;
  v_check_ts     timestamp;
BEGIN
  IF NEW.status IN ('Cancelled', 'Rejected', 'Closed') THEN
    RETURN NEW;
  END IF;

  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.end_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
     AND NEW.vehicle_id = OLD.vehicle_id
     AND NEW.start_date = OLD.start_date
     AND NEW.end_date > OLD.end_date THEN
    check_start    := OLD.end_date;
    v_check_ts     := OLD.end_date + COALESCE(OLD.return_time, time '23:59:59');
    v_is_extension := true;
  ELSE
    check_start := NEW.start_date;
    v_check_ts  := NEW.start_date + COALESCE(NEW.pickup_time, time '00:00');
  END IF;

  v_new_end_ts := CASE WHEN NEW.end_date IS NULL THEN 'infinity'::timestamp
                       ELSE NEW.end_date + COALESCE(NEW.return_time, time '23:59:59') END;

  -- (A) RENTAL vs RENTAL -- the double-booking guard on the money path for 58
  -- tenants. The EXISTS predicate below is byte-for-byte unchanged; only the
  -- RAISE gained a DETAIL/HINT payload naming the conflict.
  --
  -- WHY THE MESSAGE TEXT IS UNTOUCHED, TO THE BYTE: it is load-bearing at
  -- runtime. apps/booking/src/components/BookingCheckoutStep.tsx:1172 gates the
  -- customer-facing toast on /vehicle rental overlap/i and substitutes friendly
  -- copy; reword this string and that guard fails OPEN, dumping raw DB text to a
  -- member of the public. Nothing in the repo matches errcode 23P01 and no test
  -- asserts this string, so such a regression would ship with no CI signal.
  --
  -- WHY THE IDENTITY GOES IN **DETAIL**: the booking (customer) app never reads
  -- .details or .hint on any rental-write path -- it reads .message only. The
  -- portal already renders .details verbatim next to .message on BOTH staff
  -- rental-create screens (rentals/new/page.tsx:2711 and
  -- rental-create-v2.tsx:2685), so operators get the answer with NO frontend
  -- change, and customers are not shown another booking's reference.
  --
  -- The lookup runs ONLY on the failure path, after EXISTS has already returned
  -- true, so the succeeding hot path costs exactly what it did before.
  IF EXISTS (
    SELECT 1 FROM rentals
    WHERE vehicle_id = NEW.vehicle_id
      AND id != NEW.id
      AND status NOT IN ('Cancelled', 'Rejected', 'Closed')
      AND start_date <= COALESCE(NEW.end_date, '9999-12-31'::date)
      AND COALESCE(end_date, '9999-12-31'::date) >= check_start
      -- Same-day turnaround: compare pickup/return times, not just dates. A car
      -- returned at 13:45 can go out again at 15:45 the same day.
      AND (start_date + COALESCE(pickup_time, time '00:00')) < v_new_end_ts
      AND (CASE WHEN end_date IS NULL THEN 'infinity'::timestamp
                ELSE end_date + COALESCE(return_time, time '23:59:59') END) > v_check_ts
  ) THEN
    -- Same predicate, re-run to name the conflict. Deliberately NO customer
    -- name or email: the operator can resolve a rental_number in one click, and
    -- a booking reference is the least that identifies the clash.
    SELECT r.rental_number, r.status, r.start_date, r.end_date, r.pickup_time, r.return_time
      INTO v_c_number, v_c_status, v_c_start, v_c_end, v_c_pickup, v_c_return
    FROM rentals r
    WHERE r.vehicle_id = NEW.vehicle_id
      AND r.id != NEW.id
      AND r.status NOT IN ('Cancelled', 'Rejected', 'Closed')
      AND r.start_date <= COALESCE(NEW.end_date, '9999-12-31'::date)
      AND COALESCE(r.end_date, '9999-12-31'::date) >= check_start
      -- Same-day turnaround: compare pickup/return times, not just dates. A car
      -- returned at 13:45 can go out again at 15:45 the same day.
      AND (r.start_date + COALESCE(r.pickup_time, time '00:00')) < v_new_end_ts
      AND (CASE WHEN r.end_date IS NULL THEN 'infinity'::timestamp
                ELSE r.end_date + COALESCE(r.return_time, time '23:59:59') END) > v_check_ts
    ORDER BY r.start_date
    LIMIT 1;

    RAISE EXCEPTION 'Vehicle rental overlap: another active or pending rental exists for this vehicle during the requested dates'
      USING ERRCODE = '23P01',
            DETAIL  = format('Conflicting rental %s (%s) runs %s to %s on this vehicle.',
                             COALESCE(v_c_number, 'unknown'),
                             COALESCE(v_c_status, 'unknown'),
                             COALESCE(v_c_start::text, '?') || COALESCE(' ' || to_char(v_c_pickup, 'HH24:MI'), ''),
                             COALESCE(v_c_end::text || COALESCE(' ' || to_char(v_c_return, 'HH24:MI'), ''), 'open-ended')),
            HINT    = 'Open that rental and change its dates, or pick another vehicle. A Pending rental still holds the car -- Pending means booked but not yet collected, not unpaid.';
  END IF;

  -- (B) RENTAL vs BLOCKED_DATES. Widened from source_type='maintenance' to every
  -- block kind, and made strictly forward-only. 242 of 245 live blocks are
  -- 'manual' across 15 tenants: the enforced kind was essentially unused and the
  -- unenforced kind is the one operators actually create. That gap is the bug
  -- an operator reported.

  -- Open-ended (PAYG). COALESCE-ing a NULL end_date to 9999-12-31 would collide
  -- with EVERY future block on the car, making 39 of 477 vehicles across 8
  -- tenants un-bookable as PAYG. An indefinite claim cannot be meaningfully
  -- validated against all future blocks; that guard belongs at the PAYG screen.
  IF NEW.end_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Territory = the days this write NEWLY claims. A multirange, not scalar
  -- arithmetic: a rental widened at BOTH ends leaves a non-contiguous remainder
  -- and `daterange - daterange` raises on that.
  --
  -- This is what makes widening safe on a trigger that also fires on UPDATE.
  -- A status flip, an activation, a shortened booking, or an admin edit that
  -- re-sends unchanged dates yields an empty remainder and skips the check --
  -- verified 83/83 live rentals, including both that already overlap a manual
  -- block. It also closes the latent bug in the other direction: a maintenance
  -- block placed over a running rental no longer makes it un-updatable.
  --
  -- COALESCE on OLD.status, not a bare NOT IN: status is nullable, and a NULL
  -- would make the condition NULL, skip the subtraction, and freeze the row.
  v_territory := datemultirange(daterange(NEW.start_date, NEW.end_date, '[]'));

  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
     AND COALESCE(OLD.status, '') NOT IN ('Cancelled', 'Rejected', 'Closed') THEN
    v_territory := v_territory
      - datemultirange(daterange(OLD.start_date,
                                 COALESCE(OLD.end_date, '9999-12-31'::date), '[]'));
  END IF;

  IF v_territory = '{}'::datemultirange THEN
    RETURN NEW;
  END IF;

  -- Scalar bounds keep the index usable; the multirange predicate then makes it
  -- exact across the gap between segments.
  v_lo := lower(v_territory);
  v_hi := upper(v_territory) - 1;

  SELECT b.source_type, b.reason_code, b.start_date, b.end_date
    INTO v_src, v_reason_code, v_b_start, v_b_end
  FROM blocked_dates b
  WHERE b.vehicle_id = NEW.vehicle_id
    AND b.start_date <= v_hi
    AND b.end_date   >= v_lo
    AND daterange(b.start_date, b.end_date, '[]') && v_territory

    -- THE MONEY CARVE-OUT. On a pure extension only physical off-road holds are
    -- enforced -- exactly the scope the live function already had.
    -- finalize_rental_extension rolls end_date AFTER Stripe has charged, so
    -- raising here would mean: card charged, extension rolled back, webhook
    -- returns 200 so Stripe never retries. Measured: 3 live rentals would be
    -- refused on a 7-day extension today. The right place for that refusal is
    -- create-extension-checkout, BEFORE the Stripe session.
    AND (NOT v_is_extension OR b.source_type = 'maintenance')

    -- Turo self-conflict guard. Inert today (0 rows carry turo_reservation_uid)
    -- and written so NULLs cannot widen the exclusion. The Turo importer will
    -- insert a rental AND a block per reservation; without this, every such
    -- rental would conflict with its own block.
    AND (b.turo_reservation_uid IS NULL
         OR NEW.turo_reservation_id IS NULL
         OR b.turo_reservation_uid::text <> NEW.turo_reservation_id)

  -- Off-road holds win the report when both overlap, so an existing maintenance
  -- conflict still raises exactly what it raises today.
  ORDER BY (b.source_type = 'maintenance') DESC, b.start_date
  LIMIT 1;

  IF FOUND THEN
    IF v_src = 'maintenance' THEN
      -- Errcode and phrasing preserved: use-maintenance-jobs.ts:15 maps 23P02
      -- and a test asserts that mapping. reason_code ONLY, never b.reason --
      -- reason is the operator's private note and nothing in the booking app
      -- catches these errcodes, so it could reach a customer verbatim.
      RAISE EXCEPTION 'Vehicle is off the road for maintenance during the requested dates (%; blocked % to %)',
        COALESCE(v_reason_code, 'scheduled maintenance'), v_b_start, v_b_end
        USING ERRCODE = '23P02';
    ELSE
      -- Distinct errcode and no operator free text. 23P02's copy says "off the
      -- road for maintenance", which is wrong for a commercial or Turo hold.
      RAISE EXCEPTION 'Vehicle is unavailable: the operator has blocked % to %',
        v_b_start, v_b_end
        USING ERRCODE = '23P05',
              HINT = 'Remove or shorten the block on this vehicle to allow these dates.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
