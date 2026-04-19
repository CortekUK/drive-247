/**
 * Bonzah-facing date formatting helpers.
 *
 * Bonzah requires MM/DD/YYYY for date-only fields and MM/DD/YYYY HH:mm:ss
 * for datetime fields — NOT ISO.
 *
 * Pure functions — no ambient date dependencies.
 */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatBonzahDate(d: Date): string {
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

export function formatBonzahDateTime(d: Date): string {
  const date = formatBonzahDate(d);
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Compute age in complete years between two dates.
 * Used to validate driver age at trip start.
 */
export function ageInYearsAt(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() &&
      at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
