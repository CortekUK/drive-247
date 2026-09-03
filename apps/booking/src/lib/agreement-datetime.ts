/**
 * Timezone-correct date/time rendering for rental agreements and rental records.
 *
 * THE PROBLEM THIS SOLVES
 * A signed rental agreement stated DATES only. When a rental ends in an insurance
 * claim, the adjuster asks for the time the vehicle was collected and the time it
 * was returned, and the operator had nothing to send but a screenshot of an admin
 * screen. The timestamps existed all along — `rental_key_handovers.handed_at` —
 * they were simply never rendered into any document the customer or an insurer
 * could be given.
 *
 * WHY A DEDICATED MODULE RATHER THAN date-fns-tz
 * This file is duplicated byte-for-byte into the Deno edge runtime (see the
 * copy rule below), which resolves npm imports differently from the Next bundlers.
 * `Intl.DateTimeFormat` is built into both runtimes, needs no dependency, and is
 * the same implementation in each — so the three copies cannot drift in behaviour
 * even though they cannot share an import.
 *
 * THE TWO KINDS OF TIME, AND WHY CONFLATING THEM IS THE BUG
 * They are not interchangeable and must never be formatted by the same function:
 *
 *   1. SCHEDULED time — `rentals.pickup_time` / `return_time`, Postgres `time`
 *      (no zone), paired with a `date` column. This is a WALL CLOCK. "10:00" is
 *      already the local time somebody chose; there is no instant to convert, and
 *      running it through any UTC-aware conversion invents an offset and shifts
 *      the day. It is rendered as text, with the zone named alongside it.
 *
 *   2. ACTUAL time — `rental_key_handovers.handed_at`, Postgres `timestamptz`.
 *      This IS a real instant. It has no meaning until projected into a zone, and
 *      projecting it into the WRONG zone is how "2:46 PM" becomes "7:46 PM" on a
 *      document an insurer relies on. It must always be formatted with an explicit
 *      `timeZone`, never with the process default.
 *
 * WHY `new Date()` MUST NOT BE FORMATTED WITHOUT A ZONE
 * These render paths run on Vercel's Node runtime, where `TZ=UTC`. A bare
 * `toLocaleDateString()` therefore resolves to UTC, so every agreement generated
 * after 20:00 Eastern (17:00 Pacific) was stamped with TOMORROW's date — on a
 * document someone signs. `formatZonedDate` exists so the "today" fields can be
 * stamped in the operator's own zone instead.
 *
 * Duplicated byte-for-byte to:
 *   apps/portal/src/lib/agreement-datetime.ts
 *   apps/booking/src/lib/agreement-datetime.ts
 *   supabase/functions/_shared/agreement-datetime.ts
 * These are parallel copies, not a shared import — the portal PDF engine, the
 * booking engine and the Deno edge functions each resolve modules differently.
 * Change one, change all three, and keep them identical (md5sum them).
 */

/** Fallback when neither the rental nor the tenant names a zone. */
export const DEFAULT_AGREEMENT_TIMEZONE = "America/New_York";

/**
 * Guard against an unusable IANA name reaching Intl, which throws a RangeError
 * on an unknown zone and would abort the whole agreement send. A bad value in
 * one tenant's settings must not be able to stop that tenant issuing contracts.
 */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The single zone every date and time in a rental document is stated in: the
 * OPERATOR's zone, `tenants.timezone`.
 *
 * WHY NOT `rentals.customer_timezone`, WHICH ALSO EXISTS
 * It is tempting, because the booking widget records the customer's browser zone
 * next to the wall-clock time they picked. It is the wrong choice here, for three
 * reasons that all point the same way:
 *
 *   1. A handover is an OPERATOR event. `handed_at` is stamped when a member of
 *      staff presses "Key Handed" in the portal. Rendering that instant in the
 *      renter's zone states a time nobody involved in the handover observed.
 *   2. It would disagree with the portal screen, which shows the tenant's zone.
 *      One event reading 2:46 PM on the operator's screen and 11:46 AM on the PDF
 *      they hand to an insurer is precisely the confusion this work exists to end.
 *   3. Mixing zones inside one document — scheduled times in the customer's,
 *      actual times in the operator's — makes the two rows non-comparable, and
 *      comparing them is the entire reason a claims handler reads the page.
 *
 * `customer_timezone` remains the right column for booking-side lead-time maths;
 * it is deliberately not used for rendering the record of what happened.
 *
 * The `rental` parameter is kept so callers read naturally and so the decision
 * above stays visible at every call site rather than being silently absent.
 */
export function resolveAgreementTimeZone(
  _rental: { customer_timezone?: string | null } | null | undefined,
  tenant: { timezone?: string | null } | null | undefined,
): string {
  const fromTenant = tenant?.timezone;
  if (isValidTimeZone(fromTenant)) return fromTenant as string;
  return DEFAULT_AGREEMENT_TIMEZONE;
}

/**
 * The short zone label ICU gives for this instant — "EDT" in summer, "EST" in
 * winter, "GMT+1" for zones ICU has no abbreviation for.
 *
 * Resolved per-instant rather than per-zone on purpose: a vehicle collected in
 * August and returned in November crosses a DST boundary, and stamping both with
 * one label would misstate one of them by an hour.
 */
export function zoneAbbreviation(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * "14:30" / "14:30:00" → "2:30 PM".
 *
 * Returns '' (not "Invalid") for anything unparseable, because the caller feeds
 * this straight into a template placeholder and `removeEmptyFields` deletes the
 * whole row when the value is blank — an unknown time should leave no trace in
 * the contract rather than print a defect.
 *
 * Before this existed the raw column value was interpolated, so signed contracts
 * carried "Pickup Time: 14:00:00".
 */
export function formatTimeOfDay(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value).trim());
  if (!match) return "";
  const hour24 = Number(match[1]);
  const minutes = match[2];
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return "";
  if (Number(minutes) < 0 || Number(minutes) > 59) return "";
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${minutes} ${period}`;
}

/**
 * The instant at which a given LOCAL wall clock occurs in `timeZone`.
 *
 * Needed only to pick the right DST label for a scheduled time. Anchoring that
 * label at noon instead would mislabel early-morning times on the two transition
 * days each year: US zones switch at 02:00 local, so noon is always on the far
 * side of the switch, and a 01:00 scheduled collection on the November changeover
 * would be stamped EDT when it is really EST.
 *
 * One correction pass: guess that the wall clock is UTC, ask the zone what that
 * instant actually reads as, and subtract the difference. Exact everywhere except
 * inside the one-hour spring-forward gap, where no such local time exists at all
 * and any answer is a convention.
 */
function wallClockToInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    // "24" is how some ICU builds render midnight under hour12:false.
    const hour = get("hour") === 24 ? 0 : get("hour");
    const asRead = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
    );
    return new Date(guess.getTime() - (asRead - guess.getTime()));
  } catch {
    return guess;
  }
}

/** Parse a bare `YYYY-MM-DD` as noon UTC — see `formatDateOnly`. */
function parseDateOnlyUtcNoon(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  // Noon, not midnight: a date-only value carries no zone, and midnight UTC is
  // the previous calendar day everywhere west of Greenwich. Noon is >=12h from
  // either boundary, so the calendar day survives projection into any real zone.
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0),
  );
  return isNaN(d.getTime()) ? null : d;
}

/**
 * A `date` column rendered as a long date, with no zone projection at all.
 * "2026-08-03" → "August 3, 2026", in every runtime and every process TZ.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const d = parseDateOnlyUtcNoon(String(value));
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/**
 * A SCHEDULED date + wall-clock time, e.g. "August 3, 2026 at 10:00 AM EDT".
 *
 * The time is NOT converted — it is already local. The zone is appended as a
 * label so the reader knows which clock it refers to, which is the whole point
 * for an insurer reading the document months later.
 *
 * With no time on the rental this degrades to the date alone rather than
 * inventing "12:00 AM", because a rental with no pickup time recorded has not
 * agreed one, and a contract must not assert midnight.
 */
export function formatScheduledDateTime(
  dateValue: string | null | undefined,
  timeValue: string | null | undefined,
  timeZone: string,
): string {
  const datePart = formatDateOnly(dateValue);
  if (!datePart) return "";
  const timePart = formatTimeOfDay(timeValue);
  if (!timePart) return datePart;
  // Abbreviation resolved at the scheduled DATE AND TIME, so a summer booking
  // reads EDT and a winter one EST, and a time on either side of a changeover
  // day gets the label that actually applied at that hour.
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateValue).trim());
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(timeValue).trim());
  const at =
    dm && tm
      ? wallClockToInstant(
          Number(dm[1]),
          Number(dm[2]),
          Number(dm[3]),
          Number(tm[1]),
          Number(tm[2]),
          timeZone,
        )
      : (parseDateOnlyUtcNoon(String(dateValue)) ?? new Date());
  const abbr = zoneAbbreviation(timeZone, at);
  return abbr
    ? `${datePart} at ${timePart} ${abbr}`
    : `${datePart} at ${timePart}`;
}

/**
 * An ACTUAL instant (`timestamptz`) projected into `timeZone`:
 * "August 4, 2026 at 2:46 PM EDT".
 *
 * This is the string an insurance adjuster is asking for. Length matters: the
 * PDF table renderer gives a 2-column row ~235pt and silently chops the overflow
 * character by character with no ellipsis, so a truncated timestamp would look
 * like a correct one. This format measures ~141pt at the rendered size, and the
 * full IANA zone is stated on its own row rather than appended here — appending
 * it lands within 1pt of the chop threshold.
 */
export function formatZonedDateTime(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return "";
  try {
    const datePart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    const abbr = zoneAbbreviation(timeZone, d);
    return abbr
      ? `${datePart} at ${timePart} ${abbr}`
      : `${datePart} at ${timePart}`;
  } catch {
    return "";
  }
}

/**
 * "Today" in a specific zone — the fix for agreements stamped with tomorrow's
 * date. Never use a bare `toLocaleDateString()` for this on a server.
 */
export function formatZonedDate(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

/** The two handover rows a rental can have. At most one of each — the table
 *  carries UNIQUE (rental_id, handover_type). */
export interface HandoverRow {
  handover_type?: string | null;
  handed_at?: string | null;
  mileage?: number | null;
}

export interface RentalTimeFacts {
  timeZone: string;
  /** Scheduled, from the rental's own columns. */
  scheduledPickup: string;
  scheduledReturn: string;
  pickupTime: string;
  returnTime: string;
  /** Actual, from rental_key_handovers.handed_at. '' when not yet recorded. */
  collectedAt: string;
  returnedAt: string;
  collectionMileage: string;
  returnMileage: string;
  /** True once at least one actual timestamp exists. */
  hasActualTimes: boolean;
  /**
   * True when the rental carries ANY time information worth stating — a
   * scheduled time of day, or a confirmed handover.
   *
   * This, not `hasActualTimes`, is what gates injection into stored templates.
   * Gating on the actual times alone defeats the purpose: an agreement is signed
   * BEFORE the vehicle is collected, so at signing time no handover exists and
   * the contract the customer actually signs would still state no times at all.
   * Gating on "is there a time to state" puts the agreed collection and return
   * times in the signed document, and the actual ones in every copy rendered
   * afterwards.
   *
   * False when the operator records no time of day at all, in which case the
   * block would add nothing the existing Start/End Date rows do not already say.
   */
  hasAnyTimes: boolean;
}

/**
 * Everything a document needs to state about when this vehicle changed hands.
 *
 * A handover ROW existing does not mean the handover happened: rows are created
 * as soon as anyone uploads a condition photo, types a note or enters an odometer
 * reading, and carry `handed_at = NULL` until the operator confirms. `handed_at`
 * is the only completion flag in the schema, so an unconfirmed handover yields ''
 * here and the corresponding row drops out of the rendered document entirely.
 */
export function buildRentalTimeFacts(
  rental: {
    start_date?: string | null;
    end_date?: string | null;
    pickup_time?: string | null;
    return_time?: string | null;
    customer_timezone?: string | null;
  } | null | undefined,
  tenant: { timezone?: string | null } | null | undefined,
  handovers: HandoverRow[] | null | undefined,
): RentalTimeFacts {
  const timeZone = resolveAgreementTimeZone(rental, tenant);
  const rows = Array.isArray(handovers) ? handovers : [];
  const giving = rows.find((h) => h?.handover_type === "giving");
  const receiving = rows.find((h) => h?.handover_type === "receiving");

  const collectedAt = formatZonedDateTime(giving?.handed_at, timeZone);
  const returnedAt = formatZonedDateTime(receiving?.handed_at, timeZone);

  // Mileage is only stated alongside a CONFIRMED handover. An odometer reading
  // typed in ahead of time is a draft, and pairing it with a blank timestamp in
  // a legal document would imply a handover that has not happened.
  const collectionMileage =
    giving?.handed_at != null && giving?.mileage != null
      ? String(giving.mileage)
      : "";
  const returnMileage =
    receiving?.handed_at != null && receiving?.mileage != null
      ? String(receiving.mileage)
      : "";

  return {
    timeZone,
    scheduledPickup: formatScheduledDateTime(
      rental?.start_date,
      rental?.pickup_time,
      timeZone,
    ),
    scheduledReturn: formatScheduledDateTime(
      rental?.end_date,
      rental?.return_time,
      timeZone,
    ),
    pickupTime: formatTimeOfDay(rental?.pickup_time),
    returnTime: formatTimeOfDay(rental?.return_time),
    collectedAt,
    returnedAt,
    collectionMileage,
    returnMileage,
    hasActualTimes: !!collectedAt || !!returnedAt,
    hasAnyTimes:
      !!collectedAt ||
      !!returnedAt ||
      !!formatTimeOfDay(rental?.pickup_time) ||
      !!formatTimeOfDay(rental?.return_time),
  };
}

/**
 * Delete label/value rows whose value came out empty.
 *
 * The portal PDF engine has its own `removeEmptyFields` and runs it twice, but
 * the booking engine and the Deno edge function flatten the HTML with
 * `htmlToText` and prune nothing — so the same seeded template that renders
 * cleanly in the portal produced "Vehicle Returned:" followed by nothing in a
 * BoldSign document. On a page an insurer reads, a labelled blank is a recorded
 * blank; it has to be absent instead.
 *
 * Matches the portal regex so all three engines agree on what an empty row is.
 */
export function removeEmptyTableRows(html: string): string {
  if (!html) return html;
  return html
    .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s*<\/td>\s*<\/tr>/gi, "")
    .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s+<\/td>\s*<\/tr>/gi, "");
}

/**
 * The placeholder map contributed to every agreement render path.
 *
 * Kept in one function so the portal engine, the booking engine and the
 * `create-boldsign-document` edge function cannot offer different variables —
 * a template that works for a portal-created rental has to work for a
 * web-booked one.
 */
export function buildTimeVariables(
  facts: RentalTimeFacts,
): Record<string, string> {
  return {
    // Scheduled. `pickup_time`/`return_time` already existed as placeholders but
    // interpolated the raw column, putting "14:00:00" into signed contracts.
    pickup_time: facts.pickupTime,
    return_time: facts.returnTime,
    pickup_datetime: facts.scheduledPickup,
    return_datetime: facts.scheduledReturn,
    rental_start_datetime: facts.scheduledPickup,
    rental_end_datetime: facts.scheduledReturn,
    // Actual — what an insurer asks for.
    vehicle_collected_at: facts.collectedAt,
    vehicle_returned_at: facts.returnedAt,
    collection_mileage: facts.collectionMileage,
    return_mileage: facts.returnMileage,
    // Stated in full so the reader never has to infer which clock applies.
    rental_timezone: facts.timeZone,
  };
}

/**
 * The block injected into STORED templates that have no time placeholders of
 * their own — the same render-time strategy `agreement-injection.ts` already
 * uses for mileage and terms, and for the same reason: most tenants' templates
 * were seeded before these placeholders existed, so editing the built-in default
 * template alone would fix nobody who has customised.
 *
 * Deliberately its OWN 2-column table rather than extra rows appended to the
 * document's last table. The PDF renderer sizes every column as
 * `CONTENT_W / max(cells across all rows in that table)`, so dropping 2-cell rows
 * into a table that has a 3-cell row anywhere (the installment schedule does)
 * squeezes every column to 165pt and starts silently chopping timestamps.
 *
 * Rows whose value resolves empty are removed by `removeEmptyFields`, so a
 * rental with no recorded times renders the heading and nothing under it — hence
 * injection is gated on `hasActualTimes` at the call site.
 */
export const HANDOVER_TIMES_BLOCK_HTML =
  "<h2>Vehicle Collection &amp; Return</h2>\n" +
  "<table>\n" +
  "<tr><td><strong>Scheduled Collection</strong></td><td>{{pickup_datetime}}</td></tr>\n" +
  "<tr><td><strong>Scheduled Return</strong></td><td>{{return_datetime}}</td></tr>\n" +
  "<tr><td><strong>Vehicle Collected</strong></td><td>{{vehicle_collected_at}}</td></tr>\n" +
  "<tr><td><strong>Vehicle Returned</strong></td><td>{{vehicle_returned_at}}</td></tr>\n" +
  "<tr><td><strong>Odometer at Collection</strong></td><td>{{collection_mileage}}</td></tr>\n" +
  "<tr><td><strong>Odometer at Return</strong></td><td>{{return_mileage}}</td></tr>\n" +
  "<tr><td><strong>Times Recorded In</strong></td><td>{{rental_timezone}}</td></tr>\n" +
  "</table>";
