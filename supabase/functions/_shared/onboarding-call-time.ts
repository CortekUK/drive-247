// How an onboarding call's time is written for a person in their own zone
// (feat-001 spec 03). Pure, no Deno, so Vitest runs it. The portal keeps the
// same functions in apps/portal/src/lib/onboarding-call-time.ts; one Vitest
// table checks both.

function isZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Asia/Karachi" is "Karachi time", "UTC" is "UTC". */
export function zoneLabel(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  if (tz === "UTC" || tz === "Etc/UTC" || tz === "Etc/GMT") return "UTC";
  if (!isZone(tz)) return tz;
  const city = tz.split("/").pop() ?? tz;
  return `${city.replace(/_/g, " ")} time`;
}

function parts(at: Date | string, tz: string) {
  const d = typeof at === "string" ? new Date(at) : at;
  const zone = isZone(tz) ? tz : "UTC";
  const get = (o: Intl.DateTimeFormatOptions) => {
    const p = new Intl.DateTimeFormat("en-US", { ...o, timeZone: zone }).formatToParts(d);
    return Object.fromEntries(p.map((x) => [x.type, x.value])) as Record<string, string>;
  };
  const a = get({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const s = get({ weekday: "short", month: "short" });
  const t = get({ hour: "numeric", minute: "2-digit", hour12: true });
  return {
    weekday: a.weekday,
    weekdayShort: s.weekday,
    day: a.day,
    month: a.month,
    monthShort: s.month,
    year: a.year,
    time: `${t.hour}:${t.minute} ${(t.dayPeriod ?? "").toUpperCase()}`,
  };
}

/** "7:00 PM" */
export function formatSlotTime(at: Date | string, tz: string): string {
  return parts(at, tz).time;
}

/** "Wednesday, 10 March at 7:00 PM, Karachi time" */
export function formatCallFull(at: Date | string, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekday}, ${p.day} ${p.month} at ${p.time}, ${zoneLabel(tz)}`;
}

/** "Wed 10 Mar, 7:00 PM Karachi time" */
export function formatCallShort(at: Date | string, tz: string): string {
  const p = parts(at, tz);
  return `${p.weekdayShort} ${p.day} ${p.monthShort}, ${p.time} ${zoneLabel(tz)}`;
}

/** The date tile: { month: "MAR", day: "10", weekday: "Wednesday" }. */
export function dateTile(at: Date | string, tz: string): { month: string; day: string; weekday: string } {
  const p = parts(at, tz);
  return { month: p.monthShort.toUpperCase(), day: p.day, weekday: p.weekday };
}

/** "2026-12-08", the day in that zone. */
export function dayKey(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", { timeZone: isZone(tz) ? tz : "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
