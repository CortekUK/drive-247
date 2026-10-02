"use client";

// ── Bonzah — per-rental insurance ─────────────────────────────────────────────
//
// Bonzah is the only integration on this board an operator cannot connect by
// themselves, and that shapes the whole panel. The connect action lives in
// Bonzah's own console: `bonzah-partner-review` (approve) flips the tenant to
// live, verifies the credentials against Bonzah, then writes
// `bonzah_username` / `bonzah_password` / `integration_bonzah = true` in one
// go. The operator's job is to APPLY and then to KEEP THE LOGIN WORKING.
//
// So the panel answers two questions and refuses to blur them:
//
//   1. "Where am I?"  — read from real rows, never guessed from a boolean.
//      `integration_bonzah = false` is true of an operator who has never
//      applied AND of one whose application is sitting on a reviewer's desk,
//      and telling both of them "Not connected" is how the second one applies
//      twice. The stage comes from `bonzah_onboarding_submissions` plus the
//      credential columns; see `deriveStage`.
//
//   2. "Is the login Bonzah has still the login we have?" — the failure this
//      integration actually suffers. Global Motion Transport stopped being
//      able to issue policies in Aug 2026 because Bonzah reset their password
//      on their side; nothing changed here (`tenants.updated_at` was two
//      months old), every quote just started failing. Commit 46e13ff9 gave
//      that its own error type. "Test connection" is the control that catches
//      it, which is why it is the headline of the connected state and not a
//      footnote.
//
// ⚠️ ISOLATION. RLS is off on `tenants` and `bonzah_insurance_policies`
// (V2_PLAN §5). Every read and write below carries `.eq('tenant_id', …)`, or
// `.eq('id', tenant.id)` on `tenants` itself. There is no net under this.
//
// LEAN. `isTestModeUiHidden` is true for the canary, so there is no mode
// switch and no TEST badge here — but the panel never pretends the account is
// live when it is not. `bonzah_mode` is written by Bonzah's reviewer and by
// nobody else; this file only ever READS it.
//
// SELF-CONTAINED. The whole application runs inside this dialog: apply →
// submit → status → activate, with nothing routing away. It used to push the
// operator to `/settings?tab=insurance`, which is v1's screen — and the
// Integrations board now owns Bonzah for the canary, so that tab is being
// hidden from it. A link out would have become a link to nowhere. The wizard
// itself is `./bonzah-onboarding-v2`, a v2 SHELL around v1's schema, steps and
// submit hook; see the header of that file for why the v1 component could not
// simply be mounted here, and note that not one byte under
// `components/settings/bonzah-onboarding/` is touched (V2_PLAN §3) — the other
// 56 tenants reach it unchanged.

import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { extractFunctionError } from "@/lib/edge-error";
import { isBonzahSellable } from "@/lib/bonzah";
import { BONZAH_LINKS } from "@/lib/bonzah-compliance";
import { useIsTestModeUiHidden } from "@/lib/lean-context";
import { getBonzahPortalUrl } from "@/hooks/use-bonzah-balance";
import { useBonzahAlertConfig } from "@/hooks/use-bonzah-alert-config";
import { useBonzahRetryAll } from "@/hooks/use-bonzah-retry-all";

import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Switch } from "@/components/ui-v2/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLink,
  PanelLoading,
  PanelNote,
  PanelRow,
  StatusChip,
  type IntegrationState,
} from "./_kit";
import BonzahOnboardingV2 from "./bonzah-onboarding-v2";
import { NORTHWIND } from "@/lib/v2";
import { useNarrowDialog } from "./_screens";
import { InsurancesEmptyArt } from "@/components/illustrations-v2/scenes/insurances";
import {
  BonzahApplyArt,
  BonzahLoginArt,
  BonzahReturnedArt,
  BonzahReviewArt,
  BonzahWalletArt,
} from "@/components/illustrations-v2/scenes/bonzah";

/* ─────────────────────────────── shape ──────────────────────────────────── */

type SubmissionStatus = "pending" | "approved" | "rejected";

type BonzahSubmission = {
  id: string;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  activated_at: string | null;
  partner_message: string | null;
  reject_reason: string | null;
  admin_note: string | null;
  business_trade_name: string | null;
  primary_contact_email: string | null;
};

type BonzahTenantRow = {
  integration_bonzah: boolean | null;
  bonzah_username: string | null;
  bonzah_mode: "test" | "live" | null;
  bonzah_sandbox_override: boolean | null;
  bonzah_brochure_url: string | null;
  bonzah_partner_id: string | null;
  bonzah_partner_id_set_at: string | null;
  /**
   * Whether a password is stored — NOT the password.
   *
   * Resolved with a `head: true` count filtered on `bonzah_password is not
   * null`, so the secret is never serialised to the browser at all. v1 selects
   * the column and prefills the form input with it; that is the one v1
   * behaviour this panel deliberately does not reproduce.
   */
  hasPassword: boolean;
};

/**
 * Where the operator actually is.
 *
 * Credentials win over submissions when both exist: several live operators were
 * onboarded before the wizard existed and have no submission row at all, and a
 * working integration must not be described by a missing application.
 */
type Stage =
  | "not_started"
  | "in_review"
  | "changes_requested"
  | "approved_not_activated"
  | "connected_not_activated"
  | "selling_off"
  | "live";

/**
 * Fields are optional so this takes both shapes that describe the same tenant:
 * the panel's freshly-read `BonzahTenantRow`, and the `PanelTenant` the board
 * hands the status chip (which TenantContext already populates with all four).
 */
function deriveStage(
  row: {
    bonzah_username?: string | null;
    bonzah_mode?: "test" | "live" | null;
    bonzah_sandbox_override?: boolean | null;
    integration_bonzah?: boolean | null;
  },
  submission: BonzahSubmission | null,
): Stage {
  const hasCredentials = !!row.bonzah_username;
  // Mirrors isBonzahSellable's mode half. A sandbox override is a super-admin
  // escape hatch for demo tenants; it is not the operator's to flip, so it is
  // read here and never written.
  const activated = row.bonzah_mode === "live" || row.bonzah_sandbox_override === true;

  if (hasCredentials) {
    if (!activated) return "connected_not_activated";
    return row.integration_bonzah === true ? "live" : "selling_off";
  }

  if (!submission) return "not_started";
  if (submission.status === "rejected") return "changes_requested";
  // `approved` without credentials is a real, reachable state, not a glitch:
  // the super-admin queue in apps/admin marks a submission approved with a
  // direct table write that never touches the tenant row, and
  // bonzah-partner-review is non-atomic between its two updates.
  if (submission.status === "approved") return "approved_not_activated";
  return "in_review";
}

const STAGE_CHIP: Record<Stage, { state: IntegrationState; label: string }> = {
  not_started: { state: "disconnected", label: "Not connected" },
  in_review: { state: "disconnected", label: "In review" },
  changes_requested: { state: "attention", label: "Updates needed" },
  approved_not_activated: { state: "attention", label: "Not activated" },
  connected_not_activated: { state: "attention", label: "Not activated" },
  selling_off: { state: "disconnected", label: "Selling off" },
  live: { state: "connected", label: "Selling" },
};

/* ─────────────────────────────── helpers ────────────────────────────────── */

/** Bonzah settles in USD whatever the tenant's own `currency_code` says. */
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;

/**
 * Did Bonzah reject the login, as opposed to failing for some other reason?
 *
 * The shared client throws `Error & { code: 'BONZAH_AUTH_FAILED' }`, but every
 * edge function serialises only `error.message` into `{ error }` — the code
 * never crosses the wire. Matching the message is therefore the only signal a
 * client has. Do not "simplify" this into reading a `code` field: there is no
 * code field in the response body, and the check would silently stop matching.
 */
const AUTH_FAILURE_PATTERNS = [
  /rejected the login saved/i,
  /rejected these credentials/i,
  /authentication failed/i,
];
const isAuthFailure = (message: string) =>
  AUTH_FAILURE_PATTERNS.some((re) => re.test(message));

/* ──────────────────────────────── queries ───────────────────────────────── */

const tenantKey = (id: string) => ["bonzah-panel-tenant", id] as const;
const submissionKey = (id: string) => ["bonzah-panel-submission", id] as const;

/**
 * The tenant's Bonzah columns, read fresh.
 *
 * TenantContext already carries most of these, but it is refetched on its own
 * schedule and Bonzah's reviewer can activate an account between two paints —
 * so the panel reads the row itself rather than describing a cached one.
 */
function useBonzahTenantRow(tenantId: string) {
  return useQuery({
    queryKey: tenantKey(tenantId),
    queryFn: async (): Promise<BonzahTenantRow> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "integration_bonzah, bonzah_username, bonzah_mode, bonzah_sandbox_override, bonzah_brochure_url, bonzah_partner_id, bonzah_partner_id_set_at",
        )
        .eq("id", tenantId) // ← tenants keyed by id, not tenant_id
        .single();
      if (error) throw error;

      const { count, error: countError } = await supabase
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("id", tenantId)
        .not("bonzah_password", "is", null);
      if (countError) throw countError;

      return { ...(data as Omit<BonzahTenantRow, "hasPassword">), hasPassword: (count ?? 0) > 0 };
    },
    staleTime: 15_000,
  });
}

/**
 * The most recent application.
 *
 * `enabled` is passed by the caller because the card's status chip only needs
 * this when there are no credentials — once an account is connected the
 * application it came from no longer describes anything, and the board renders
 * a chip for every card on first paint.
 */
function useBonzahSubmission(tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: submissionKey(tenantId),
    queryFn: async (): Promise<BonzahSubmission | null> => {
      const { data, error } = await supabase
        .from("bonzah_onboarding_submissions")
        .select(
          "id, status, submitted_at, reviewed_at, activated_at, partner_message, reject_reason, admin_note, business_trade_name, primary_contact_email",
        )
        .eq("tenant_id", tenantId) // ← isolation
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as BonzahSubmission | null) ?? null;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * What has happened to the application, in order.
 *
 * Carried over from v1's `submission-status.tsx`, which northwind can no longer
 * reach: Settings' insurance tab is being hidden from the canary now that this
 * board owns Bonzah, and `reviewed_at` and this timeline live nowhere else. An
 * operator whose application has been sitting for a fortnight needs to be able
 * to see whether anyone has touched it.
 *
 * ⚠️ v1's version selects on `submission_id` alone. RLS is ON for this table so
 * that is not a hole today — but the table carries `tenant_id` and V2_PLAN §5
 * says filter anyway, because the day RLS is disabled here nothing else would
 * notice.
 */
type SubmissionEvent = {
  id: string;
  actor_type: "customer" | "partner" | "system";
  event_type: string;
  note: string | null;
  created_at: string;
};

const eventsKey = (tenantId: string, submissionId: string) =>
  ["bonzah-panel-events", tenantId, submissionId] as const;

function useSubmissionEvents(tenantId: string, submissionId: string | null) {
  return useQuery({
    queryKey: eventsKey(tenantId, submissionId ?? "none"),
    queryFn: async (): Promise<SubmissionEvent[]> => {
      const { data, error } = await supabase
        .from("bonzah_submission_events")
        .select("id, actor_type, event_type, note, created_at")
        .eq("tenant_id", tenantId) // ← isolation
        .eq("submission_id", submissionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubmissionEvent[];
    },
    enabled: !!submissionId,
    staleTime: 60_000,
  });
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

export function BonzahStatus({ tenant }: { tenant: PanelTenant }) {
  // TenantContext already selects every column this needs, so the common case
  // — a connected account — costs no query at all.
  const hasCredentials = !!tenant.bonzah_username;
  const submissionQuery = useBonzahSubmission(tenant.id, !hasCredentials);

  if (!hasCredentials && submissionQuery.isLoading) {
    return <StatusChip state="loading" />;
  }

  // A failed submission read costs the finer wording, not the verdict: with no
  // credentials on the tenant row the account is genuinely not connected, so
  // falling back here cannot invite anyone to reconnect something live.
  // Named explicitly rather than spread, so this reads as the contract it is:
  // these four columns must stay in TenantContext's select or the chip starts
  // describing every account as "not connected".
  const stage = deriveStage(
    {
      bonzah_username: tenant.bonzah_username ?? null,
      bonzah_mode: tenant.bonzah_mode ?? null,
      bonzah_sandbox_override: tenant.bonzah_sandbox_override ?? null,
      integration_bonzah: tenant.integration_bonzah ?? null,
    },
    submissionQuery.data ?? null,
  );
  const chip = STAGE_CHIP[stage];
  return <StatusChip state={chip.state} label={chip.label} />;
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

export default function BonzahPanel({ tenant, onClose }: IntegrationPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refetchTenant } = useTenant();
  const leanUi = useIsTestModeUiHidden();

  const rowQuery = useBonzahTenantRow(tenant.id);
  const row = rowQuery.data;
  const hasCredentials = !!row?.bonzah_username;
  // The panel fetches this even for a connected account — unlike the chip,
  // which does not — because `activated_at` is the only record of WHEN Bonzah
  // switched this operator on, and the panel is one open dialog rather than
  // ten cards painting at once.
  const submissionQuery = useBonzahSubmission(tenant.id, !!row);
  const submission = submissionQuery.data ?? null;
  // The timeline is only worth a query while the application still describes
  // something. Once credentials exist, how the operator got them is history.
  const eventsQuery = useSubmissionEvents(
    tenant.id,
    submission && !row?.bonzah_username ? submission.id : null,
  );

  const stage = row ? deriveStage(row, submission) : null;
  const activated = row?.bonzah_mode === "live" || row?.bonzah_sandbox_override === true;
  const sellable = isBonzahSellable(row ?? null);
  const portalUrl = getBonzahPortalUrl(row?.bonzah_mode);

  /**
   * Is the balance we could read actually THIS operator's money?
   *
   * `bonzah-get-balance` resolves credentials server-side, and for a tenant
   * that is not yet live that resolves to Drive247's shared platform login —
   * so it would happily return a number that belongs to the platform's sandbox
   * wallet. Rendering that under "Your balance" would be a fiction, and it is
   * why this panel does not reuse `useBonzahBalance`, whose `enabled` treats
   * every not-yet-live tenant as connected and polls it every 60 seconds.
   */
  const canReadOwnBalance = !!row && hasCredentials && activated;

  const [busy, setBusy] = useState<null | "credentials" | "selling" | "disconnect" | "brochure">(null);
  /**
   * The application wizard takes over the dialog body while it is open.
   *
   * It replaces the stage view rather than sitting under it: a ten-step form
   * and a "where am I" summary competing for the same 600px is how an operator
   * loses their place, and the stage view has nothing to say that the wizard's
   * own header does not.
   */
  const [applying, setApplying] = useState(false);
  /** Which screen the panel is on. Every screen fits the dialog; none scrolls. */
  const [view, setView] = useState<View>("home");
  const [introStep, setIntroStep] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [brochure, setBrochure] = useState<string | null>(null);
  const [showFullDecision, setShowFullDecision] = useState(false);

  // Seed the editable fields once the row lands. The username is prefilled
  // because it is not a secret and retyping an email to fix a password is
  // pointless friction; the password box always starts empty.
  useEffect(() => {
    if (!row) return;
    setUsername((current) => current || row.bonzah_username || "");
    setBrochure((current) => (current === null ? row.bonzah_brochure_url ?? "" : current));
  }, [row]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tenantKey(tenant.id) }),
      queryClient.invalidateQueries({ queryKey: submissionKey(tenant.id) }),
      // Prefix match — the key carries the submission id, which changes when a
      // rejected application is replaced by a new one.
      queryClient.invalidateQueries({ queryKey: ["bonzah-panel-events", tenant.id] }),
      // v1's Settings → Insurance screen keys its own read this way. Keeping it
      // fresh means an operator who moves between the two screens is never
      // shown two different answers for the same account.
      queryClient.invalidateQueries({ queryKey: ["tenant-bonzah-status"] }),
    ]);
    refetchTenant?.();
  };

  /* ── balance / connection test ─────────────────────────────────────────── */

  // This one call is both readings at once: it authenticates with the STORED
  // credentials (the same resolution path every quote takes) and returns the
  // wallet the policies are paid from. So a green result is proof the login
  // still works, and a red one is the stale-credential case in plain sight.
  //
  // No `refetchInterval`: the function writes reminders, in-app notifications
  // and an email when the balance is under the operator's threshold, and a
  // dialog left open should not keep firing that.
  const balanceQuery = useQuery({
    queryKey: ["bonzah-panel-balance", tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bonzah-get-balance", {
        body: { tenant_id: tenant.id },
      });
      if (error) throw new Error(await extractFunctionError(error, "Bonzah did not return a balance."));
      return data as { balance?: string | null };
    },
    enabled: canReadOwnBalance,
    staleTime: 30_000,
    retry: false,
  });

  const balanceNumber =
    balanceQuery.data?.balance != null ? Number(balanceQuery.data.balance) : null;
  const balanceError = balanceQuery.error instanceof Error ? balanceQuery.error.message : null;
  const credentialsRejected = !!balanceError && isAuthFailure(balanceError);

  // A rejected login gets its own screen ("I can't sign in to Bonzah") with
  // the fix as its one button, so nothing needs to open on its own here.

  /* ── policies stranded by an empty wallet ──────────────────────────────── */

  const stuckQuery = useQuery({
    queryKey: ["bonzah-panel-stuck", tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select("id, rental_id, premium_amount, status")
        .eq("tenant_id", tenant.id) // ← isolation
        .eq("status", "insufficient_balance");
      if (error) throw error;
      return (data ?? []) as { id: string; rental_id: string; premium_amount: number; status: string }[];
    },
    enabled: canReadOwnBalance,
    staleTime: 30_000,
  });
  const stuck = stuckQuery.data ?? [];
  const stuckTotal = useMemo(
    () => stuck.reduce((sum, p) => sum + (Number(p.premium_amount) || 0), 0),
    [stuck],
  );
  const { retryAll, progress: retryProgress } = useBonzahRetryAll();

  /* ── low-balance alert ─────────────────────────────────────────────────── */

  const { config: alertConfig, updateConfig } = useBonzahAlertConfig();
  // The alert editor is its own screen; "open" just means being on it.
  const alertOpen = view === "alert";
  const setAlertOpen = (open: boolean) => setView(open ? "alert" : "home");
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("");

  useEffect(() => {
    if (!alertOpen) return;
    setAlertEnabled(alertConfig?.enabled ?? false);
    setAlertThreshold(alertConfig?.threshold != null ? String(alertConfig.threshold) : "");
  }, [alertOpen, alertConfig]);

  const saveAlert = async () => {
    const threshold = Number.parseFloat(alertThreshold);
    if (alertEnabled && (!Number.isFinite(threshold) || threshold <= 0)) {
      toast({
        title: "Enter an amount",
        description: "The threshold has to be a dollar figure above zero.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateConfig.mutateAsync({
        enabled: alertEnabled,
        threshold: alertEnabled ? threshold : alertConfig?.threshold ?? 0,
      });
      toast({
        title: alertEnabled ? "Alert saved" : "Alerts turned off",
        description: alertEnabled
          ? `We will tell you when the balance falls below ${usd(threshold)}.`
          : "You will no longer be warned about a low balance.",
      });
      setAlertOpen(false);
    } catch (err: unknown) {
      // `reminder_config` carries a UNIQUE index on `config_key` ALONE, with no
      // tenant in it, and one tenant already holds the `bonzah_low_balance`
      // row — so the second operator on the platform to set a threshold gets a
      // 23505 rather than a saved setting. Reported to the lead; naming it
      // here beats "Failed to save", which would send someone hunting through
      // their own input for a fault that is not there.
      const message = (err as { code?: string; message?: string })?.code === "23505"
        ? "Low-balance alerts can't be saved for this account yet — the platform stores one alert setting globally rather than one per operator. Your balance is still shown here, and we have flagged this."
        : (err as { message?: string })?.message || "Could not save the alert.";
      toast({ title: "Alert not saved", description: message, variant: "destructive" });
    }
  };

  /* ── credentials ───────────────────────────────────────────────────────── */

  const saveCredentials = async () => {
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();
    if (!cleanUsername || !cleanPassword) return;

    setBusy("credentials");
    try {
      // Check before we store. `bonzah-verify-credentials` answers HTTP 200
      // with `{ valid: false }` when Bonzah rejects a login, so the verdict is
      // in `data.valid` and NOT in `error` — reading `error` alone would store
      // a dead password and report success.
      const { data, error } = await supabase.functions.invoke("bonzah-verify-credentials", {
        body: { username: cleanUsername, password: cleanPassword, tenantId: tenant.id },
      });
      if (error) {
        throw new Error(await extractFunctionError(error, "Could not reach Bonzah to check this login."));
      }
      if (!data?.valid) {
        toast({
          title: "Bonzah rejected this login",
          description:
            data?.error || "Check the email and password on your Bonzah account and try again.",
          variant: "destructive",
        });
        return;
      }

      // `platform: true` means the function short-circuited: the account is not
      // live yet, so it compared nothing against Bonzah and returned valid by
      // default. Saying "Verified" on the back of that is exactly the kind of
      // green tick this panel exists to avoid.
      const actuallyChecked = data?.platform !== true;

      const update: Record<string, unknown> = {
        bonzah_username: cleanUsername,
        bonzah_password: cleanPassword,
      };
      // Only a FIRST connect turns selling on. Re-entering a password to repair
      // a stale login must not quietly undo an operator who paused selling on
      // purpose.
      if (!hasCredentials) update.integration_bonzah = true;

      const { error: writeError } = await supabase
        .from("tenants")
        .update(update)
        .eq("id", tenant.id); // ← isolation
      if (writeError) throw writeError;

      setPassword("");
      setView("home");
      await invalidate();
      // Only re-test when the account is actually live on its own credentials.
      // On a not-yet-activated account the balance call would resolve to the
      // platform's shared login and fire the low-balance reminder/email path
      // against a wallet that is not this operator's.
      if (activated) await balanceQuery.refetch();

      toast({
        title: actuallyChecked ? "Bonzah login verified" : "Login saved",
        description: actuallyChecked
          ? "Bonzah accepted these details and they are now saved."
          : "Saved. Bonzah has not activated this account yet, so there was nothing to check these details against — we will as soon as it goes live.",
      });
    } catch (err: unknown) {
      toast({
        title: "Could not save",
        description: (err as { message?: string })?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /* ── selling on/off ────────────────────────────────────────────────────── */

  const setSelling = async (next: boolean) => {
    setBusy("selling");
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ integration_bonzah: next })
        .eq("id", tenant.id); // ← isolation
      if (error) throw error;
      await invalidate();
      toast({
        title: next ? "Insurance is on" : "Insurance is off",
        description: next
          ? "Customers are offered Bonzah cover at checkout."
          : "Customers will no longer be offered cover. Policies already issued are unaffected.",
      });
    } catch (err: unknown) {
      toast({
        title: "Could not change this",
        description: (err as { message?: string })?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setConfirmPause(false);
    }
  };

  /* ── disconnect ────────────────────────────────────────────────────────── */

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      // `bonzah_mode` is deliberately NOT reset. It is written by Bonzah's
      // reviewer, and every server-side call resolves credentials from it —
      // dropping it back would silently redirect this tenant's existing
      // policies at the sandbox host, where they do not exist.
      const { error } = await supabase
        .from("tenants")
        .update({
          bonzah_username: null,
          bonzah_password: null,
          integration_bonzah: false,
        })
        .eq("id", tenant.id); // ← isolation
      if (error) throw error;
      setUsername("");
      setPassword("");
      setView("home");
      await invalidate();
      toast({
        title: "Bonzah disconnected",
        description: "The stored login has been removed and insurance is no longer offered.",
      });
    } catch (err: unknown) {
      toast({
        title: "Could not disconnect",
        description: (err as { message?: string })?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setConfirmDisconnect(false);
    }
  };

  /* ── brochure ──────────────────────────────────────────────────────────── */

  const saveBrochure = async () => {
    const url = (brochure ?? "").trim();
    setBusy("brochure");
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ bonzah_brochure_url: url || null })
        .eq("id", tenant.id); // ← isolation
      if (error) throw error;
      await invalidate();
      toast({ title: "Brochure link saved" });
    } catch (err: unknown) {
      toast({
        title: "Could not save the link",
        description: (err as { message?: string })?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  if (rowQuery.isLoading) return <PanelLoading rows={4} />;
  if (rowQuery.isError || !row || !stage) {
    return (
      <PanelError
        message={(rowQuery.error as { message?: string })?.message || "Unknown error"}
        onRetry={() => rowQuery.refetch()}
      />
    );
  }

  // The application, in the dialog. Submitting does not navigate: it refreshes
  // the stage, which lands on "In review" — the submission status — with the
  // dialog still open.
  if (applying) {
    return (
      <BonzahOnboardingV2
        tenantId={tenant.id}
        // The canary walks the wizard unvalidated while it is being built.
        // Keyed on SLUG (V2_PLAN §2); every other tenant validates as normal.
        skipValidation={tenant.slug === NORTHWIND}
        onExit={() => setApplying(false)}
        onSubmitted={async () => {
          setApplying(false);
          await invalidate();
          await submissionQuery.refetch();
        }}
      />
    );
  }

  const decisionNote =
    (submission?.status === "approved" && submission.partner_message) ||
    (submission?.status === "rejected" && submission.reject_reason) ||
    submission?.admin_note ||
    null;
  const decisionTitle = submission?.status === "approved" ? "Message from Bonzah" : "What Bonzah asked for";

  const connectedSince = shortDate(submission?.activated_at ?? row.bonzah_partner_id_set_at);
  const submittedOn = shortDate(submission?.submitted_at);

  // The newest three only — the application screen is one screen, not a log.
  const events = eventsQuery.data ?? [];
  const recentEvents = events.slice(-3).reverse();
  const olderEvents = events.length - recentEvents.length;

  /** A saved login Bonzah will not accept — the failure this integration actually suffers. */
  const loginBroken = hasCredentials && (!row.hasPassword || credentialsRejected);

  const home = () => setView("home");
  const stepEyebrow = `Step ${RAIL_INDEX[stage] + 1} of ${RAIL.length} · ${RAIL[RAIL_INDEX[stage]]}`;

  const applicationLink =
    submission && !hasCredentials ? { label: "View your application", onClick: () => setView("application") } : null;

  // ── LAYOUT (Ghulam, Oct 2 2026) ─────────────────────────────────────────
  // One idea per screen: a picture, a headline, a line or two in Trax's voice,
  // and ONE primary action. Everything else — the application details, the
  // connection, the alert, the brochure — is its own small screen behind a
  // quiet link, with a Back. As many screens as it takes; none of them scroll.
  let screen: ReactNode;
  let screenKey: string = view;

  if (view === "application" && submission) {
    screen = (
      <SubScreen title="Your application" onBack={home}>
        <PanelCard>
          {submission.business_trade_name && (
            <PanelRow label="Applied as">{submission.business_trade_name}</PanelRow>
          )}
          {submission.primary_contact_email && (
            <PanelRow label="Contact">{submission.primary_contact_email}</PanelRow>
          )}
          <PanelRow label="Sent">{submittedOn}</PanelRow>
          {submission.reviewed_at && <PanelRow label="Reviewed">{shortDate(submission.reviewed_at)}</PanelRow>}
        </PanelCard>
        {recentEvents.length > 0 && (
          <PanelCard>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Latest activity
            </p>
            <ol className="mt-2 space-y-1.5">
              {recentEvents.map((ev) => (
                <li key={ev.id} className="flex items-baseline gap-2.5">
                  <span className="size-1.5 shrink-0 -translate-y-px rounded-full bg-primary/60" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={ev.note ?? undefined}>
                    <span className="capitalize">{ev.event_type.replace(/_/g, " ")}</span>
                    {ev.note && <span className="text-muted-foreground"> — {ev.note}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{shortDate(ev.created_at)}</span>
                </li>
              ))}
            </ol>
            {olderEvents > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">+{olderEvents} earlier</p>
            )}
          </PanelCard>
        )}
      </SubScreen>
    );
  } else if (view === "login") {
    screen = (
      <SubScreen
        title={hasCredentials ? "Update your Bonzah login" : "Add your Bonzah login"}
        description={
          hasCredentials
            ? "Use this when Bonzah changes or resets the password on their side. I check it with Bonzah before I save it."
            : "Bonzah sends this when they approve you. I check it with Bonzah before I save it."
        }
        onBack={home}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="bonzah-email" className="text-xs">Bonzah email</Label>
            <Input
              id="bonzah-email"
              type="email"
              autoComplete="off"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="bonzah-password" className="text-xs">Bonzah password</Label>
            {/* Write-only. The stored password is never sent to this screen,
                so the box starts empty even for a connected account. */}
            <Input
              id="bonzah-password"
              type="password"
              autoComplete="new-password"
              placeholder="Current password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="w-full"
          disabled={busy === "credentials" || !username.trim() || !password.trim()}
          onClick={saveCredentials}
        >
          {busy === "credentials" ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1.5 size-4" />
          )}
          Verify and save
        </Button>
        {!hasCredentials && <PartnerFinePrint verb="connecting" />}
      </SubScreen>
    );
  } else if (view === "connection" && hasCredentials) {
    screen = (
      <SubScreen title="Connection" onBack={home}>
        <PanelCard>
          <PanelRow label="Signed in as">
            <CopyValue value={row.bonzah_username!} />
          </PanelRow>
          {/* Bonzah's own id for this operator. Nothing in the portal writes
              it today, so it is rendered only when something has. */}
          {row.bonzah_partner_id && (
            <PanelRow label="Partner ID">
              <CopyValue value={row.bonzah_partner_id} />
            </PanelRow>
          )}
          {connectedSince && <PanelRow label="Active since">{connectedSince}</PanelRow>}
        </PanelCard>

        <div className="flex gap-2">
          {canReadOwnBalance && (
            <Button
              variant="outline"
              className="flex-1"
              disabled={balanceQuery.isFetching}
              onClick={() => balanceQuery.refetch()}
            >
              {balanceQuery.isFetching ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-4" />
              )}
              Test connection
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => setView("login")}>
            Update the login
          </Button>
        </div>

        {canReadOwnBalance && balanceError && !credentialsRejected && (
          <PanelNote tone="warn">
            I could not reach Bonzah just now. Nothing has been changed.
            <span className="mt-1 block truncate font-mono text-[11px] opacity-80" title={balanceError}>
              {balanceError}
            </span>
          </PanelNote>
        )}
        {canReadOwnBalance && !balanceError && balanceQuery.isSuccess && (
          <PanelNote>
            <span className="panel-ink-success inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5" />
              Bonzah accepted the saved login.
            </span>
          </PanelNote>
        )}

        <div className="flex items-center justify-between gap-4 pt-1">
          <PanelLink href={portalUrl}>Bonzah portal</PanelLink>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDisconnect(true)}
          >
            <Unplug className="mr-1.5 size-3.5" />
            Disconnect Bonzah
          </Button>
        </div>
      </SubScreen>
    );
  } else if (view === "alert" && canReadOwnBalance) {
    screen = (
      <SubScreen
        title="Low-balance alert"
        description="I tell you before your Bonzah balance runs out, so cover never stops at checkout."
        onBack={home}
      >
        <PanelCard className="flex items-center justify-between gap-4">
          <Label htmlFor="bonzah-alert" className="text-sm">Warn me when the balance is low</Label>
          <Switch id="bonzah-alert" checked={alertEnabled} onCheckedChange={setAlertEnabled} />
        </PanelCard>
        {alertEnabled && (
          <div className="space-y-1.5">
            <Label htmlFor="bonzah-threshold" className="text-xs">Warn me below ($)</Label>
            <Input
              id="bonzah-threshold"
              type="number"
              min="1"
              step="0.01"
              placeholder="500"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
            />
          </div>
        )}
        <Button className="w-full" disabled={updateConfig.isPending} onClick={saveAlert}>
          {updateConfig.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Save
        </Button>
      </SubScreen>
    );
  } else if (view === "brochure" && hasCredentials) {
    screen = (
      <SubScreen
        title="Coverage brochure"
        description="The PDF your customers see when they choose cover. Leave it blank to show none."
        onBack={home}
      >
        <Input
          type="url"
          placeholder="https://…/bonzah-coverage.pdf"
          value={brochure ?? ""}
          onChange={(e) => setBrochure(e.target.value)}
        />
        {(brochure ?? "").trim() !== (row.bonzah_brochure_url ?? "") ? (
          <Button className="w-full" disabled={busy === "brochure"} onClick={saveBrochure}>
            {busy === "brochure" && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        ) : (
          row.bonzah_brochure_url && (
            <Button variant="outline" className="w-full" asChild>
              <a href={row.bonzah_brochure_url} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1.5 size-4" />
                Open the brochure
              </a>
            </Button>
          )
        )}
      </SubScreen>
    );
  } else if (stage === "not_started") {
    // The introduction: four screens, one idea each, and the only button that
    // matters at the end.
    const slide = INTRO[introStep];
    const last = introStep === INTRO.length - 1;
    screenKey = `intro-${introStep}`;
    screen = (
      <>
      <Hero
        art={slide.Art}
        title={slide.title}
        actions={
          last && (
            // Two rectangular choices side by side: the accent one starts the
            // application, the light-accent one is for an operator Bonzah has
            // already given a login.
            <div className="grid grid-cols-2 gap-3">
              <Button className="h-11 rounded-2xl" onClick={() => setApplying(true)}>
                Start the application
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
              <Button
                variant="ghost"
                className="h-11 rounded-2xl bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                onClick={() => setView("login")}
              >
                I already have a login
              </Button>
            </div>
          )
        }
        footer={
          last && (
            <PartnerFinePrint verb="applying" />
          )
        }
      >
        {slide.body}
      </Hero>
      {/* Back bottom-left, Next bottom-right — where each step is expected.
          The first screen has no Back; the last has no Next (its two
          buttons are the way on). An empty span holds each corner. */}
      <div className="mt-8 flex items-center justify-between">
        {introStep > 0 ? (
          <Button variant="outline" onClick={() => setIntroStep(introStep - 1)}>
            <ArrowLeft className="mr-1.5 size-4" />
            Back
          </Button>
        ) : (
          <span />
        )}
        {!last ? (
          <Button variant="outline" onClick={() => setIntroStep(introStep + 1)}>
            Next
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>
      </>
    );
  } else if (loginBroken) {
    screenKey = "broken";
    screen = (
      <Hero
        art={BonzahLoginArt}
        eyebrow="Needs your attention"
        title="I can't sign in to Bonzah."
        actions={
          <Button className="w-full" onClick={() => setView("login")}>
            Enter the current password
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        }
        footer={<QuietNav items={[{ label: "Connection", onClick: () => setView("connection") }]} />}
      >
        {!row.hasPassword
          ? "There is a Bonzah email on file but no password, so every request I send to Bonzah fails. Until you add it, customers aren't offered cover and no policy can be issued."
          : "Bonzah turned down the saved login. This almost always means the password was changed or reset on Bonzah's side, not here. Until it's updated, customers aren't offered cover and no policy can be issued."}
      </Hero>
    );
  } else if (stage === "in_review") {
    screenKey = "in_review";
    screen = (
      <Hero
        art={BonzahReviewArt}
        eyebrow={stepEyebrow}
        title="Bonzah is reviewing your application."
        actions={
          <Button
            variant="outline"
            className="w-full"
            disabled={submissionQuery.isFetching || eventsQuery.isFetching}
            onClick={() => {
              void submissionQuery.refetch();
              void eventsQuery.refetch();
            }}
          >
            {submissionQuery.isFetching || eventsQuery.isFetching ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 size-4" />
            )}
            Check for an update
          </Button>
        }
        footer={applicationLink && <QuietNav items={[applicationLink]} />}
      >
        {submittedOn
          ? `You sent it on ${submittedOn}, and it is with Bonzah's team now. When they approve it, they set your account up from their side and email you a login. There is nothing for you to do in the meantime — I'll show you here the moment anything changes.`
          : "It is with Bonzah's team now. When they approve it, they set your account up from their side and email you a login. There is nothing for you to do in the meantime — I'll show you here the moment anything changes."}
      </Hero>
    );
  } else if (stage === "changes_requested") {
    screenKey = "changes_requested";
    screen = (
      <Hero
        art={BonzahReturnedArt}
        eyebrow={stepEyebrow}
        title="Bonzah asked for a few changes."
        actions={
          <Button className="w-full" onClick={() => setApplying(true)}>
            Update and resubmit
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        }
        footer={applicationLink && <QuietNav items={[applicationLink]} />}
      >
        {decisionNote ? (
          <DecisionQuote text={decisionNote} onReadAll={() => setShowFullDecision(true)} />
        ) : (
          "Bonzah sent your application back with a few questions. Open it, update the details they asked about and send it again. Everything else you entered is kept, so it only takes a minute."
        )}
      </Hero>
    );
  } else if (stage === "approved_not_activated") {
    screenKey = "approved";
    screen = (
      <Hero
        art={BonzahLoginArt}
        eyebrow={stepEyebrow}
        title="You're approved."
        actions={
          <Button className="w-full" onClick={() => setView("login")}>
            Add my Bonzah login
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        }
        footer={
          <QuietNav
            items={[
              ...(decisionNote ? [{ label: decisionTitle, onClick: () => setShowFullDecision(true) }] : []),
              ...(applicationLink ? [applicationLink] : []),
            ]}
          />
        }
      >
        Bonzah has approved your business and emails you a login for your new account. Add it here and I'll check it with Bonzah and connect everything for you. If the email hasn't arrived, check your spam folder or contact Bonzah to resend it.
      </Hero>
    );
  } else if (stage === "connected_not_activated") {
    screenKey = "connected_not_activated";
    screen = (
      <Hero
        art={BonzahReviewArt}
        eyebrow={stepEyebrow}
        title="Waiting for Bonzah to switch you on."
        footer={
          <QuietNav
            items={[
              { label: "Connection", onClick: () => setView("connection") },
              { label: "Coverage brochure", onClick: () => setView("brochure") },
            ]}
          />
        }
      >
        {leanUi
          ? "Your Bonzah login is saved and working. The last step is on Bonzah's side: they activate the account for live policies. As soon as they do, I start offering cover at checkout — you won't need to come back here."
          : "Your Bonzah login is saved, but the account is still in test mode, so nothing sold would be real cover. Bonzah switches it to live once onboarding is complete, and then I start offering cover at checkout."}
      </Hero>
    );
  } else {
    // live / selling_off — the working account.
    const on = row.integration_bonzah === true;
    screenKey = "home-live";
    screen = (
      <Hero
        art={InsurancesEmptyArt}
        eyebrow={on ? "Live" : "Paused"}
        title={on ? "Cover is on at checkout." : "Cover is paused."}
        actions={
          <div className="space-y-2.5">
            {canReadOwnBalance && (
              <PanelCard className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Bonzah balance</p>
                  <p className="text-lg font-medium leading-tight tabular-nums text-foreground">
                    {balanceQuery.isFetching && balanceNumber == null
                      ? "—"
                      : balanceNumber != null
                        ? usd(balanceNumber)
                        : "Unavailable"}
                  </p>
                </div>
                <PanelLink href={portalUrl}>Top up</PanelLink>
              </PanelCard>
            )}
            <PanelCard className="flex items-center justify-between gap-4">
              <Label htmlFor="bonzah-selling" className="text-sm">Offer cover at checkout</Label>
              <Switch
                id="bonzah-selling"
                checked={on}
                disabled={busy === "selling"}
                onCheckedChange={(next) => {
                  // Turning it off takes insurance out of a live checkout, so
                  // it gets a confirmation. Turning it on is reversible with
                  // the same switch, so it does not.
                  if (!next) setConfirmPause(true);
                  else void setSelling(true);
                }}
              />
            </PanelCard>
            {on && !sellable && (
              <PanelNote tone="warn">
                {leanUi
                  ? "Bonzah hasn't activated this account for live policies yet, so I can't offer or issue cover."
                  : "This account is in test mode, so any policy I issue would be sandbox cover, not real cover."}
              </PanelNote>
            )}
            {/* Policies a customer already paid for that Bonzah would not issue
                because the balance was empty. Retrying after a top-up is what
                turns them into real cover. */}
            {stuck.length > 0 && (
              <PanelNote tone="danger">
                <span className="flex items-center gap-2">
                  <ShieldAlert className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {retryProgress.isRetrying
                      ? `Retrying ${retryProgress.completed + retryProgress.failed} of ${retryProgress.total}…`
                      : `${stuck.length} ${stuck.length === 1 ? "policy is" : "policies are"} waiting on funds — ${usd(stuckTotal)}.`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={retryProgress.isRetrying}
                    onClick={async () => {
                      await retryAll(stuck);
                      await Promise.all([stuckQuery.refetch(), balanceQuery.refetch()]);
                    }}
                  >
                    Retry
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => {
                      onClose();
                      router.push("/rentals?bonzahStatus=ins_pending");
                    }}
                  >
                    Rentals
                  </Button>
                </span>
              </PanelNote>
            )}
          </div>
        }
        footer={
          <QuietNav
            items={[
              { label: "Connection", onClick: () => setView("connection") },
              ...(canReadOwnBalance ? [{ label: "Low-balance alert", onClick: () => setView("alert") }] : []),
              { label: "Coverage brochure", onClick: () => setView("brochure") },
            ]}
          />
        }
      >
        {on
          ? "Customers can add Bonzah cover while they book, and I issue each policy against their booking. Every policy is paid from your Bonzah balance, so keep an eye on it below."
          : "Customers aren't offered cover while they book right now. Policies already issued keep running, and you can switch it back on below at any time."}
      </Hero>
    );
  }

  return (
    <div className="panel-text">
      {/* Each screen fades and lifts in — the Trax motion (V2_PLAN §12). */}
      <div
        key={screenKey}
        className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
      >
        {screen}
      </div>

      {/* Bonzah's full message, one tap away from the clamped quote. */}
      <AlertDialog open={showFullDecision} onOpenChange={setShowFullDecision}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{decisionTitle}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">{decisionNote}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* ── confirmations ─────────────────────────────────────────────────── */}
      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop offering insurance?</AlertDialogTitle>
            <AlertDialogDescription>
              Customers will no longer see cover while they book. Policies already issued keep
              running, and you can turn this back on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it on</AlertDialogCancel>
            <AlertDialogAction onClick={() => void setSelling(false)}>Turn it off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Disconnect Bonzah?
            </AlertDialogTitle>
            {/* Stated in full because v1's version of this dialog says existing
                policies are unaffected, and for a live account that is wrong:
                viewing and downloading a certificate re-authenticates with
                these same stored credentials. */}
            <AlertDialogDescription>
              The stored Bonzah login is deleted and insurance stops being offered. Cover already
              issued stays in force, but certificates for it cannot be viewed or downloaded again
              until a login is entered here. Bonzah has to send you a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={disconnect}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ────────────────────────── local presentation ──────────────────────────── */

type View = "home" | "login" | "application" | "connection" | "alert" | "brochure";

/**
 * The introduction an operator sees before applying — four screens, one idea
 * each, in Trax's voice: what Bonzah is, the application, the review, the money.
 *
 * ⚠️ No settlement claim. v1's explainer said Bonzah sends a monthly invoice;
 * nothing in this repo issues, reads or reconciles one, and `bonzah-get-balance`
 * documents a balance that policies are drawn down against instead. Say only
 * what the code proves. If someone confirms the settlement terms, add them —
 * with the source in the commit.
 */
const INTRO: readonly { Art: ComponentType<{ className?: string }>; title: string; body: string }[] = [
  {
    // What Bonzah is.
    Art: InsurancesEmptyArt,
    title: "Meet Bonzah — rental cover at checkout.",
    body: "Bonzah is per-rental insurance. Once you're set up, I offer it on your booking checkout, so every customer can protect their rental in one tap. The premium is added to the total they pay you, and Bonzah issues the policy against that booking.",
  },
  {
    // The application itself — mirrors the wizard's ten steps (schema.ts STEPS).
    Art: BonzahApplyArt,
    title: "One application, ten short steps.",
    body: "You tell Bonzah about your business, operations, contacts, banking, current insurance, renter policies and a few risk questions. Then a short training, a quick quiz, and you sign and send. Your answers save as you go, so you can stop and come back any time.",
  },
  {
    // Review → login → activation.
    Art: BonzahLoginArt,
    title: "Bonzah reviews it and sets you up.",
    body: "Bonzah's team reviews your application — you can follow its status right here. When they approve it, they create your account and email you a login. You add it here, Bonzah switches the account on for live policies, and I start offering cover.",
  },
  {
    // Money. No settlement claim — see the note above.
    Art: BonzahWalletArt,
    title: "Policies come out of your balance.",
    body: "Each policy is paid from your Bonzah balance, which you top up in the Bonzah portal. Keep it funded and I keep issuing cover. If it runs low, I can warn you before it ever stops a booking.",
  },
];

const RAIL = ["Apply", "Review", "Activate", "Sell"] as const;

/** Which of the four steps a stage sits on. `changes_requested` goes back to one. */
const RAIL_INDEX: Record<Stage, number> = {
  not_started: 0,
  changes_requested: 0,
  in_review: 1,
  approved_not_activated: 2,
  connected_not_activated: 2,
  selling_off: 3,
  live: 3,
};

/**
 * Picture on top, a few words and one action under it — stacked and centred.
 * Never a left/right split inside a dialog (Ghulam, Oct 2 2026): two columns
 * in a modal read as a page squeezed into a box. The art is capped small so
 * the whole stack stays inside the dialog without a scroll (360px wide ≈ 180px tall).
 */
function Hero({
  art: Art,
  eyebrow,
  title,
  children,
  actions,
  footer,
}: {
  art: ComponentType<{ className?: string }>;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  useNarrowDialog();
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 py-1 text-center">
      <Art className="max-w-[360px]" />
      <div className="space-y-2">
        {eyebrow && (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        )}
        <h3 className="text-xl font-medium leading-snug text-foreground [text-wrap:balance]">{title}</h3>
        {/* Balanced lines, a little narrower than the column: no stray last
            word on a line of its own (Ghulam, Oct 2). */}
        {children && (
          <div className="mx-auto max-w-[34rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
            {children}
          </div>
        )}
      </div>
      {actions && <div className="w-full text-left">{actions}</div>}
      {footer && <div className="flex w-full flex-col items-center">{footer}</div>}
    </div>
  );
}

/** A small focused screen behind a quiet link, with its way back. */
function SubScreen({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mx-auto w-full max-w-md space-y-4 py-2">
        <div className="space-y-1">
          <h3 className="text-lg font-medium leading-snug text-foreground">{title}</h3>
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
      {/* The same Back as the intro and the wizard: outline, bottom-left. */}
      <div className="mt-8 flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" />
          Back
        </Button>
        <span />
      </div>
    </div>
  );
}

/** Secondary destinations, as quiet text — never a second button. */
function QuietNav({ items }: { items: { label: string; onClick: () => void }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.onClick}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-foreground hover:underline motion-reduce:transition-none"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The operator is Bonzah's business partner, so these are their contract — not
 * the consumer terms a renter accepts at checkout. They are the pair v1's
 * Settings screen made the operator agree to when connecting.
 */
function PartnerFinePrint({ verb }: { verb: string }) {
  // Quiet on purpose: a small, soft line that is easy to read and easy to
  // skip. Links carry no underline until hovered, so the line does not shout.
  const link =
    "font-medium text-foreground/70 underline-offset-2 transition-colors duration-200 hover:text-foreground hover:underline motion-reduce:transition-none";
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground/80">
      By {verb}, you agree to Bonzah&rsquo;s{" "}
      <a href={BONZAH_LINKS.businessPartnerTerms} target="_blank" rel="noopener noreferrer" className={link}>
        Partner Terms
      </a>{" "}
      and{" "}
      <a href={BONZAH_LINKS.privacyPolicy} target="_blank" rel="noopener noreferrer" className={link}>
        Privacy Policy
      </a>
      .
    </p>
  );
}

/** Bonzah's own words, clamped so a long message can't push the screen into a scroll. */
function DecisionQuote({ text, onReadAll }: { text: string; onReadAll: () => void }) {
  return (
    <div className="space-y-1.5">
      <p className="line-clamp-3 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-foreground">{text}</p>
      {text.length > 160 && (
        <button
          type="button"
          onClick={onReadAll}
          className="text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-200 hover:text-foreground motion-reduce:transition-none"
        >
          Read the full message
        </button>
      )}
    </div>
  );
}
