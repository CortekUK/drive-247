import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGREEMENT_TIMEZONE,
  buildRentalTimeFacts,
  buildTimeVariables,
  formatDateOnly,
  formatScheduledDateTime,
  formatTimeOfDay,
  formatZonedDate,
  formatZonedDateTime,
  isValidTimeZone,
  resolveAgreementTimeZone,
  zoneAbbreviation,
} from '@/lib/agreement-datetime';

/**
 * These cover the defect that started this work: a rental ended in an accident,
 * the insurer asked for the time the vehicle was collected and returned, and no
 * document the system produced stated either — while the timestamps had been in
 * `rental_key_handovers.handed_at` the whole time.
 *
 * The rules worth protecting are (1) a scheduled wall-clock time is never
 * converted, (2) an actual instant always is, and (3) an unknown time renders as
 * nothing rather than as a guess.
 */

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const LONDON = 'Europe/London';

describe('formatTimeOfDay', () => {
  it('formats the Postgres time value that used to reach signed contracts raw', () => {
    // The bug: {{pickup_time}} interpolated rental.pickup_time directly, so a
    // customer signed a contract reading "Pickup Time: 14:00:00".
    expect(formatTimeOfDay('14:00:00')).toBe('2:00 PM');
    expect(formatTimeOfDay('14:30')).toBe('2:30 PM');
  });

  it('handles both midnights, which 12-hour clocks routinely get wrong', () => {
    expect(formatTimeOfDay('00:00:00')).toBe('12:00 AM');
    expect(formatTimeOfDay('12:00:00')).toBe('12:00 PM');
    expect(formatTimeOfDay('12:01')).toBe('12:01 PM');
    expect(formatTimeOfDay('23:59')).toBe('11:59 PM');
  });

  it('returns empty for anything unparseable so the row drops out entirely', () => {
    // removeEmptyFields deletes <tr> whose value cell is blank. Returning a
    // marker string like "Invalid" would print a defect into a signed document.
    for (const bad of [null, undefined, '', 'not a time', '25:00', '10:75', 'N/A']) {
      expect(formatTimeOfDay(bad as never)).toBe('');
    }
  });
});

describe('formatDateOnly', () => {
  it('keeps the calendar day a `date` column holds, in any process timezone', () => {
    // The classic off-by-one: new Date("2026-08-03") is UTC midnight, which is
    // Aug 2 anywhere west of Greenwich. Parsing at UTC noon makes the day
    // survive projection into every real zone.
    expect(formatDateOnly('2026-08-03')).toBe('August 3, 2026');
    expect(formatDateOnly('2026-01-01')).toBe('January 1, 2026');
    expect(formatDateOnly('2026-12-31')).toBe('December 31, 2026');
  });

  it('accepts a full timestamp string by using its date part', () => {
    expect(formatDateOnly('2026-08-03T23:30:00+00:00')).toBe('August 3, 2026');
  });

  it('returns empty rather than "Invalid Date"', () => {
    expect(formatDateOnly(null)).toBe('');
    expect(formatDateOnly('')).toBe('');
    expect(formatDateOnly('nonsense')).toBe('');
  });
});

describe('formatZonedDateTime — the actual handover instant', () => {
  it('projects a timestamptz into the tenant zone, not the process zone', () => {
    // 2026-08-04T18:46:00Z is 2:46 PM in New York (EDT, UTC-4).
    expect(formatZonedDateTime('2026-08-04T18:46:00Z', NY)).toBe(
      'August 4, 2026 at 2:46 PM EDT',
    );
  });

  it('gives genuinely different readings per zone for the same instant', () => {
    const instant = '2026-08-04T18:46:00Z';
    expect(formatZonedDateTime(instant, NY)).toContain('2:46 PM');
    expect(formatZonedDateTime(instant, LA)).toContain('11:46 AM');
    // Same instant, and in London it is already the evening.
    expect(formatZonedDateTime(instant, LONDON)).toContain('7:46 PM');
  });

  it('rolls the DATE, not just the clock, when the zone crosses midnight', () => {
    // 03:30Z on Aug 5 is still 11:30 PM on Aug 4 in New York. A document that
    // printed Aug 5 here would misstate the day of an accident.
    expect(formatZonedDateTime('2026-08-05T03:30:00Z', NY)).toBe(
      'August 4, 2026 at 11:30 PM EDT',
    );
  });

  it('resolves the DST label from the instant, not from today', () => {
    // A vehicle collected in August and returned in November crosses the DST
    // boundary; one shared label would misstate one of them by an hour.
    expect(formatZonedDateTime('2026-08-04T18:46:00Z', NY)).toContain('EDT');
    expect(formatZonedDateTime('2026-12-04T18:46:00Z', NY)).toContain('EST');
  });

  it('returns empty for a handover that has not happened', () => {
    // handed_at is NULL until an operator confirms — rows exist from the moment
    // anyone uploads a photo or types an odometer reading.
    expect(formatZonedDateTime(null, NY)).toBe('');
    expect(formatZonedDateTime(undefined, NY)).toBe('');
    expect(formatZonedDateTime('not-a-date', NY)).toBe('');
  });

  it('does not throw on an unusable timezone', () => {
    expect(() => formatZonedDateTime('2026-08-04T18:46:00Z', 'Mars/Olympus')).not.toThrow();
  });
});

describe('formatZonedDate — the agreement date stamp', () => {
  it('stamps the tenant day, not the UTC day, late in the evening', () => {
    // The live defect: these routes run on Vercel with TZ=UTC, so a bare
    // toLocaleDateString put TOMORROW's date on any agreement generated after
    // 20:00 Eastern. 2026-09-04T01:30Z is still Sep 3 in New York.
    expect(formatZonedDate('2026-09-04T01:30:00Z', NY)).toBe('September 3, 2026');
    expect(formatZonedDate('2026-09-04T01:30:00Z', 'UTC')).toBe('September 4, 2026');
  });

  it('is worse for Pacific tenants, and handles that too', () => {
    // 2026-09-04T02:00Z is 7pm Sep 3 in Los Angeles.
    expect(formatZonedDate('2026-09-04T02:00:00Z', LA)).toBe('September 3, 2026');
  });
});

describe('formatScheduledDateTime — the wall clock that must NOT be converted', () => {
  it('echoes the agreed local time back unchanged, whatever the zone', () => {
    // pickup_time is `time without time zone`. "10:00" is already local; there
    // is no instant to convert. Converting it would invent an offset.
    const inNy = formatScheduledDateTime('2026-08-03', '10:00:00', NY);
    const inLa = formatScheduledDateTime('2026-08-03', '10:00:00', LA);
    expect(inNy).toContain('August 3, 2026 at 10:00 AM');
    expect(inLa).toContain('August 3, 2026 at 10:00 AM');
    // Only the label differs.
    expect(inNy).not.toBe(inLa);
  });

  it('degrades to the date alone when no time was agreed', () => {
    // A rental with no pickup time has not agreed one. A contract must not
    // assert midnight on the customer's behalf.
    expect(formatScheduledDateTime('2026-08-03', null, NY)).toBe('August 3, 2026');
    expect(formatScheduledDateTime('2026-08-03', '', NY)).toBe('August 3, 2026');
  });

  it('returns empty with no date at all (an open-ended PAYG return)', () => {
    expect(formatScheduledDateTime(null, '10:00', NY)).toBe('');
  });

  it('labels the zone as of the scheduled date, not today', () => {
    expect(formatScheduledDateTime('2026-01-15', '10:00', NY)).toContain('EST');
    expect(formatScheduledDateTime('2026-07-15', '10:00', NY)).toContain('EDT');
  });
});

describe('resolveAgreementTimeZone', () => {
  it("uses the OPERATOR's zone and deliberately ignores customer_timezone", () => {
    // A handover is an operator event — handed_at is stamped when staff press
    // "Key Handed". Rendering it in the renter's zone would state a time nobody
    // present observed, and would disagree with the portal screen, which is the
    // exact confusion this work exists to end.
    expect(
      resolveAgreementTimeZone({ customer_timezone: LA }, { timezone: NY }),
    ).toBe(NY);
  });

  it('falls back to the documented default when the tenant names no zone', () => {
    expect(resolveAgreementTimeZone({ customer_timezone: null }, { timezone: LA })).toBe(LA);
    expect(resolveAgreementTimeZone(null, null)).toBe(DEFAULT_AGREEMENT_TIMEZONE);
    expect(resolveAgreementTimeZone(undefined, { timezone: null })).toBe(
      DEFAULT_AGREEMENT_TIMEZONE,
    );
    // Not the customer's zone, even when the tenant has none.
    expect(resolveAgreementTimeZone({ customer_timezone: LA }, null)).toBe(
      DEFAULT_AGREEMENT_TIMEZONE,
    );
  });

  it('ignores a corrupt zone rather than letting Intl throw mid-send', () => {
    // tenants.timezone is nullable text with no constraint. A bad value in one
    // tenant's settings must not be able to stop that tenant issuing contracts.
    expect(resolveAgreementTimeZone(null, { timezone: 'Not/AZone' })).toBe(
      DEFAULT_AGREEMENT_TIMEZONE,
    );
    expect(resolveAgreementTimeZone(null, { timezone: '' })).toBe(DEFAULT_AGREEMENT_TIMEZONE);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(NY)).toBe(true);
  });
});

describe('zoneAbbreviation', () => {
  it('tracks DST for the given instant', () => {
    expect(zoneAbbreviation(NY, new Date('2026-08-04T18:46:00Z'))).toBe('EDT');
    expect(zoneAbbreviation(NY, new Date('2026-12-04T18:46:00Z'))).toBe('EST');
  });

  it('returns empty instead of throwing on a bad zone', () => {
    expect(zoneAbbreviation('Mars/Olympus', new Date(0))).toBe('');
  });
});

describe('buildRentalTimeFacts', () => {
  const rental = {
    start_date: '2026-08-03',
    end_date: '2026-08-13',
    pickup_time: '10:00:00',
    return_time: '16:30:00',
    customer_timezone: null,
  };
  const tenant = { timezone: NY };

  it('reads the actual times off the handover rows', () => {
    const facts = buildRentalTimeFacts(rental, tenant, [
      { handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: 48210 },
      { handover_type: 'receiving', handed_at: '2026-08-13T15:12:00Z', mileage: 48935 },
    ]);
    expect(facts.collectedAt).toBe('August 4, 2026 at 2:46 PM EDT');
    expect(facts.returnedAt).toBe('August 13, 2026 at 11:12 AM EDT');
    expect(facts.collectionMileage).toBe('48210');
    expect(facts.returnMileage).toBe('48935');
    expect(facts.hasActualTimes).toBe(true);
  });

  it('keeps the scheduled and actual times as separate facts when they disagree', () => {
    // This is the real case that prompted the work: booked for Aug 3, keys
    // actually handed over on Aug 4. Both are true and the document states both.
    const facts = buildRentalTimeFacts(rental, tenant, [
      { handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: null },
    ]);
    expect(facts.scheduledPickup).toBe('August 3, 2026 at 10:00 AM EDT');
    expect(facts.collectedAt).toBe('August 4, 2026 at 2:46 PM EDT');
    expect(facts.scheduledPickup).not.toBe(facts.collectedAt);
  });

  it('treats a handover row with a NULL handed_at as not yet handed over', () => {
    // Rows are created by photo/note/odometer entry long before the keys move.
    const facts = buildRentalTimeFacts(rental, tenant, [
      { handover_type: 'giving', handed_at: null, mileage: 48210 },
    ]);
    expect(facts.collectedAt).toBe('');
    expect(facts.hasActualTimes).toBe(false);
    // And the odometer reading is withheld too — pairing mileage with a blank
    // timestamp would imply a handover that has not happened.
    expect(facts.collectionMileage).toBe('');
  });

  it('handles a collected-but-not-returned rental', () => {
    const facts = buildRentalTimeFacts(rental, tenant, [
      { handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: 48210 },
    ]);
    expect(facts.collectedAt).not.toBe('');
    expect(facts.returnedAt).toBe('');
    expect(facts.hasActualTimes).toBe(true);
  });

  it('survives no handovers, null handovers and a non-array', () => {
    for (const input of [[], null, undefined, 'nope' as never]) {
      const facts = buildRentalTimeFacts(rental, tenant, input as never);
      expect(facts.hasActualTimes).toBe(false);
      expect(facts.collectedAt).toBe('');
      // Scheduled times still resolve — they come from the rental itself.
      expect(facts.scheduledPickup).toBe('August 3, 2026 at 10:00 AM EDT');
    }
  });

  it('survives a null rental without throwing', () => {
    const facts = buildRentalTimeFacts(null, null, []);
    expect(facts.timeZone).toBe(DEFAULT_AGREEMENT_TIMEZONE);
    expect(facts.scheduledPickup).toBe('');
    expect(facts.hasActualTimes).toBe(false);
  });

  it('leaves an open-ended PAYG return blank rather than inventing one', () => {
    const facts = buildRentalTimeFacts(
      { ...rental, end_date: null },
      tenant,
      [],
    );
    expect(facts.scheduledReturn).toBe('');
  });

  it('keeps the whole document in one zone, the operator\'s', () => {
    // Mixing zones inside one table makes the scheduled and actual rows
    // non-comparable, and comparing them is why a claims handler reads the page.
    const facts = buildRentalTimeFacts(
      { ...rental, customer_timezone: LA },
      tenant,
      [{ handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: null }],
    );
    expect(facts.timeZone).toBe(NY);
    expect(facts.collectedAt).toBe('August 4, 2026 at 2:46 PM EDT');
    expect(facts.scheduledPickup).toContain('EDT');
  });

  it('sets hasAnyTimes from the scheduled times so a SIGNED agreement gets them', () => {
    // An agreement is signed before collection, so gating injection on an actual
    // handover would leave the contract the customer signs stating no times.
    const beforeCollection = buildRentalTimeFacts(rental, tenant, []);
    expect(beforeCollection.hasActualTimes).toBe(false);
    expect(beforeCollection.hasAnyTimes).toBe(true);
  });

  it('leaves hasAnyTimes false when the operator records no time of day at all', () => {
    // Then the block would add nothing the Start/End Date rows do not say.
    const noTimes = buildRentalTimeFacts(
      { ...rental, pickup_time: null, return_time: null },
      tenant,
      [],
    );
    expect(noTimes.hasAnyTimes).toBe(false);
    const collected = buildRentalTimeFacts(
      { ...rental, pickup_time: null, return_time: null },
      tenant,
      [{ handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: null }],
    );
    expect(collected.hasAnyTimes).toBe(true);
  });

  it('labels a scheduled time on a DST changeover day with the hour that applied', () => {
    // US zones switch at 02:00 local. Anchoring the label at noon would stamp a
    // 01:00 collection on 1 Nov 2026 as EDT when it is really EST.
    const early = buildRentalTimeFacts(
      { ...rental, start_date: '2026-11-01', pickup_time: '01:00' },
      tenant,
      [],
    );
    expect(early.scheduledPickup).toContain('EDT');
    const late = buildRentalTimeFacts(
      { ...rental, start_date: '2026-11-01', pickup_time: '15:00' },
      tenant,
      [],
    );
    expect(late.scheduledPickup).toContain('EST');
  });

  it('records a genuine zero odometer reading', () => {
    // A brand-new vehicle can legitimately read 0; a truthy check would drop it.
    const facts = buildRentalTimeFacts(rental, tenant, [
      { handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: 0 },
    ]);
    expect(facts.collectionMileage).toBe('0');
  });
});

describe('buildTimeVariables', () => {
  const facts = buildRentalTimeFacts(
    {
      start_date: '2026-08-03',
      end_date: '2026-08-13',
      pickup_time: '10:00:00',
      return_time: '16:30:00',
      customer_timezone: null,
    },
    { timezone: NY },
    [
      { handover_type: 'giving', handed_at: '2026-08-04T18:46:00Z', mileage: 48210 },
      { handover_type: 'receiving', handed_at: '2026-08-13T15:12:00Z', mileage: 48935 },
    ],
  );

  it('exposes every placeholder the templates and injection block reference', () => {
    const vars = buildTimeVariables(facts);
    // Any name here that the engines stop supplying would survive as literal
    // "{{...}}" text in a signed PDF, so the list is asserted explicitly.
    for (const key of [
      'pickup_time',
      'return_time',
      'pickup_datetime',
      'return_datetime',
      'rental_start_datetime',
      'rental_end_datetime',
      'vehicle_collected_at',
      'vehicle_returned_at',
      'collection_mileage',
      'return_mileage',
      'rental_timezone',
    ]) {
      expect(vars).toHaveProperty(key);
      expect(typeof vars[key]).toBe('string');
    }
  });

  it('overrides the legacy raw pickup_time/return_time values', () => {
    const vars = buildTimeVariables(facts);
    expect(vars.pickup_time).toBe('10:00 AM');
    expect(vars.return_time).toBe('4:30 PM');
    // Specifically not the raw column value.
    expect(vars.pickup_time).not.toContain(':00:00');
  });

  it('names the timezone so the reader never has to infer it', () => {
    expect(buildTimeVariables(facts).rental_timezone).toBe(NY);
  });

  it('emits empty strings, never null, so substitution cannot print "null"', () => {
    const empty = buildTimeVariables(buildRentalTimeFacts(null, null, []));
    for (const value of Object.values(empty)) {
      expect(value).not.toBeNull();
      expect(typeof value).toBe('string');
    }
  });
});
