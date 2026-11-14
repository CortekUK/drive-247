/**
 * Plain checks run on what the AI read off an insurance document (QA I3).
 *
 * The AI judges whether a document LOOKS like real insurance. It does not know
 * today's date reliably, who the customer is or when the rental runs, so it
 * passed an expired policy, a blurry photo it had to guess at, and a policy in
 * somebody else's name. These checks run after the AI, in code:
 *
 *   - cover ended before today                  -> reject
 *   - the AI says the image could not be read  -> needs review
 *   - policy holder is not the rental's customer -> needs review
 *   - cover does not span the whole rental      -> needs review
 *
 * Pure: no I/O, so verify-insurance-document can re-run it on attach without a
 * new AI call.
 */

export interface CoverCheckInput {
  policyHolder: string | null | undefined;
  startDate: string | null | undefined; // YYYY-MM-DD
  endDate: string | null | undefined; // YYYY-MM-DD
  aiFlags?: readonly string[] | null;
  today: string; // YYYY-MM-DD
  customerName?: string | null;
  rentalStart?: string | null; // YYYY-MM-DD (or ISO; first 10 chars used)
  rentalEnd?: string | null;
}

export interface CoverCheckResult {
  /** Plain sentences, shown with the AI's own flags. */
  flags: string[];
  /** The worst outcome any check asks for. */
  outcome: 'reject' | 'review' | null;
}

const UNREADABLE = /blur|unreadable|illegible|not legible|cannot be read|can't be read|poor quality|low quality|low resolution/i;

function day(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nameTokens(v: string): string[] {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['mr', 'mrs', 'ms', 'miss', 'dr', 'and', 'the'].includes(t));
}

/** Same person if every word of the shorter name appears in the longer one. */
export function namesMatch(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.includes(t));
}

export function runCoverChecks(input: CoverCheckInput): CoverCheckResult {
  const flags: string[] = [];
  let outcome: CoverCheckResult['outcome'] = null;
  const review = (msg: string) => {
    flags.push(msg);
    if (outcome !== 'reject') outcome = 'review';
  };

  const start = day(input.startDate);
  const end = day(input.endDate);
  const unreadable = (input.aiFlags ?? []).some((f) => UNREADABLE.test(String(f)));

  if (unreadable) {
    review('The image is blurry or hard to read, so the details below may be wrong. Ask for a clearer copy.');
  }

  // A date read off a blurry image is a guess, so it may not reject on its own.
  if (end && end < input.today) {
    if (unreadable) review(`The cover end date read as ${end}, which is in the past. Check it on a clearer copy.`);
    else {
      flags.push(`Policy expired on ${end}.`);
      outcome = 'reject';
    }
  }

  const customer = (input.customerName ?? '').trim();
  if (customer) {
    const holder = (input.policyHolder ?? '').trim();
    if (!holder) review(`The policy holder's name could not be read, so it was not checked against ${customer}.`);
    else if (!namesMatch(holder, customer)) {
      review(`Name on the policy "${holder}" does not match the customer "${customer}".`);
    }
  }

  const rStart = day(input.rentalStart);
  const rEnd = day(input.rentalEnd);
  if (rStart && rEnd) {
    if (!start || !end) {
      review('The cover dates could not be read, so they were not checked against the rental.');
    } else if (start > rStart || end < rEnd) {
      review(`Cover ${start} to ${end} does not cover the whole rental (${rStart} to ${rEnd}).`);
    }
  }

  return { flags, outcome };
}
