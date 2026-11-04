// The renter name sent to Bonzah. Pure so it can be tested without Deno.
//
// Bonzah answers a bad name with status 0, a quote_id and an EMPTY payment_id,
// and gives no reason. Checked against its sandbox (2026-11-04):
//   last name "N/A" or ""    -> no payment_id
//   curly apostrophe in name -> no payment_id
//   repeated name "Ann Ann"  -> ACCEPTED, so it would issue a policy in a made-up
//                               name. We refuse that one ourselves.
// Callers fall back to those values for one-word customers, so every caller is
// handled here rather than in each app.

export interface VerificationName {
  first_name?: string | null;
  last_name?: string | null;
  review_result?: string | null;
}

export type ResolvedRenterName =
  | { ok: true; firstName: string; lastName: string; source: 'request' | 'verification' | 'customer' }
  | { ok: false; displayName: string };

// "Na" is a real surname, so it is not on this list.
const PLACEHOLDERS = new Set(['n/a', 'none', 'null', 'undefined', 'unknown']);

/** Plain ASCII: straight quotes and hyphens, no accents, single spaces. */
export function cleanBonzahText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[‘’‚‛ʼʹ`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRealName(name: string): boolean {
  return /[A-Za-z]/.test(name) && !PLACEHOLDERS.has(name.toLowerCase());
}

function usablePair(first: unknown, last: unknown): { firstName: string; lastName: string } | null {
  const firstName = cleanBonzahText(first as string);
  const lastName = cleanBonzahText(last as string);
  if (!isRealName(firstName) || !isRealName(lastName)) return null;
  if (firstName.toLowerCase() === lastName.toLowerCase()) return null;
  return { firstName, lastName };
}

/**
 * Use the name the caller sent if it is real. Otherwise use a name read from the
 * customer's ID (passed checks first, failed checks never), then the customer
 * profile. Returns ok:false when nothing gives a real first and last name.
 *
 * `verifications` must be newest first. Unfinished ones often have no name, so
 * only looking at the newest is not enough.
 */
export function resolveBonzahRenterName(input: {
  firstName?: string | null;
  lastName?: string | null;
  verifications?: VerificationName[] | null;
  customerName?: string | null;
}): ResolvedRenterName {
  const sent = usablePair(input.firstName, input.lastName);
  if (sent) return { ok: true, ...sent, source: 'request' };

  const rows = (input.verifications ?? []).filter((v) => v.review_result !== 'RED');
  const ordered = [
    ...rows.filter((v) => v.review_result === 'GREEN'),
    ...rows.filter((v) => v.review_result !== 'GREEN'),
  ];
  for (const v of ordered) {
    const pair = usablePair(v.first_name, v.last_name);
    if (pair) return { ok: true, ...pair, source: 'verification' };
  }

  const parts = cleanBonzahText(input.customerName).split(' ').filter(Boolean);
  const fromProfile = usablePair(parts[0], parts.slice(1).join(' '));
  if (fromProfile) return { ok: true, ...fromProfile, source: 'customer' };

  return {
    ok: false,
    displayName: cleanBonzahText(input.customerName) || cleanBonzahText(input.firstName),
  };
}
