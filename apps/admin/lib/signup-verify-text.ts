/**
 * feat-001 spec 09.4 · Signups list: has the person confirmed their email and
 * chosen a password in the portal, and if not, how long before the 3-day block
 * (spec 04, counted from signup). Pure, so it can be tested on its own.
 *
 * Returns null when there is nothing to say: a lead (no account), or an
 * admin_signups() older than migration 20261127000000, which has no such
 * columns. Without that second case every account would read "not confirmed".
 */
export const VERIFY_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface VerifyFields {
  email_confirmed?: boolean | null;
  password_set?: boolean | null;
  signed_up_at: string;
}

export function verifyText(r: VerifyFields, now = Date.now()): { text: string; late: boolean; done: boolean } | null {
  if (r.email_confirmed == null || r.password_set == null) return null;
  if (r.email_confirmed && r.password_set) return { text: 'Email confirmed, password set', late: false, done: true };
  const missing = [!r.email_confirmed && 'email not confirmed', !r.password_set && 'no password yet']
    .filter(Boolean)
    .join(', ');
  const lead = missing[0].toUpperCase() + missing.slice(1);
  const left = new Date(r.signed_up_at).getTime() + VERIFY_WINDOW_MS - now;
  if (!(left > 0)) return { text: `${lead} · 3-day point passed`, late: true, done: false };
  // Counted up, like the portal's own window: 71h → "3 days left".
  const hours = Math.ceil(left / 3_600_000);
  const when = hours > 24 ? `${Math.ceil(hours / 24)} days left` : hours === 1 ? '1 hour left' : `${hours} hours left`;
  return { text: `${lead} · ${when}`, late: false, done: false };
}
