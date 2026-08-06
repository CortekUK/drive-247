'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { supabase, supabaseUntyped } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TestTube2,
  Unplug,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InshurMode = 'mock' | 'test' | 'live';

interface InshurStatusRow {
  integration_inshur: boolean | null;
  inshur_mode: string | null;
  inshur_username: string | null;
  inshur_password: string | null;
  inshur_customer_number: string | null;
  inshur_policy_number: string | null;
  inshur_2fa_token: string | null;
  inshur_states_allowed: unknown;
  inshur_states_synced_at: string | null;
  inshur_endpoint_overrides: unknown;
  timezone: string | null;
  stripe_mode: string | null;
}

type CredField = 'username' | 'password' | 'customerNumber' | 'policyNumber';

interface VerifyOutcome {
  ok: boolean;
  /** The mode the SERVER actually ran in. A `mock` answer proves nothing about real credentials. */
  mode: InshurMode;
  simulated: boolean;
  code: string | null;
  message: string | null;
  states: string[];
  carrierName: string | null;
  policyStatus: string | null;
  policyExpiration: string | null;
  signedInAs: string | null;
  resolvedCustomerNumber: string | null;
  /** Which covered-states path answered, once the server has probed for it. */
  statesPath: string | null;
  /** False when ABI answered but the states cache could not be written. */
  persisted: boolean;
  /**
   * Whether this deployment is permitted to write live cover at all. Open
   * unless the deployment sets INSHUR_ALLOW_LIVE=false, which is how a staging
   * copy is fenced off. The go-live preflight blocks on it because flipping a
   * fenced tenant to live leaves every bind throwing.
   */
  runtimeAllowsLive: boolean;
  /** The credential values this outcome refers to. Editing any of them invalidates it. */
  fingerprint: string;
}

interface PreflightRow {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
  fixLabel?: string;
  fixHref?: string;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const ABI_PORTAL_URL = 'https://portal.abiweb.com';

const MODE_COPY: Record<
  InshurMode,
  { label: string; title: string; body: string; badge: string; badgeClass: string; cardClass: string }
> = {
  mock: {
    label: 'Simulation',
    title: 'Simulation Mode',
    body:
      'Nothing here reaches ABI. Every eligibility check, rental period and ID card is generated locally by Drive247’s simulator so you can test the whole flow before INSHUR issues your credentials. Documents produced in this mode are stamped SIMULATED and are not valid proof of insurance.',
    badge: 'SIMULATION',
    badgeClass: 'bg-amber-400 hover:bg-amber-400 text-black',
    cardClass: 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800',
  },
  test: {
    label: 'Test',
    title: 'Test Mode',
    body:
      'Connected to ABI with test credentials. ABI runs testing and production on the same servers, so the requests are real — but they land on your test account. Cover started here does not insure anybody and is not billed.',
    badge: 'TEST',
    badgeClass: 'bg-blue-600 hover:bg-blue-700',
    cardClass: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
  },
  live: {
    label: 'Live',
    title: 'Live Mode',
    body:
      'Cover started here is real. Each rental period is written against your Period X policy and appears on your monthly ABI invoice, priced per VIN.',
    badge: 'LIVE',
    badgeClass: 'bg-green-600 hover:bg-green-700',
    cardClass: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800',
  },
};

/**
 * The ABI paths nobody can currently confirm. Our own discovery notes
 * contradict the API reference on one, and the other was never published at
 * all. Both live in `tenants.inshur_endpoint_overrides` so that a wrong guess
 * on handover day is a Settings edit rather than a redeploy — and so the
 * covered-states path in particular can never become a permanent go-live
 * blocker.
 *
 * The key names match what the edge functions read. `{key}_source` tells the
 * backend where a value came from: it probes past its own `auto` results but
 * treats a `manual` value as an instruction and never second-guesses it.
 */
const ENDPOINT_FIELDS = [
  {
    key: 'states_allowed_path',
    label: 'Covered-states endpoint',
    documented: '/customer/{CN}/policy/{PN}/period-zero/states-allowed/',
    alternate: '/period-z/states-allowed/',
    help:
      'Two ABI documents disagree on this path. Leave it blank and Drive247 tries the documented path first, then the alternate, and records whichever answered. A path you type here is treated as an instruction — Drive247 will use it and will not fall back, so clear it to let the probe run again. Use {CN} for your customer number and {PN} for your policy number.',
  },
  {
    key: 'twofactor_verify_path',
    label: 'Two-factor verify endpoint',
    documented: '/verify-2factor/',
    alternate: '',
    help:
      'ABI names this endpoint but has never published its path. Drive247 does not exchange two-factor codes automatically — the Two-factor token field below is what is actually sent today. Record the URL here if INSHUR gives it to you and it will be waiting when the exchange is built.',
  },
] as const;

const BILLING_PARAM_OPTIONS = [
  { value: 'auto', label: 'Try both (recommended)' },
  { value: 'STARTDATE', label: 'STARTDATE / ENDDATE (uppercase)' },
  { value: 'startDate', label: 'startDate / endDate (camel case)' },
];

/** The billing casing column also accepts the backend's own probe results. */
function normalizeBillingParams(raw: unknown): string {
  const v = typeof raw === 'string' ? raw : '';
  if (v === 'upper' || v === 'UPPER' || v === 'STARTDATE') return 'STARTDATE';
  if (v === 'lower' || v === 'LOWER' || v === 'startDate') return 'startDate';
  return 'auto';
}

/**
 * `tenants.timezone` is a hard requirement of every Create Rental Period, and
 * NOTHING else in the portal writes it: Settings → General's timezone field goes
 * to `org_settings` through the `settings` edge function, which is a different
 * row entirely and accepts only four European/US zones. A tenant whose
 * `tenants.timezone` is null therefore had no way to start INSHUR cover and no
 * way to clear the go-live preflight — which breaks the one promise this
 * integration makes, that handover is four pasted values and nothing else.
 *
 * Period Z is US-only, so the list is the US zones. Whatever is already stored
 * is appended if it is not among them, so opening this card can never quietly
 * offer to move a tenant off a zone somebody set deliberately.
 */
const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern — New York' },
  { value: 'America/Detroit', label: 'Eastern — Detroit' },
  { value: 'America/Chicago', label: 'Central — Chicago' },
  { value: 'America/Denver', label: 'Mountain — Denver' },
  { value: 'America/Phoenix', label: 'Mountain, no DST — Phoenix' },
  { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { value: 'America/Anchorage', label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' },
];

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function normalizeMode(raw: unknown): InshurMode {
  return raw === 'live' || raw === 'test' ? raw : 'mock';
}

function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim().toUpperCase());
}

function coerceOverrides(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function overrideString(overrides: Record<string, unknown>, key: string): string {
  const v = overrides[key];
  return typeof v === 'string' ? v : '';
}

function validateCredentials(v: {
  username: string;
  password: string;
  passwordAlreadySet: boolean;
  customerNumber: string;
  policyNumber: string;
}): Record<CredField, string | null> {
  const errors: Record<CredField, string | null> = {
    username: null,
    password: null,
    customerNumber: null,
    policyNumber: null,
  };

  const username = v.username.trim();
  if (!username) {
    errors.username = 'Enter the email address you use for portal.abiweb.com.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    errors.username = 'That does not look like an email address.';
  }

  if (!v.password.trim() && !v.passwordAlreadySet) {
    errors.password = 'Enter your ABI portal password.';
  }

  const customerNumber = v.customerNumber.trim();
  if (!customerNumber) {
    errors.customerNumber = 'Enter your ABI customer number.';
  } else if (/\s/.test(customerNumber)) {
    errors.customerNumber = 'Customer numbers do not contain spaces. Check for a stray character.';
  }

  const policyNumber = v.policyNumber.trim();
  if (!policyNumber) {
    errors.policyNumber = 'Enter your ABI policy number.';
  } else if (/\s/.test(policyNumber)) {
    errors.policyNumber = 'Policy numbers do not contain spaces. Check for a stray character.';
  } else if (customerNumber && policyNumber.toUpperCase() === customerNumber.toUpperCase()) {
    errors.policyNumber =
      'The policy number and the customer number are different values. The policy number usually ends in a suffix, like ABIABC2023-01.';
  }

  return errors;
}

/**
 * Identifies exactly which credential values a connection test proved. The
 * go-live preflight refuses to accept a test result whose fingerprint no longer
 * matches the form, so editing one character after a green test correctly
 * reverts the "Connection tested" row to unproven.
 */
function credentialFingerprint(v: {
  username: string;
  password: string;
  customerNumber: string;
  policyNumber: string;
  mode: InshurMode;
}): string {
  return [
    v.mode,
    v.username.trim().toLowerCase(),
    v.customerNumber.trim(),
    v.policyNumber.trim(),
    v.password.trim() ? `typed:${v.password.trim()}` : 'stored',
  ].join('\u0000');
}

function parseStateList(raw: string): { states: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const states: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (US_STATE_CODES.has(t)) {
      if (!states.includes(t)) states.push(t);
    } else if (!invalid.includes(t)) {
      invalid.push(t);
    }
  }
  states.sort();
  return { states, invalid };
}

/**
 * Reads the `inshur-verify-credentials` envelope. That function answers HTTP
 * 200 for every verification OUTCOME — a rejected credential is the answer to
 * the question, not a transport failure — so `ok:false` here is normal and the
 * `code` carries the reason.
 */
function readVerifyResponse(raw: unknown, fingerprint: string): VerifyOutcome {
  const d = (raw || {}) as Record<string, any>;
  const resolved = (d.resolved || {}) as Record<string, any>;

  const code =
    typeof d.code === 'string' && d.code
      ? d.code
      : d.twoFactorRequired === true
      ? 'twofactor_required'
      : null;

  return {
    ok: Boolean(d.ok ?? d.valid ?? false),
    mode: normalizeMode(d.mode),
    simulated: Boolean(d.simulated ?? d.mode === 'mock'),
    code,
    message: typeof d.error === 'string' ? d.error : typeof d.message === 'string' ? d.message : null,
    states: coerceStringArray(d.states ?? d.statesAllowed ?? resolved.statesAllowed),
    carrierName: resolved.carrierName ?? d.carrierName ?? null,
    policyStatus: resolved.policyStatus ?? d.policyStatus ?? null,
    policyExpiration: resolved.policyExpiration ?? d.policyExpiration ?? null,
    signedInAs: resolved.signedInAs ?? d.signedInAs ?? null,
    resolvedCustomerNumber: resolved.customerNumber ?? null,
    statesPath: typeof d.statesPath === 'string' ? d.statesPath : null,
    persisted: d.persisted !== false,
    runtimeAllowsLive: d.runtimeAllowsLive === true,
    fingerprint,
  };
}

function verifyFailureCopy(
  outcome: VerifyOutcome,
  entered: { customerNumber: string; policyNumber: string }
): { title: string; description: string } {
  switch (outcome.code) {
    case 'bad_credentials':
      return {
        title: 'ABI rejected these credentials',
        description:
          'Check the email and password you use at portal.abiweb.com, then try again. If you have just changed your portal password, update it here too.',
      };
    case 'twofactor_required':
      return {
        title: 'Two-factor code needed',
        description:
          'This ABI login has two-factor authentication switched on, so unattended requests cannot sign in. Ask INSHUR to exempt this login, or paste a current token under Advanced below.',
      };
    case 'twofactor_token_stale':
      return {
        title: 'Two-factor token expired',
        description:
          'ABI stopped accepting the saved token. Replace it under Advanced below, or ask INSHUR to exempt this login from two-factor authentication.',
      };
    case 'policy_not_found':
      return {
        title: 'Policy not found',
        description: `ABI has no policy numbered ${entered.policyNumber} under customer ${entered.customerNumber}. Check both values against your policy documents.`,
      };
    case 'policy_inactive':
      return {
        title: 'Policy is not active',
        description: `ABI reports policy ${entered.policyNumber} as ${
          outcome.policyStatus || 'inactive'
        }. Period Z cover cannot be written against an inactive policy — contact your INSHUR account manager.`,
      };
    case 'network':
      return {
        title: 'Could not reach ABI',
        description: 'api.abiweb.com did not respond. This is usually temporary — wait a minute and try again.',
      };
    case 'missing_fields':
      return {
        title: 'Some credentials are missing',
        description:
          outcome.message || 'Fill in all four values below, then run the connection test again.',
      };
    case 'live_not_permitted':
      return {
        title: 'This environment cannot write live cover',
        description:
          'Live INSHUR cover is enabled on production only. Test the credentials in Test mode here; go live from the production portal.',
      };
    default:
      return {
        title: 'Connection test failed',
        description:
          outcome.message ||
          `ABI returned an error without explaining it — that is common with their API. Double-check all four values, then try again. If it keeps failing, send this to INSHUR support: customer ${entered.customerNumber}, policy ${entered.policyNumber}.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InshurSettings() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { tenant } = useTenant();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [correctedCustomerNumber, setCorrectedCustomerNumber] = useState<{ from: string; to: string } | null>(null);

  const [statesDraft, setStatesDraft] = useState('');
  const [isEditingStates, setIsEditingStates] = useState(false);

  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState<Record<string, string>>({});
  const [billingParams, setBillingParams] = useState('auto');

  const [verify, setVerify] = useState<VerifyOutcome | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingStates, setIsSyncingStates] = useState(false);
  const [isSavingStates, setIsSavingStates] = useState(false);
  const [isSavingAdvanced, setIsSavingAdvanced] = useState(false);
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  const [showGoLive, setShowGoLive] = useState(false);
  const [goLiveConfirmText, setGoLiveConfirmText] = useState('');
  const [showTestConfirm, setShowTestConfirm] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);

  // The form is seeded from the database exactly once. A background refetch
  // landing mid-edit must not overwrite what the operator is typing.
  const hydrated = useRef(false);

  const {
    data: status,
    isLoading,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<InshurStatusRow>({
    queryKey: ['tenant-inshur-status', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant context');

      // supabaseUntyped: the inshur_* columns are newer than the generated types.
      const { data, error } = await supabaseUntyped
        .from('tenants')
        .select(
          'integration_inshur, inshur_mode, inshur_username, inshur_password, inshur_customer_number, inshur_policy_number, inshur_2fa_token, inshur_states_allowed, inshur_states_synced_at, inshur_endpoint_overrides, timezone, stripe_mode'
        )
        .eq('id', tenant.id)
        .single();

      if (error) throw error;

      if (!hydrated.current) {
        hydrated.current = true;
        setUsername(data?.inshur_username || '');
        setCustomerNumber(data?.inshur_customer_number || '');
        setPolicyNumber(data?.inshur_policy_number || '');
        setTwoFactorToken(data?.inshur_2fa_token || '');
        setTimezoneDraft((data?.timezone || '').trim());
        const overrides = coerceOverrides(data?.inshur_endpoint_overrides);
        const draft: Record<string, string> = {};
        for (const field of ENDPOINT_FIELDS) {
          // A path the backend probed its own way to is shown as a resolved
          // fact, not pre-loaded into the box — putting it there would turn it
          // into a manual pin the next time anything on this card is saved.
          draft[field.key] =
            overrides[`${field.key}_source`] === 'auto' ? '' : overrideString(overrides, field.key);
        }
        setEndpointDraft(draft);
        setBillingParams(
          overrides.billing_params_source === 'manual' ? normalizeBillingParams(overrides.billing_params) : 'auto'
        );
      }

      return data as InshurStatusRow;
    },
    enabled: !!tenant?.id,
    // Admin-side mode flips must be visible the moment this panel mounts.
    staleTime: 0,
  });

  const currentMode = normalizeMode(status?.inshur_mode);
  const isEnabled = status?.integration_inshur === true;
  const isMock = currentMode === 'mock';
  const modeCopy = MODE_COPY[currentMode];
  const stripeIsLive = status?.stripe_mode === 'live';

  const savedTimezone = (status?.timezone || '').trim();
  const timezoneOptions = useMemo(
    () =>
      savedTimezone && !US_TIMEZONES.some((t) => t.value === savedTimezone)
        ? [...US_TIMEZONES, { value: savedTimezone, label: `${savedTimezone} (currently set)` }]
        : US_TIMEZONES,
    [savedTimezone]
  );

  const savedOverrides = useMemo(() => coerceOverrides(status?.inshur_endpoint_overrides), [status?.inshur_endpoint_overrides]);
  const statesAllowed = useMemo(() => coerceStringArray(status?.inshur_states_allowed), [status?.inshur_states_allowed]);

  const passwordAlreadySet = !!status?.inshur_password;
  const savedCredsComplete = !!(
    status?.inshur_username &&
    status?.inshur_password &&
    status?.inshur_customer_number &&
    status?.inshur_policy_number
  );

  const fieldErrors = validateCredentials({
    username,
    password,
    passwordAlreadySet,
    customerNumber,
    policyNumber,
  });
  const formIsValid = !Object.values(fieldErrors).some(Boolean);

  /**
   * A connection test runs in the tenant's ACTUAL mode.
   *
   * Substituting `test` for `mock` would send whatever is in the form — usually
   * nothing, because mock is the default and stays the only mode until INSHUR
   * issues credentials — to ABI, and answer the default mode's connection test
   * with "some credentials are missing". That leaves the simulated path, the
   * only path available today, permanently unreachable, and blocks Save
   * credentials too, since Save verifies before it writes.
   *
   * A mock result still proves nothing: `connectionProven` below requires a
   * NON-simulated pass, so the go-live preflight is unaffected.
   */
  const modeToTest: InshurMode = currentMode;

  const currentFingerprint = credentialFingerprint({
    username,
    password,
    customerNumber,
    policyNumber,
    mode: modeToTest,
  });

  const formMatchesSaved =
    username.trim() === (status?.inshur_username || '').trim() &&
    customerNumber.trim() === (status?.inshur_customer_number || '').trim() &&
    policyNumber.trim() === (status?.inshur_policy_number || '').trim();

  /**
   * A connection is only "proven" when a NON-simulated test succeeded against
   * the exact values currently in the form, and those values are what is saved.
   */
  const connectionProven =
    !!verify && verify.ok && !verify.simulated && verify.fingerprint === currentFingerprint && formMatchesSaved;

  // Fleet sanity for the preflight. Tolerant of a vehicles table that does not
  // yet carry garaging_state, so this panel still renders before that column lands.
  const { data: fleet } = useQuery({
    queryKey: ['inshur-fleet-preflight', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant context');
      const withState = await supabaseUntyped
        .from('vehicles')
        .select('id, vin, garaging_state')
        .eq('tenant_id', tenant.id);

      if (!withState.error) {
        const rows = (withState.data || []) as Array<{ vin: string | null; garaging_state: string | null }>;
        return {
          total: rows.length,
          withVin: rows.filter((r) => (r.vin || '').trim().length === 17).length,
          withGaragingState: rows.filter((r) => (r.garaging_state || '').trim().length === 2).length,
          garagingKnown: true,
        };
      }

      const basic = await supabaseUntyped.from('vehicles').select('id, vin').eq('tenant_id', tenant.id);
      if (basic.error) throw basic.error;
      const rows = (basic.data || []) as Array<{ vin: string | null }>;
      return {
        total: rows.length,
        withVin: rows.filter((r) => (r.vin || '').trim().length === 17).length,
        withGaragingState: 0,
        garagingKnown: false,
      };
    },
    enabled: !!tenant?.id,
    retry: false,
  });

  // Only read when the disconnect dialog opens — the honest count for its copy.
  const { data: activeCoverCount } = useQuery({
    queryKey: ['inshur-active-cover-count', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant context');
      const { count, error } = await supabaseUntyped
        .from('inshur_rental_coverage')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .in('status', ['pending', 'active']);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!tenant?.id && showDisconnect,
    retry: false,
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tenant-inshur-status'] });
  };

  const runVerify = async (opts: { useSavedCredentials: boolean }): Promise<VerifyOutcome | null> => {
    if (!tenant?.id) return null;

    const cleanUsername = (opts.useSavedCredentials ? status?.inshur_username || '' : username).trim();
    const cleanPassword = (opts.useSavedCredentials ? '' : password).trim();
    const cleanCustomerNumber = (opts.useSavedCredentials ? status?.inshur_customer_number || '' : customerNumber).trim();
    const cleanPolicyNumber = (opts.useSavedCredentials ? status?.inshur_policy_number || '' : policyNumber).trim();

    const fingerprint = credentialFingerprint({
      username: cleanUsername,
      password: cleanPassword,
      customerNumber: cleanCustomerNumber,
      policyNumber: cleanPolicyNumber,
      mode: modeToTest,
    });

    const { data, error } = await supabase.functions.invoke('inshur-verify-credentials', {
      body: {
        tenantId: tenant.id,
        mode: modeToTest,
        username: cleanUsername,
        // Omitted entirely when the field is blank, so a saved password is kept.
        ...(cleanPassword ? { password: cleanPassword } : {}),
        customerNumber: cleanCustomerNumber,
        policyNumber: cleanPolicyNumber,
      },
    });

    if (error) throw error;
    return readVerifyResponse(data, fingerprint);
  };

  const buildOverridePayload = (): Record<string, unknown> => {
    // Preserve every key already in the column — the backend writes its own
    // probe results here and clobbering them would make it re-probe forever.
    const next: Record<string, unknown> = { ...savedOverrides };
    const stamp = new Date().toISOString();

    for (const field of ENDPOINT_FIELDS) {
      const value = (endpointDraft[field.key] || '').trim();
      if (value) {
        next[field.key] = value;
        // 'manual' is what stops the backend probing past an operator's choice.
        next[`${field.key}_source`] = 'manual';
        next[`${field.key}_resolved_at`] = stamp;
      } else if (next[`${field.key}_source`] !== 'auto') {
        // Clearing the box withdraws the instruction, but must not delete a
        // path the backend discovered for itself.
        delete next[field.key];
        delete next[`${field.key}_source`];
        delete next[`${field.key}_resolved_at`];
      }
    }

    if (billingParams === 'auto') {
      if (next.billing_params_source === 'manual') {
        delete next.billing_params;
        delete next.billing_params_source;
        delete next.billing_params_resolved_at;
      }
    } else {
      next.billing_params = billingParams;
      next.billing_params_source = 'manual';
      next.billing_params_resolved_at = stamp;
    }

    return next;
  };

  const applyVerifyOutcome = (outcome: VerifyOutcome, entered: { customerNumber: string; policyNumber: string }) => {
    setVerify(outcome);

    if (outcome.resolvedCustomerNumber && outcome.resolvedCustomerNumber !== entered.customerNumber) {
      setCorrectedCustomerNumber({ from: entered.customerNumber, to: outcome.resolvedCustomerNumber });
      setCustomerNumber(outcome.resolvedCustomerNumber);
    } else {
      setCorrectedCustomerNumber(null);
    }
  };

  const handleTestConnection = async () => {
    if (!tenant?.id) return;
    setIsTesting(true);
    try {
      const entered = { customerNumber: customerNumber.trim(), policyNumber: policyNumber.trim() };
      const outcome = await runVerify({ useSavedCredentials: false });
      if (!outcome) return;

      applyVerifyOutcome(outcome, entered);

      if (!outcome.ok) {
        const copy = verifyFailureCopy(outcome, entered);
        toast({ title: copy.title, description: copy.description, variant: 'destructive' });
        return;
      }

      if (outcome.simulated) {
        toast({
          title: 'Simulator connected',
          description:
            'Nothing was sent to ABI. You can drive the whole INSHUR flow from here — every response is generated locally and marked SIMULATED. Switch to Test mode to check these credentials against ABI for real.',
        });
        return;
      }

      const detail = [
        outcome.signedInAs ? `Signed in to ABI as ${outcome.signedInAs}.` : 'ABI accepted these credentials.',
        outcome.carrierName ? `Policy ${entered.policyNumber} — ${outcome.carrierName}.` : `Policy ${entered.policyNumber}.`,
        outcome.states.length
          ? `Cover can be written in ${outcome.states.length} ${outcome.states.length === 1 ? 'state' : 'states'}.`
          : 'ABI did not return a covered-states list — enter them by hand below.',
      ].join(' ');

      toast({ title: 'INSHUR connected', description: detail });
    } catch (err: any) {
      toast({
        title: 'Connection test failed',
        description: `${
          err?.message || 'The connection test could not be run.'
        } Only an owner or admin can exercise ABI credentials — if that is not you, ask one of them to run this.`,
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!tenant?.id || !formIsValid) return;

    const cleanUsername = username.trim();
    const cleanPassword = password.trim();
    const cleanCustomerNumber = customerNumber.trim();
    const cleanPolicyNumber = policyNumber.trim();
    const entered = { customerNumber: cleanCustomerNumber, policyNumber: cleanPolicyNumber };

    setIsSaving(true);
    try {
      const outcome = await runVerify({ useSavedCredentials: false });
      if (outcome) {
        applyVerifyOutcome(outcome, entered);
        if (!outcome.ok) {
          const copy = verifyFailureCopy(outcome, entered);
          toast({
            title: copy.title,
            description: `${copy.description} Nothing was saved.`,
            variant: 'destructive',
          });
          return;
        }
      }

      const update: Record<string, unknown> = {
        inshur_username: cleanUsername,
        inshur_customer_number: outcome?.resolvedCustomerNumber || cleanCustomerNumber,
        inshur_policy_number: cleanPolicyNumber,
        integration_inshur: true,
      };
      // A blank password field means "keep the stored one", never "clear it".
      if (cleanPassword) update.inshur_password = cleanPassword;
      // The covered-states list is written by inshur-verify-credentials itself,
      // which also records which endpoint path answered. Writing it again from
      // here would race that and drop the path it resolved.

      const { error } = await supabaseUntyped.from('tenants').update(update).eq('id', tenant.id);
      if (error) throw error;

      await invalidate();
      toast({
        title: 'INSHUR credentials saved',
        description: `Your ABI details are stored. INSHUR is still in ${MODE_COPY[currentMode].label} mode — switch to Live when you are ready to write real cover.`,
      });
    } catch (err: any) {
      toast({
        title: 'Could not save',
        description: `${err?.message || 'Unknown error'}. Your credentials were not changed.`,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    if (!tenant?.id) return;
    setIsEnabling(true);
    try {
      const update: Record<string, unknown> = { integration_inshur: next };
      // Turning the integration off must never leave a live mode armed behind it.
      if (!next) update.inshur_mode = 'mock';

      const { error } = await supabaseUntyped.from('tenants').update(update).eq('id', tenant.id);
      if (error) throw error;

      await invalidate();
      toast({
        title: next ? 'INSHUR Period Z enabled' : 'INSHUR Period Z disabled',
        description: next
          ? 'Staff can now work through the INSHUR flow. It starts in Simulation mode — nothing reaches ABI until you switch modes.'
          : 'Staff can no longer start new INSHUR cover. Cover already active on ABI is untouched and stays billable.',
      });
    } catch (err: any) {
      toast({
        title: 'Could not update INSHUR',
        description: err?.message || 'Failed to change the integration state.',
        variant: 'destructive',
      });
    } finally {
      setIsEnabling(false);
    }
  };

  const applyMode = async (next: InshurMode) => {
    if (!tenant?.id) return;
    setIsUpdatingMode(true);
    try {
      const { error } = await supabaseUntyped
        .from('tenants')
        .update({ inshur_mode: next, integration_inshur: true })
        .eq('id', tenant.id);
      if (error) throw error;

      await invalidate();

      if (next === 'live') {
        toast({
          title: 'INSHUR is live',
          description: 'Cover you start from now on is real and will appear on your ABI invoice.',
        });
      } else {
        toast({
          title: `INSHUR switched to ${MODE_COPY[next].label}`,
          description:
            next === 'mock'
              ? 'Nothing reaches ABI from now on. Records created in Simulation mode are permanently marked SIMULATED and never become real cover.'
              : 'New cover is written against your ABI test account. Cover already active on ABI is untouched and stays billable.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Could not change mode',
        description: err?.message || 'Failed to update the INSHUR mode.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingMode(false);
      setShowGoLive(false);
      setShowTestConfirm(false);
      setGoLiveConfirmText('');
    }
  };

  const requestModeChange = (next: InshurMode) => {
    if (next === currentMode || isUpdatingMode) return;
    if (next === 'live') {
      setGoLiveConfirmText('');
      setShowGoLive(true);
      return;
    }
    if (next === 'test' && currentMode === 'mock') {
      setShowTestConfirm(true);
      return;
    }
    applyMode(next);
  };

  const handleSyncStates = async () => {
    if (!tenant?.id) return;
    setIsSyncingStates(true);
    try {
      const outcome = await runVerify({ useSavedCredentials: true });
      if (outcome) setVerify(outcome);

      if (!outcome || !outcome.ok) {
        toast({
          title: 'Could not read your covered states',
          description:
            (outcome?.message ? `${outcome.message} ` : 'ABI did not answer the covered-states request. ') +
            'Your credentials are still saved. Try again in a minute, pin the endpoint under Advanced, or enter the states by hand — going live does not depend on this sync.',
          variant: 'destructive',
        });
        return;
      }

      if (!outcome.states.length) {
        toast({
          title: 'ABI returned no covered states',
          description:
            'The request succeeded but the list was empty. That usually means the covered-states endpoint path is wrong — try the alternate path under Advanced, or enter the states by hand.',
          variant: 'destructive',
        });
        return;
      }

      // inshur-verify-credentials persists the list itself, alongside the path
      // that answered. Only write from here when that write failed.
      if (!outcome.persisted) {
        const { error } = await supabaseUntyped
          .from('tenants')
          .update({
            inshur_states_allowed: outcome.states,
            inshur_states_synced_at: new Date().toISOString(),
          })
          .eq('id', tenant.id);
        if (error) throw error;
      }

      await invalidate();
      toast({
        title: 'Covered states updated',
        description: `${outcome.states.length} ${
          outcome.states.length === 1 ? 'state' : 'states'
        } read from ABI${outcome.simulated ? ' — simulated, not from your real policy' : ''}${
          outcome.statesPath ? `, via ${outcome.statesPath}` : ''
        }.`,
      });
    } catch (err: any) {
      toast({
        title: 'Could not read your covered states',
        description: `${err?.message || 'Unknown error'}. You can enter the states by hand instead.`,
        variant: 'destructive',
      });
    } finally {
      setIsSyncingStates(false);
    }
  };

  const handleSaveStates = async () => {
    if (!tenant?.id) return;
    const { states, invalid } = parseStateList(statesDraft);

    if (invalid.length) {
      toast({
        title: 'Not a US state code',
        description: `${invalid.join(', ')} ${
          invalid.length === 1 ? 'is not a' : 'are not'
        } two-letter US state code${invalid.length === 1 ? '' : 's'}. Use codes like CA, FL, TX.`,
        variant: 'destructive',
      });
      return;
    }

    setIsSavingStates(true);
    try {
      const { error } = await supabaseUntyped
        .from('tenants')
        .update({
          inshur_states_allowed: states,
          inshur_states_synced_at: new Date().toISOString(),
        })
        .eq('id', tenant.id);
      if (error) throw error;

      await invalidate();
      setIsEditingStates(false);
      toast({
        title: states.length ? 'Covered states saved' : 'Covered states cleared',
        description: states.length
          ? `Cover can be written in ${states.length} ${states.length === 1 ? 'state' : 'states'}: ${states.join(', ')}.`
          : 'No states are listed. Rentals will not be checked against a covered-states list until you add some.',
      });
    } catch (err: any) {
      toast({
        title: 'Could not save covered states',
        description: err?.message || 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingStates(false);
    }
  };

  const handleSaveTimezone = async () => {
    if (!tenant?.id) return;
    const next = timezoneDraft.trim();
    if (!next) return;

    setIsSavingTimezone(true);
    try {
      const { error } = await supabaseUntyped.from('tenants').update({ timezone: next }).eq('id', tenant.id);
      if (error) throw error;

      await invalidate();
      toast({
        title: 'Business timezone saved',
        description: `INSHUR rental periods will start and end on ${next} wall-clock time.`,
      });
    } catch (err: any) {
      toast({
        title: 'Could not save the timezone',
        description: err?.message || 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingTimezone(false);
    }
  };

  const handleSaveAdvanced = async () => {
    if (!tenant?.id) return;
    setIsSavingAdvanced(true);
    try {
      const update: Record<string, unknown> = {
        inshur_endpoint_overrides: buildOverridePayload(),
        inshur_2fa_token: twoFactorToken.trim() || null,
      };
      const { error } = await supabaseUntyped.from('tenants').update(update).eq('id', tenant.id);
      if (error) throw error;

      await invalidate();
      toast({
        title: 'Advanced settings saved',
        description: 'INSHUR requests will use these paths from the next call onwards. No redeploy is needed.',
      });
    } catch (err: any) {
      toast({
        title: 'Could not save advanced settings',
        description: err?.message || 'Unknown error.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingAdvanced(false);
    }
  };

  const handleDisconnect = async () => {
    if (!tenant?.id) return;
    try {
      const { error } = await supabaseUntyped
        .from('tenants')
        .update({
          inshur_username: null,
          inshur_password: null,
          inshur_customer_number: null,
          inshur_policy_number: null,
          inshur_2fa_token: null,
          inshur_states_allowed: [],
          inshur_states_synced_at: null,
          integration_inshur: false,
          inshur_mode: 'mock',
        })
        .eq('id', tenant.id);
      if (error) throw error;

      setUsername('');
      setPassword('');
      setCustomerNumber('');
      setPolicyNumber('');
      setTwoFactorToken('');
      setVerify(null);
      setCorrectedCustomerNumber(null);

      await invalidate();
      toast({
        title: 'INSHUR disconnected',
        description:
          typeof activeCoverCount === 'number' && activeCoverCount > 0
            ? `Credentials removed. ${activeCoverCount} rental${
                activeCoverCount === 1 ? ' is' : 's are'
              } still on cover with ABI and will still be billed — end them at portal.abiweb.com if you do not want that.`
            : 'Credentials removed. Staff can no longer start new INSHUR cover.',
      });
    } catch (err: any) {
      toast({
        title: 'Could not disconnect',
        description: err?.message || 'Unknown error.',
        variant: 'destructive',
      });
    }
    setShowDisconnect(false);
  };

  // -------------------------------------------------------------------------
  // Go-live preflight
  // -------------------------------------------------------------------------

  const preflight: PreflightRow[] = useMemo(() => {
    const rows: PreflightRow[] = [];

    rows.push({
      key: 'credentials',
      label: 'All four ABI credentials saved',
      ok: savedCredsComplete,
      blocking: true,
      detail: 'Add your ABI email, password, customer number and policy number, then press Save credentials.',
    });

    rows.push({
      key: 'connection',
      label: 'Connection tested against ABI',
      ok: connectionProven,
      blocking: true,
      detail:
        currentMode === 'mock'
          ? 'Simulation mode answers connection tests locally, which proves nothing about your credentials. Switch to Test mode first, run Test connection, then come back here.'
          : 'Run Test connection with the saved values — we will not go live on untested credentials.',
    });

    // The INSHUR_ALLOW_LIVE fence lives on the edge runtime, so the only way to
    // observe it is to ask. Flipping a tenant to live behind a closed fence
    // leaves every bind throwing with nothing on screen to explain why.
    rows.push({
      key: 'runtime',
      label: 'This environment may write live cover',
      ok: verify?.runtimeAllowsLive === true,
      blocking: true,
      detail: verify
        ? 'Live INSHUR cover is switched off in this environment. Going live here would leave every rental failing to bind. Go live from the production portal instead.'
        : 'Run Test connection — it reports whether this environment is permitted to write live cover.',
    });

    rows.push({
      key: 'timezone',
      label: savedTimezone ? `Business timezone set (${savedTimezone})` : 'Business timezone set',
      ok: !!savedTimezone,
      blocking: true,
      // No fixHref: the control is the Business timezone card on this very page,
      // and the Settings → General timezone field writes a different row
      // (org_settings) that INSHUR never reads. Sending an operator there would
      // have them set a value that leaves this row red.
      detail:
        'INSHUR needs a timezone for every rental period. Without one, cover would start and end at the wrong hour, so no cover can be started at all. Close this dialog and set it on the Business timezone card above.',
    });

    // Deliberately NOT blocking. The covered-states endpoint is one of the paths
    // ABI documents inconsistently, so a 404 here must never be able to trap an
    // operator outside live mode — the manual list below is the way out.
    rows.push({
      key: 'states',
      label: statesAllowed.length
        ? `${statesAllowed.length} covered ${statesAllowed.length === 1 ? 'state' : 'states'} on file`
        : 'Covered states on file',
      ok: statesAllowed.length > 0,
      blocking: false,
      detail:
        'We have no covered-states list for your policy. Rentals will not be checked against one. Press Refresh from ABI, or type the states in by hand — both are on the Covered states card.',
    });

    rows.push({
      key: 'twofactor',
      label: 'Two-factor exemption or token in place',
      ok: !!(status?.inshur_2fa_token || '').trim(),
      blocking: false,
      detail:
        'No two-factor token is saved. If your ABI login has two-factor authentication switched on, every unattended INSHUR request will fail. Ask INSHUR to exempt the API login, or paste a token under Advanced.',
    });

    if (fleet) {
      rows.push({
        key: 'vehicles',
        label: `${fleet.withVin} of ${fleet.total} vehicles have a VIN`,
        ok: fleet.withVin > 0,
        blocking: false,
        detail:
          fleet.total === 0
            ? 'You have no vehicles yet. INSHUR identifies vehicles by VIN only.'
            : 'None of your vehicles has a 17-character VIN. INSHUR identifies vehicles by VIN only, so nothing can be covered until you add them.',
        fixLabel: 'Go to Vehicles',
        fixHref: '/vehicles',
      });

      if (fleet.garagingKnown) {
        rows.push({
          key: 'garaging',
          label: `${fleet.withGaragingState} of ${fleet.total} vehicles have a garaging state`,
          ok: fleet.total === 0 || fleet.withGaragingState > 0,
          blocking: false,
          detail:
            'ABI requires a state on every rental period. Vehicles without a garaging state cannot be covered even when they pass the eligibility check.',
          fixLabel: 'Go to Vehicles',
          fixHref: '/vehicles',
        });
      }
    }

    rows.push({
      key: 'stripe',
      label: 'Stripe is in live mode',
      ok: stripeIsLive,
      blocking: false,
      detail:
        'Stripe is in test mode. Going live on INSHUR while Stripe is in test means real cover charged with fake money.',
      fixLabel: 'Stripe settings',
      fixHref: '/settings?tab=payments',
    });

    return rows;
  }, [savedCredsComplete, connectionProven, currentMode, verify, savedTimezone, status?.inshur_2fa_token, statesAllowed.length, fleet, stripeIsLive]);

  const blockingFailures = preflight.filter((r) => r.blocking && !r.ok);
  const canGoLive = blockingFailures.length === 0 && goLiveConfirmText === 'LIVE';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-9 w-64" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statusError) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="p-4 rounded-lg border bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-red-800 dark:text-red-300">Could not load your INSHUR settings</h4>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                  {(statusError as Error)?.message || 'Unknown error.'}
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchStatus()}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Simulation hazard banner — no dismiss, no "don't show again". */}
      {isMock && isEnabled && (
        <div className="rounded-lg border border-amber-400 overflow-hidden" role="status">
          <div
            className="px-4 py-3 flex flex-wrap items-center gap-3"
            style={{ background: 'repeating-linear-gradient(45deg,#fbbf24 0 12px,#111827 12px 24px)' }}
          >
            <span className="bg-amber-300 text-black text-[13px] font-semibold px-2 py-0.5 rounded">
              INSHUR SIMULATION MODE — no insurance is real
            </span>
          </div>
          <div className="p-4 bg-amber-50 dark:bg-amber-950/30 space-y-2">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Nothing on this page reaches ABI. Eligibility answers, rental periods and ID cards are produced by
              Drive247&apos;s simulator so the whole flow can be exercised before INSHUR issues your credentials.
            </p>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Cover created in this mode does not exist. Never tell a renter they are insured on the strength of a
              simulated record, and never hand over a simulated ID card as proof of insurance.
            </p>
            {stripeIsLive && (
              <div className="mt-3 p-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  INSHUR is simulated but Stripe is LIVE.
                </p>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1 ml-6">
                  Renters can be charged real money for cover that does not exist. Do not sell insurance until INSHUR
                  is in Live mode.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Card 1: Integration + mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            INSHUR Period Z
            <Badge className={`${modeCopy.badgeClass} shrink-0`}>{modeCopy.badge}</Badge>
          </CardTitle>
          <CardDescription>
            Per-rental liability cover for US fleets, written against your ABI Period X policy
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50 dark:bg-gray-900/50 dark:border-gray-700">
            <div className="pr-4">
              <Label htmlFor="inshur-enabled" className="font-medium">
                {isEnabled ? 'INSHUR Period Z is switched on' : 'INSHUR Period Z is switched off'}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isEnabled
                  ? 'Staff can work through the INSHUR flow on rentals. The mode below decides whether any of it is real.'
                  : 'Switch this on to set INSHUR up. It starts in Simulation mode, so nothing reaches ABI until you say so.'}
              </p>
            </div>
            {isEnabling ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
            ) : (
              <Switch id="inshur-enabled" checked={isEnabled} onCheckedChange={handleToggleEnabled} />
            )}
          </div>

          {!isEnabled && (
            <div className="p-4 rounded-lg border bg-gray-50 border-gray-200 dark:bg-gray-900/50 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                INSHUR Period Z insures a vehicle for the length of a single rental. It only works on vehicles that
                already carry an active Period X policy, which you buy from INSHUR at{' '}
                <a
                  href={ABI_PORTAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#6366f1] hover:underline"
                >
                  portal.abiweb.com
                </a>
                . There is no API for that step.
              </p>
            </div>
          )}

          {isEnabled && (
            <>
              <div className={`p-4 rounded-lg border ${modeCopy.cardClass}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-medium flex items-center gap-2">
                      {currentMode === 'live' ? (
                        <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : currentMode === 'test' ? (
                        <TestTube2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      )}
                      <span className="dark:text-white">{modeCopy.title}</span>
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1 dark:text-gray-300">{modeCopy.body}</p>
                  </div>
                  <Badge className={`${modeCopy.badgeClass} shrink-0`}>{modeCopy.badge}</Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-medium">Mode</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className="inline-flex rounded-lg border border-border p-1 bg-muted/40"
                    role="radiogroup"
                    aria-label="INSHUR mode"
                  >
                    {(['mock', 'test', 'live'] as const).map((m) => {
                      const blocked = m !== 'mock' && !savedCredsComplete;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={currentMode === m}
                          disabled={isUpdatingMode || blocked}
                          title={
                            blocked
                              ? 'Add all four ABI credentials below and save them before leaving Simulation mode.'
                              : undefined
                          }
                          onClick={() => requestModeChange(m)}
                          className={`px-3 h-8 text-xs font-medium rounded-md transition-colors ${
                            currentMode === m
                              ? 'bg-background shadow-sm text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          {MODE_COPY[m].label}
                        </button>
                      );
                    })}
                  </div>
                  {isUpdatingMode && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <p className="text-xs text-[#737373]">
                  {savedCredsComplete
                    ? 'Simulation never contacts ABI. Test and Live both hit api.abiweb.com — ABI runs them on the same servers and only the credentials differ.'
                    : 'Add all four ABI credentials below and save them before leaving Simulation mode.'}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isEnabled && (
        <>
          {/* Card 2: Credentials */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                ABI Credentials
                {savedCredsComplete ? (
                  <Badge className="bg-green-600 hover:bg-green-700">Saved</Badge>
                ) : (
                  <Badge variant="secondary">Not set</Badge>
                )}
              </CardTitle>
              <CardDescription>
                The four values INSHUR sends you when your account is opened. Pasting them here is the only setup step.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="inshur-username">ABI portal email</Label>
                  <Input
                    id="inshur-username"
                    type="email"
                    autoComplete="off"
                    placeholder="you@yourcompany.com"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <p className={`text-xs ${fieldErrors.username ? 'text-red-600 dark:text-red-400' : 'text-[#737373]'}`}>
                    {fieldErrors.username || 'The email address you sign in with at portal.abiweb.com.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inshur-password">ABI portal password</Label>
                  <Input
                    id="inshur-password"
                    type="password"
                    autoComplete="off"
                    data-1p-ignore
                    placeholder={passwordAlreadySet ? '••••••••••••' : 'Your portal.abiweb.com password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className={`text-xs ${fieldErrors.password ? 'text-red-600 dark:text-red-400' : 'text-[#737373]'}`}>
                    {fieldErrors.password ||
                      (passwordAlreadySet
                        ? 'A password is saved. Leave this blank to keep it, or type a new one to replace it.'
                        : 'Your portal.abiweb.com password. It is never shown back to you once saved.')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inshur-customer-number">Customer number</Label>
                  <Input
                    id="inshur-customer-number"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABIABC2023"
                    value={customerNumber}
                    onChange={(e) => {
                      setCustomerNumber(e.target.value);
                      setCorrectedCustomerNumber(null);
                    }}
                  />
                  {correctedCustomerNumber && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Corrected from {correctedCustomerNumber.from} to {correctedCustomerNumber.to} using ABI&apos;s
                      policy lookup. Press Save credentials to confirm.
                    </p>
                  )}
                  <p
                    className={`text-xs ${
                      fieldErrors.customerNumber ? 'text-red-600 dark:text-red-400' : 'text-[#737373]'
                    }`}
                  >
                    {fieldErrors.customerNumber || 'INSHUR gives you this. It appears at the top of your policy documents.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inshur-policy-number">Policy number</Label>
                  <Input
                    id="inshur-policy-number"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABIABC2023-01"
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                  />
                  <p
                    className={`text-xs ${
                      fieldErrors.policyNumber ? 'text-red-600 dark:text-red-400' : 'text-[#737373]'
                    }`}
                  >
                    {fieldErrors.policyNumber ||
                      'Your Period X policy. Period Z rental cover is written against it.'}
                  </p>
                </div>
              </div>

              {/* Result of the last connection test */}
              {verify && (
                <div
                  className={`p-4 rounded-lg border ${
                    !verify.ok
                      ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                      : verify.simulated
                      ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800'
                      : 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {verify.ok ? (
                      <CheckCircle2
                        className={`h-5 w-5 mt-0.5 shrink-0 ${
                          verify.simulated ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'
                        }`}
                      />
                    ) : (
                      <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <div className="text-sm">
                      <p className="font-medium">
                        {!verify.ok
                          ? 'Last connection test failed'
                          : verify.simulated
                          ? 'Last connection test was simulated'
                          : 'Last connection test succeeded'}
                      </p>
                      <p className="text-muted-foreground mt-1 dark:text-gray-300">
                        {!verify.ok
                          ? verifyFailureCopy(verify, {
                              customerNumber: customerNumber.trim(),
                              policyNumber: policyNumber.trim(),
                            }).description
                          : verify.simulated
                          ? 'Drive247 answered this locally. It proves the flow works; it proves nothing about your ABI credentials. Switch to Test mode and run it again to check them for real.'
                          : [
                              verify.signedInAs ? `Signed in as ${verify.signedInAs}.` : 'ABI accepted these credentials.',
                              verify.carrierName ? `Carrier: ${verify.carrierName}.` : null,
                              verify.policyStatus ? `Policy status: ${verify.policyStatus}.` : null,
                              verify.states.length
                                ? `${verify.states.length} covered ${verify.states.length === 1 ? 'state' : 'states'}.`
                                : 'No covered-states list was returned.',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                      </p>
                      {verify.fingerprint !== currentFingerprint && (
                        <p className="text-xs text-muted-foreground mt-2">
                          You have edited the credentials since this test ran. Test again before going live.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {/* Simulation answers without credentials, so the button stays live
                    with an empty form — the simulated path has to be reachable on
                    a tenant that has never been given anything to paste. */}
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || isSaving || (!isMock && !formIsValid)}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Test connection
                    </>
                  )}
                </Button>
                <Button onClick={handleSaveCredentials} disabled={isSaving || isTesting || !formIsValid}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Save credentials
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-[#737373]">
                Test connection never stores your credentials — it does refresh the covered-states list below. Save
                credentials always tests first and stops if the test fails.
                {isMock
                  ? ' Simulation mode answers the test locally — switch to Test mode to check these values against ABI.'
                  : ''}
              </p>
            </CardContent>
          </Card>

          {/* Card 3: Business timezone */}
          <Card className={savedTimezone ? undefined : 'border-red-300 dark:border-red-800'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Business timezone
                {savedTimezone ? (
                  <Badge className="bg-green-600 hover:bg-green-700">{savedTimezone}</Badge>
                ) : (
                  <Badge variant="destructive">Required</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Every INSHUR rental period is sent as a wall-clock time plus this zone. Cover cannot be started without
                it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!savedTimezone && (
                <div className="p-4 rounded-lg border bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">No business timezone is set</p>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                    Every attempt to start INSHUR cover will fail until you choose one. This is the only place it can be
                    set — the timezone under Settings → General is a separate value that INSHUR does not read.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="inshur-timezone">Timezone your rental times are quoted in</Label>
                <Select value={timezoneDraft} onValueChange={setTimezoneDraft}>
                  <SelectTrigger id="inshur-timezone" className="w-full sm:w-96">
                    <SelectValue placeholder="Choose a timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {timezoneOptions.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#737373]">
                  Pickup and return times on your rentals are already stored in this zone. Changing it does not move
                  cover that has already been written — ABI cannot amend a rental period once it exists.
                </p>
              </div>

              <Button
                onClick={handleSaveTimezone}
                disabled={isSavingTimezone || !timezoneDraft.trim() || timezoneDraft.trim() === savedTimezone}
              >
                {isSavingTimezone ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save timezone'
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Card 4: Covered states */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Covered states
              </CardTitle>
              <CardDescription>
                The states your Period X policy allows Period Z cover in. Rentals outside them cannot be insured.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isMock && (
                <div className="p-3 rounded-lg border bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    <span className="font-medium">Simulation mode.</span> A list refreshed here is invented by the
                    simulator, not read from your policy. Replace it with the real list before you go live.
                  </p>
                </div>
              )}

              {!isEditingStates && (
                <>
                  {statesAllowed.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {statesAllowed.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center rounded border border-[#e0e7ff] bg-[#eef2ff] px-2 py-0.5 text-xs font-medium text-[#4338ca] dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
                      <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">No covered states on file</p>
                      <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                        Refresh from ABI, or type the states in by hand. Going live does not depend on this list, so a
                        failed sync can never lock you out — but without it we cannot warn you when a rental falls
                        outside your policy.
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-[#737373]">
                    {status?.inshur_states_synced_at
                      ? `Last updated ${formatDistanceToNow(new Date(status.inshur_states_synced_at), {
                          addSuffix: true,
                        })}.`
                      : 'Never updated.'}{' '}
                    Covered states come from your policy, not from a fixed list. To add a state, contact INSHUR — the
                    change appears here after the next refresh.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      onClick={handleSyncStates}
                      disabled={isSyncingStates || (!isMock && !savedCredsComplete)}
                      title={isMock || savedCredsComplete ? undefined : 'Save your ABI credentials first.'}
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${isSyncingStates ? 'animate-spin' : ''}`} />
                      {isSyncingStates ? 'Refreshing...' : isMock ? 'Refresh (simulated)' : 'Refresh from ABI'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatesDraft(statesAllowed.join(', '));
                        setIsEditingStates(true);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Enter states manually
                    </Button>
                  </div>
                </>
              )}

              {isEditingStates && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="inshur-states">Covered state codes</Label>
                    <Textarea
                      id="inshur-states"
                      rows={3}
                      spellCheck={false}
                      placeholder="AZ, CA, CO, FL, GA, MD, PA, SC"
                      value={statesDraft}
                      onChange={(e) => setStatesDraft(e.target.value)}
                    />
                    <p className="text-xs text-[#737373]">
                      Two-letter US state codes, separated by commas. Take them from your policy schedule or from your
                      INSHUR account manager. Anything you type here replaces the list entirely and survives a failed
                      sync.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleSaveStates} disabled={isSavingStates}>
                      {isSavingStates ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save covered states'
                      )}
                    </Button>
                    <Button variant="outline" onClick={() => setIsEditingStates(false)} disabled={isSavingStates}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 5: Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button type="button" className="w-full text-left">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Settings2 className="h-5 w-5 text-primary" />
                        Advanced
                      </CardTitle>
                      <CardDescription className="mt-1.5">
                        Endpoint overrides and the two-factor token. You should not need these.
                      </CardDescription>
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                    />
                  </CardHeader>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="space-y-6">
                  <div className="p-4 rounded-lg border bg-muted/50 dark:bg-gray-900/50 dark:border-gray-700">
                    <p className="text-sm text-muted-foreground dark:text-gray-300">
                      ABI documents three things inconsistently, and we will only find out which version is right when
                      real calls start flowing. They are editable here so that fixing one is a Settings change rather
                      than a code release. Leave them blank unless INSHUR tells you otherwise — Drive247 works the
                      right answer out on its own wherever it can, and records it below. Anything you change here is
                      read from your saved settings, so save first and then run Test connection.
                    </p>
                  </div>

                  {ENDPOINT_FIELDS.map((field) => {
                    const autoPath =
                      savedOverrides[`${field.key}_source`] === 'auto' ? overrideString(savedOverrides, field.key) : '';
                    const autoAt = savedOverrides[`${field.key}_resolved_at`];
                    return (
                      <div key={field.key} className="space-y-2">
                        <Label htmlFor={`inshur-endpoint-${field.key}`}>{field.label}</Label>
                        <Input
                          id={`inshur-endpoint-${field.key}`}
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={field.documented}
                          value={endpointDraft[field.key] || ''}
                          onChange={(e) => setEndpointDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEndpointDraft((prev) => ({ ...prev, [field.key]: field.documented }))}
                          >
                            Use documented path
                          </Button>
                          {field.alternate && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setEndpointDraft((prev) => ({ ...prev, [field.key]: field.alternate }))}
                            >
                              Use alternate path
                            </Button>
                          )}
                          {(endpointDraft[field.key] || '') !== '' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setEndpointDraft((prev) => ({ ...prev, [field.key]: '' }))}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-[#737373]">{field.help}</p>
                        {autoPath && (
                          <p className="text-xs text-green-700 dark:text-green-400">
                            Drive247 worked this out on its own: {autoPath}
                            {typeof autoAt === 'string'
                              ? `, ${formatDistanceToNow(new Date(autoAt), { addSuffix: true })}`
                              : ''}
                            .{' '}
                            {(endpointDraft[field.key] || '') !== autoPath && (
                              <button
                                type="button"
                                className="underline"
                                onClick={() => setEndpointDraft((prev) => ({ ...prev, [field.key]: autoPath }))}
                              >
                                Pin this path
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <div className="space-y-2">
                    <Label htmlFor="inshur-billing-params">Billing date parameters</Label>
                    <Select value={billingParams} onValueChange={setBillingParams}>
                      <SelectTrigger id="inshur-billing-params" className="w-full sm:w-80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BILLING_PARAM_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-[#737373]">
                      The monthly cost-by-VIN feed filters on these two query parameters. Our notes and ABI&apos;s
                      reference disagree on the capitalisation, and the wrong one is not an error — it silently returns
                      unfiltered results. Leave this on Try both unless INSHUR confirms which is right.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="inshur-2fa-token">Two-factor token</Label>
                    <Input
                      id="inshur-2fa-token"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Leave blank if your ABI login has two-factor turned off"
                      value={twoFactorToken}
                      onChange={(e) => setTwoFactorToken(e.target.value)}
                    />
                    <p className="text-xs text-[#737373]">
                      ABI sends this header on every request for logins with two-factor authentication enabled, and the
                      code arrives by email — which no unattended job can read. Ask INSHUR to exempt this login from
                      two-factor authentication; until they do, paste a current token here whenever INSHUR calls start
                      failing with an authorisation error.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleSaveAdvanced} disabled={isSavingAdvanced}>
                      {isSavingAdvanced ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save advanced settings'
                      )}
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

        </>
      )}

      {/* Danger zone — deliberately outside the `isEnabled` block. Switching the
          integration off leaves the credentials in the row, so deleting them has
          to stay reachable without switching it back on first. */}
      {savedCredsComplete && (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Remove your ABI credentials and stop new cover being written</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950/30"
              onClick={() => setShowDisconnect(true)}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Disconnect INSHUR
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Go-live preflight */}
      <AlertDialog open={showGoLive} onOpenChange={setShowGoLive}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-green-600" />
              Switch INSHUR to Live?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  From now on, every rental you insure creates real cover on policy{' '}
                  {status?.inshur_policy_number || 'your Period X policy'}
                  {verify?.carrierName ? ` with ${verify.carrierName}` : ''}. ABI bills your account monthly, per VIN.
                </p>
                <p>
                  Two things to know before you do this. Cover can only be cancelled before it starts — once a rental
                  period begins you can only end it early. And ABI has no way to change a rental period after it is
                  created, so extending a rental means ending the old cover and starting new cover.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
            {preflight.map((row) => (
              <div
                key={row.key}
                className={`p-3 rounded-lg border text-sm ${
                  row.ok
                    ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
                    : row.blocking
                    ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                    : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {row.ok ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                  ) : row.blocking ? (
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium flex items-center gap-2">
                      {row.label}
                      {!row.ok && !row.blocking && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          Warning only
                        </span>
                      )}
                    </p>
                    {!row.ok && <p className="text-muted-foreground mt-0.5 dark:text-gray-300">{row.detail}</p>}
                    {!row.ok && row.fixHref && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 mt-1.5 text-xs"
                        onClick={() => {
                          setShowGoLive(false);
                          router.push(row.fixHref!);
                        }}
                      >
                        {row.fixLabel}
                        <ExternalLink className="h-3 w-3 ml-1.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inshur-go-live-confirm">Type LIVE to confirm</Label>
            <Input
              id="inshur-go-live-confirm"
              autoComplete="off"
              spellCheck={false}
              placeholder="LIVE"
              value={goLiveConfirmText}
              onChange={(e) => setGoLiveConfirmText(e.target.value)}
            />
            {goLiveConfirmText.length > 0 && goLiveConfirmText !== 'LIVE' && (
              <p className="text-xs text-red-600 dark:text-red-400">Type LIVE exactly, in capitals.</p>
            )}
            {blockingFailures.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Finish the items marked above before going live. Items labelled &quot;warning only&quot; do not stop you.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applyMode('live')}
              disabled={!canGoLive || isUpdatingMode}
              className="bg-green-600 hover:bg-green-700"
            >
              {isUpdatingMode ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Switching...
                </>
              ) : (
                'Yes, go live'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leaving simulation */}
      <AlertDialog open={showTestConfirm} onOpenChange={setShowTestConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TestTube2 className="h-5 w-5 text-blue-600" />
              Leave Simulation mode?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Test mode sends real requests to ABI using your credentials. Rentals land on your ABI test account — no
              renter is insured and nothing is billed, but the requests are real. Simulated records already created here
              stay marked SIMULATED and are never converted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyMode('test')} disabled={isUpdatingMode}>
              Yes, switch to Test
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect */}
      <AlertDialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-red-600" />
              Disconnect INSHUR?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your ABI credentials and two-factor token will be deleted, INSHUR will drop back to Simulation mode,
                  and staff will not be able to start new cover.
                </p>
                <p>
                  {typeof activeCoverCount === 'number' && activeCoverCount > 0
                    ? `${activeCoverCount} rental${
                        activeCoverCount === 1 ? '' : 's'
                      } already on cover stay on cover. ABI keeps them on your policy and they will still be billed — end them from portal.abiweb.com if you do not want that.`
                    : 'Rentals already on cover stay on cover. ABI keeps them on your policy and they will still be billed — end them from portal.abiweb.com if you do not want that.'}{' '}
                  ID cards already downloaded remain available to your renters.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} className="bg-red-600 hover:bg-red-700">
              Yes, Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default InshurSettings;
