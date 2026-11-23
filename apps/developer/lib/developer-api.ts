/**
 * The hub's one backend: the `dev-signup-rehearsal` edge function, the same
 * one behind the admin Developer page. Its `test_email*` actions
 * (supabase/functions/dev-signup-rehearsal/test-emails.ts) keep the test
 * emails list and reset what a test signup left behind. The function checks
 * for a super admin; this page holds no privileged logic.
 *
 * The edge response is `unknown` until it is narrowed here.
 */
import { supabase } from '@/lib/supabase';

export interface ResetStep {
  step: string;
  ok: boolean;
  detail: string;
}

export type ProgressTone = 'clean' | 'progress' | 'done' | 'error';

export interface TestEmail {
  email: string;
  enabled: boolean;
  createdAt: string;
  lastResetAt: string | null;
  lastResetResult: { success: boolean; steps: ResetStep[] } | null;
  progress: { label: string; tone: ProgressTone };
  login: { exists: false } | { exists: true; createdAt: string; providers: string[]; stripeMode: 'test' | 'live' | null };
  companies: Array<{
    slug: string;
    companyName: string | null;
    stripeMode: 'test' | 'live';
    subscription: { status: string; planName: string | null } | null;
    remove: boolean;
    keepReason: string | null;
  }>;
  reset: { blockers: string[]; removes: string[] };
}

export interface CallResult {
  ok: boolean;
  body: Record<string, unknown>;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Invoke the function. A non-2xx still carries a JSON body (the reset's step
 * list in particular), so it is read off the error's response rather than
 * thrown away.
 */
export async function callDeveloper(body: Record<string, unknown>): Promise<CallResult> {
  const { data, error } = await supabase.functions.invoke<unknown>('dev-signup-rehearsal', { body });
  if (!error) {
    const payload = isRecord(data) ? data : {};
    const failed = typeof payload.error === 'string' || payload.success === false;
    return {
      ok: !failed,
      body: payload,
      error: typeof payload.error === 'string' ? payload.error : failed ? 'The request did not complete' : null,
    };
  }
  let payload: Record<string, unknown> = {};
  const context: unknown = isRecord(error) ? (error as Record<string, unknown>).context : null;
  if (isRecord(context) && typeof context.json === 'function') {
    try {
      const parsed: unknown = await (context.json as () => Promise<unknown>)();
      if (isRecord(parsed)) payload = parsed;
    } catch {
      // body already consumed or not JSON
    }
  }
  const message =
    typeof payload.error === 'string'
      ? payload.error
      : error instanceof Error && error.message
        ? error.message
        : 'The developer service did not answer';
  return { ok: false, body: payload, error: message };
}

export function readSteps(body: Record<string, unknown>): ResetStep[] {
  const steps = body.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter(isRecord).map((s) => ({
    step: String(s.step ?? ''),
    ok: s.ok === true,
    detail: String(s.detail ?? ''),
  }));
}

export function readTestEmails(body: Record<string, unknown>): TestEmail[] {
  return Array.isArray(body.emails) ? (body.emails.filter(isRecord) as unknown as TestEmail[]) : [];
}

/**
 * The "Start fresh" links. A browser keeps its own signup data per site, so
 * there is one for the live site and one for local web (port 4003). Each
 * clears that browser's signup data and signs it out, then opens a new signup
 * (apps/web/src/components/onboarding/fresh-start.ts).
 */
export const FRESH_START_LINKS = [
  { label: 'drive-247.com', href: 'https://drive-247.com/?fresh=1' },
  // `mock=off`: local web fakes the signup unless told not to, and these runs
  // are for the real one.
  { label: 'localhost:4003', href: 'http://localhost:4003/?fresh=1&mock=off' },
] as const;
