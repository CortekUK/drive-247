/**
 * The Developer page's one backend: the `dev-signup-rehearsal` edge function.
 * Every read and write on this page goes through `callDeveloper`, which checks
 * for a super admin on the server — the page itself holds no privileged logic.
 *
 * The edge response is `unknown` until it is narrowed here.
 */
import { supabase } from '@/lib/supabase';

export type StripeMode = 'test' | 'live';

export interface ResetStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface PortalPreviews {
  holdSkeletons?: boolean;
  messagesScenario?: string;
  billingScenario?: string;
  billingSampleData?: boolean;
  emptyStates?: string[];
}

export interface DeveloperStatus {
  settings: {
    email: string;
    linkToNorthwind: boolean;
    stripeMode: StripeMode;
    portalPreviews: PortalPreviews;
    portalCommand: { id: string; action: string; at: string } | null;
    lastResetAt: string | null;
    lastResetResult: { success: boolean; steps: ResetStep[] } | null;
  };
  account:
    | { exists: false }
    | {
        exists: true;
        createdAt: string;
        providers: string[];
        signup: { status: string | null; mode: string | null; linkToNorthwind: boolean | null; slug: string | null } | null;
      };
  memberships: Array<{ tenantId: string; slug: string | null; companyName: string | null; linked: boolean }>;
  northwind: {
    companyName: string | null;
    subscriptions: Array<{ status: string; plan_name: string | null; stripe_account: string | null; created_at: string }>;
    firstRunDone: boolean;
    setupCompletedAt: string | null;
  } | null;
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
    step: typeof s.step === 'string' ? s.step : '',
    ok: s.ok === true,
    detail: typeof s.detail === 'string' ? s.detail : '',
  }));
}

/** Where the portal and the landing page live, for this admin's environment. */
export function devUrls(): { portal: string; landing: string; demoSignup: string } {
  const local = typeof window !== 'undefined' && window.location.hostname.endsWith('localhost');
  return local
    ? {
        portal: 'http://northwind.portal.localhost:4002',
        landing: 'http://localhost:4003',
        demoSignup: 'http://localhost:4003/demo-signup',
      }
    : {
        portal: 'https://northwind.portal.drive-247.com',
        landing: 'https://drive-247.com',
        demoSignup: 'https://drive-247.com/demo-signup',
      };
}
