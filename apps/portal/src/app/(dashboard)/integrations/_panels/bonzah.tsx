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

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unplug,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { extractFunctionError } from "@/lib/edge-error";
import { isBonzahSellable } from "@/lib/bonzah";
import { BONZAH_LINKS } from "@/lib/bonzah-compliance";
import { isTestModeUiHidden } from "@/lib/lean-areas";
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
  PanelSection,
  StatusChip,
  type IntegrationState,
} from "./_kit";
import BonzahOnboardingV2 from "./bonzah-onboarding-v2";

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
  const leanUi = isTestModeUiHidden(tenant.slug);

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
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [brochure, setBrochure] = useState<string | null>(null);

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

  // A rejected login is repaired by re-entering it, so open the form rather
  // than making the operator find it under a disclosure.
  useEffect(() => {
    if (credentialsRejected) setShowCredentialForm(true);
  }, [credentialsRejected]);

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
  const [alertOpen, setAlertOpen] = useState(false);
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
      setShowCredentialForm(false);
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

  const connectedSince = shortDate(submission?.activated_at ?? row.bonzah_partner_id_set_at);

  // The credential form is the exception, not the route in. Bonzah's reviewer
  // normally writes these columns during approval, so an operator who has not
  // been approved yet has nothing to type — showing them a login box next to
  // "apply" invites them to hunt for credentials that do not exist. It opens on
  // its own only where it IS the next step: an approval that never landed
  // credentials, or a login Bonzah has since rejected.
  const credentialFormOpen =
    showCredentialForm ||
    (!hasCredentials && stage === "approved_not_activated") ||
    // An email with no password is a half-written account that fails every
    // call; the form is the only fix, so it is not hidden behind a disclosure.
    (hasCredentials && !row.hasPassword);

  return (
    <div className="space-y-6">
      {/* ── where the operator is ─────────────────────────────────────────── */}
      <PanelSection>
        <StageRail stage={stage} />
        <PanelNote tone={STAGE_CHIP[stage].state === "attention" ? "warn" : "info"}>
          {stageCopy(stage, { leanUi, submittedOn: shortDate(submission?.submitted_at) })}
        </PanelNote>

        {submissionQuery.isError && !hasCredentials && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Your application&rsquo;s status could not be read just now, so this may be out of date.
            Nothing has been changed.
          </p>
        )}

        {/* Bonzah's own words to this operator, on either decision. Dropped
            once the account is working: an approval message is guidance about
            getting connected, and it turns into noise the moment they are. */}
        {decisionNote && submission?.status !== "pending" && stage !== "live" && stage !== "selling_off" && (
          <PanelCard>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {submission?.status === "approved" ? "Message from Bonzah" : "What to update"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{decisionNote}</p>
          </PanelCard>
        )}

        {stage === "not_started" && (
          <Button className="w-full" onClick={() => setApplying(true)}>
            Start the Bonzah application
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        )}

        {stage === "changes_requested" && (
          <Button className="w-full" onClick={() => setApplying(true)}>
            Update and resubmit
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        )}

        {/* The application itself — what was sent, and what has happened to it
            since. This is v1's `submission-status.tsx` reproduced where the
            operator now lives: Settings' insurance tab is being hidden from the
            canary, and `reviewed_at` and the event trail exist nowhere else.
            Dropped once credentials arrive, when the application stops
            describing anything the operator can act on. */}
        {submission && !hasCredentials && (
          <div className="space-y-2">
            <PanelCard>
              {submission.business_trade_name && (
                <PanelRow label="Applied as">{submission.business_trade_name}</PanelRow>
              )}
              {submission.primary_contact_email && (
                <PanelRow label="Contact">{submission.primary_contact_email}</PanelRow>
              )}
              <PanelRow label="Submitted">{shortDate(submission.submitted_at)}</PanelRow>
              {submission.reviewed_at && (
                <PanelRow label="Reviewed">{shortDate(submission.reviewed_at)}</PanelRow>
              )}
            </PanelCard>

            {eventsQuery.data && eventsQuery.data.length > 0 && (
              <PanelCard>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Activity
                </p>
                <ol className="mt-2 space-y-2.5">
                  {eventsQuery.data.map((ev) => (
                    <li key={ev.id} className="flex gap-2.5">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                      <div className="min-w-0">
                        <p className="text-sm capitalize leading-tight text-foreground">
                          {ev.event_type.replace(/_/g, " ")}
                        </p>
                        {ev.note && (
                          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                            {ev.note}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {shortDate(ev.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </PanelCard>
            )}

            {stage === "in_review" && (
              <Button
                variant="outline"
                size="sm"
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
            )}
          </div>
        )}

        {!hasCredentials && !credentialFormOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0 text-xs text-muted-foreground"
            onClick={() => setShowCredentialForm(true)}
          >
            I already have a Bonzah login
          </Button>
        )}
      </PanelSection>

      {/* ── how it works ──────────────────────────────────────────────────── */}
      {!hasCredentials && <HowItWorks />}

      {/* ── the account ───────────────────────────────────────────────────── */}
      {hasCredentials && (
        <PanelSection title="Bonzah account">
          <PanelCard>
            <PanelRow label="Signed in as">
              <CopyValue value={row.bonzah_username!} />
            </PanelRow>
            {!row.hasPassword && (
              <PanelRow label="Password">
                <span className="panel-ink-danger">Missing</span>
              </PanelRow>
            )}
            {/* Bonzah's own id for this operator. Nothing in the portal writes
                it today, so it is rendered only when something already has. */}
            {row.bonzah_partner_id && (
              <PanelRow label="Partner ID">
                <CopyValue value={row.bonzah_partner_id} />
              </PanelRow>
            )}
            {connectedSince && <PanelRow label="Active since">{connectedSince}</PanelRow>}
          </PanelCard>

          {!row.hasPassword && (
            <PanelNote tone="danger">
              This account has an email on file but no password, so every Bonzah call will fail.
              Enter the password below.
            </PanelNote>
          )}

          {/* The headline control. */}
          {canReadOwnBalance && (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
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

              {credentialsRejected && (
                <PanelNote tone="danger">
                  Bonzah rejected the login saved for this account, so no policy can be issued right
                  now. This almost always means the password was changed or reset on Bonzah&rsquo;s
                  side rather than here. Enter the current Bonzah password below and test again.
                </PanelNote>
              )}

              {balanceError && !credentialsRejected && (
                <PanelNote tone="warn">
                  Bonzah could not be reached. Nothing has been changed.
                  <span className="mt-1 block font-mono text-[11px] opacity-80">{balanceError}</span>
                </PanelNote>
              )}

              {!balanceError && balanceQuery.isSuccess && (
                <PanelNote>
                  <span className="panel-ink-success inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5" />
                    Bonzah accepted the saved login.
                  </span>
                </PanelNote>
              )}
            </div>
          )}

          {!credentialFormOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0 text-xs text-muted-foreground"
              onClick={() => setShowCredentialForm(true)}
            >
              Update the Bonzah login
            </Button>
          )}
        </PanelSection>
      )}

      {/* ── credentials ───────────────────────────────────────────────────── */}
      {credentialFormOpen && (
        <PanelSection
          title={hasCredentials ? "Update the Bonzah login" : "Already have a Bonzah login?"}
          description={
            hasCredentials
              ? "Use this when Bonzah changes or resets the password on their side."
              : "Bonzah normally sets this up for you when they approve your application. Enter it here only if they sent you a login directly."
          }
        >
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <Label htmlFor="bonzah-email" className="text-xs">
                Bonzah email
              </Label>
              <Input
                id="bonzah-email"
                type="email"
                autoComplete="off"
                placeholder="you@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bonzah-password" className="text-xs">
                Bonzah password
              </Label>
              {/* Write-only. The stored password is never sent to this screen,
                  so the box starts empty even for a connected account. */}
              <Input
                id="bonzah-password"
                type="password"
                autoComplete="new-password"
                placeholder="Enter the current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
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
              {showCredentialForm && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowCredentialForm(false);
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </PanelSection>
      )}

      {/* ── selling ───────────────────────────────────────────────────────── */}
      {hasCredentials && (
        <PanelSection title="Offer insurance at checkout">
          <PanelCard className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">
                {row.integration_bonzah === true ? "On" : "Off"}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {row.integration_bonzah === true
                  ? "Customers can add cover while they book."
                  : "Customers are not shown cover."}
              </p>
            </div>
            <Switch
              checked={row.integration_bonzah === true}
              disabled={busy === "selling"}
              onCheckedChange={(next) => {
                // Turning it off takes insurance out of a live checkout, so it
                // gets a confirmation. Turning it on takes effect immediately
                // and is reversible with the same switch, so it does not.
                if (!next) setConfirmPause(true);
                else void setSelling(true);
              }}
            />
          </PanelCard>

          {/* Enabled but still unable to sell — the state a plain "Connected"
              would hide. Mirrors isBonzahSellable() so the screen can never
              offer something the server will refuse. */}
          {row.integration_bonzah === true && !sellable && (
            <PanelNote tone="warn">
              {leanUi
                ? "Bonzah has not activated this account for live policies yet. Until they do, no cover is offered at checkout and no policy can be issued."
                : "This account is in test mode, so any policy issued would be a sandbox policy and not real cover. Bonzah switches the account to live once onboarding is complete."}
            </PanelNote>
          )}
        </PanelSection>
      )}

      {/* ── balance ─────────────────────────────────────────────────────────
          "Bonzah balance", not "Prepaid balance".

          What the code proves is that a spendable balance exists, that Bonzah
          draws policies down against it, and that issuance fails when it runs
          out (`bonzah-get-balance` reads it; `bonzah-confirm-payment` parks a
          policy as `insufficient_balance` when Bonzah's payment call comes back
          on any of insufficient/balance/fund/credit/allocat). It does NOT prove
          HOW the operator settles with Bonzah. v1's Settings copy claims a
          monthly invoice; nothing in this repo issues, reads or reconciles one,
          and `bonzah-get-balance` documents an agency-level wallet instead. The
          two claims are unreconciled, so this says only what is demonstrable and
          makes no settlement claim at all. Do not add one back without a
          source. */}
      {canReadOwnBalance && (
        <PanelSection
          title="Bonzah balance"
          description="Policies are paid from this. When it runs out, Bonzah stops issuing them."
        >
          <PanelCard>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Wallet className="size-4 text-muted-foreground" />
                <span className="text-xl font-medium tabular-nums">
                  {balanceQuery.isFetching && balanceNumber == null
                    ? "—"
                    : balanceNumber != null
                      ? usd(balanceNumber)
                      : "Unavailable"}
                </span>
              </div>
              <PanelLink href={portalUrl}>Top up</PanelLink>
            </div>
          </PanelCard>

          {/* Policies a customer has already paid for that Bonzah would not
              issue because the wallet was empty. Retrying after a top-up is
              what turns them into real cover. */}
          {stuck.length > 0 && (
            <PanelNote tone="danger">
              <span className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  {stuck.length} {stuck.length === 1 ? "policy is" : "policies are"} waiting on
                  funds — {usd(stuckTotal)} needed. Top up, then retry.
                  {retryProgress.isRetrying && (
                    <span className="mt-1 block opacity-80">
                      Retrying {retryProgress.completed + retryProgress.failed} of{" "}
                      {retryProgress.total}…
                    </span>
                  )}
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={retryProgress.isRetrying}
                      onClick={async () => {
                        await retryAll(stuck);
                        await Promise.all([stuckQuery.refetch(), balanceQuery.refetch()]);
                      }}
                    >
                      {retryProgress.isRetrying ? (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 size-3" />
                      )}
                      Retry all
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        onClose();
                        router.push("/rentals?bonzahStatus=ins_pending");
                      }}
                    >
                      View rentals
                    </Button>
                  </span>
                </span>
              </span>
            </PanelNote>
          )}

          {/* Low-balance alert */}
          {!alertOpen ? (
            <PanelCard className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Bell className="size-4 shrink-0 text-muted-foreground" />
                <p className="truncate text-xs text-muted-foreground">
                  {alertConfig?.enabled
                    ? `Warn me below ${usd(alertConfig.threshold)}`
                    : "No low-balance warning set"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setAlertOpen(true)}>
                {alertConfig?.enabled ? "Edit" : "Set"}
              </Button>
            </PanelCard>
          ) : (
            <PanelCard className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="bonzah-alert" className="text-sm">
                  Warn me when the balance is low
                </Label>
                <Switch id="bonzah-alert" checked={alertEnabled} onCheckedChange={setAlertEnabled} />
              </div>
              {alertEnabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="bonzah-threshold" className="text-xs">
                    Warn below ($)
                  </Label>
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
              <div className="flex gap-2">
                <Button size="sm" disabled={updateConfig.isPending} onClick={saveAlert}>
                  {updateConfig.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAlertOpen(false)}>
                  Cancel
                </Button>
              </div>
            </PanelCard>
          )}
        </PanelSection>
      )}

      {/* ── what customers see ────────────────────────────────────────────── */}
      {hasCredentials && (
        <PanelSection
          title="Coverage brochure"
          description="The PDF shown to customers when they pick cover. Leave blank to show none."
        >
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://…/bonzah-coverage.pdf"
              value={brochure ?? ""}
              onChange={(e) => setBrochure(e.target.value)}
            />
            {(brochure ?? "").trim() !== (row.bonzah_brochure_url ?? "") ? (
              <Button size="sm" disabled={busy === "brochure"} onClick={saveBrochure}>
                {busy === "brochure" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Save
              </Button>
            ) : (
              row.bonzah_brochure_url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={row.bonzah_brochure_url} target="_blank" rel="noopener noreferrer">
                    <FileText className="mr-1 size-3.5" />
                    Open
                  </a>
                </Button>
              )
            )}
          </div>
        </PanelSection>
      )}

      {/* ── links + disconnect ────────────────────────────────────────────── */}
      <PanelSection>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <PanelLink href={portalUrl}>Bonzah portal</PanelLink>
          {/* The operator is Bonzah's business partner, so this is their
              contract — not the consumer terms the renter accepts at checkout.
              The Privacy Policy sits beside it because those two are the pair
              v1's Settings screen made the operator agree to when connecting,
              and that screen is no longer reachable for the canary. */}
          <PanelLink href={BONZAH_LINKS.businessPartnerTerms}>Business Partner Terms</PanelLink>
          <PanelLink href={BONZAH_LINKS.privacyPolicy}>Privacy Policy</PanelLink>
        </div>

        {hasCredentials && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDisconnect(true)}
          >
            <Unplug className="mr-1.5 size-3.5" />
            Disconnect Bonzah
          </Button>
        )}
      </PanelSection>

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

/**
 * The six-step explainer, carried over from v1's Settings → Insurance card.
 *
 * That card is going away for the canary along with the tab, and an operator
 * looking at "apply to Bonzah" for the first time has a fair question — what am
 * I signing up to? — that the stage sentence alone does not answer. Shown only
 * while there are no credentials, because after that the panel's own sections
 * describe the live account better than a numbered list can.
 *
 * ⚠️ v1's step 6 read "At the end of each month, Bonzah sends you an invoice
 * for the insurance premiums, which you pay directly to Bonzah." It is NOT
 * reproduced. Nothing in this repo issues, reads or reconciles such an invoice,
 * and `bonzah-get-balance` documents an agency-level wallet that policies are
 * drawn down against instead. Those two descriptions of the same money have not
 * been reconciled with Bonzah, and a confident wrong answer about how an
 * operator gets billed is worse than no answer. If someone confirms the
 * settlement terms, add the sentence here — with the source in the commit.
 */
function HowItWorks() {
  const STEPS: readonly string[] = [
    "Apply here. Bonzah reviews your business — you do not need to find credentials yourself.",
    "If they approve you, Bonzah sets up your account and sends you a login by email.",
    "The login is saved here, and Bonzah switches the account on for live policies.",
    "Customers are then offered cover while they book, and the premium is added to the total they pay you at checkout.",
    "Bonzah issues each policy against your Bonzah balance. If that runs out, cover stops being issued until it is topped up.",
  ];
  return (
    <PanelSection
      title="How Bonzah works"
      description="What happens between applying and selling your first policy."
    >
      <PanelCard>
        <ol className="space-y-2">
          {STEPS.map((text, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px text-xs font-medium tabular-nums text-primary">{i + 1}.</span>
              <span className="min-w-0 text-xs leading-relaxed text-muted-foreground">{text}</span>
            </li>
          ))}
        </ol>
      </PanelCard>
    </PanelSection>
  );
}

const RAIL = ["Apply", "Review", "Activate", "Sell"] as const;

/** Which rail step a stage sits on. `changes_requested` goes back to step one. */
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
 * Where the operator is, in four stages.
 *
 * This replaced four loose `h-1` bars with labels under them. That form read as
 * a progress bar that had been cut into pieces — nothing said the pieces were
 * *stages*, an operator on step two saw one bar filled and three empty and had
 * no way to tell a completed step from a skipped one, and it sat flush against
 * the dialog's top edge with nothing holding it.
 *
 * The shape here is deliberate on three counts:
 *
 *   • Numbered nodes joined by a rail, not detached bars. A tick means done, a
 *     ringed number means "you are here", a plain number means not yet — three
 *     states the eye separates without reading the labels.
 *   • It stays horizontal. Four short words fit across a dialog easily, and a
 *     vertical list would have pushed the sentence that actually tells the
 *     operator what to do below the fold. (The ten-step application wizard is
 *     the case where a horizontal rail genuinely does not fit — which is why
 *     `bonzah-onboarding-v2.tsx` uses a segmented meter instead.)
 *   • The current node turns amber when the stage is one the operator has to
 *     act on. Bonzah's flow spends most of its life waiting on somebody else,
 *     so "you are here" and "this is on you" are different facts and the rail
 *     is the one place that can carry both at a glance. It matches the chip
 *     in the dialog header rather than inventing a second vocabulary.
 */
function StageRail({ stage }: { stage: Stage }) {
  const current = RAIL_INDEX[stage];
  const finished = stage === "live";
  const needsOperator = STAGE_CHIP[stage].state === "attention";

  return (
    <ol
      className="flex items-start rounded-2xl bg-muted/25 px-4 pb-3 pt-3.5 ring-1 ring-border/70"
      aria-label="Bonzah setup"
    >
      {RAIL.map((label, i) => {
        const done = i < current || (finished && i === current);
        const active = i === current && !done;
        return (
          <li
            key={label}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
            aria-current={active ? "step" : undefined}
          >
            {/* The rail between this node and the previous one. Percentages
                resolve against this item's own width and every item is the
                same width, so `-50%` lands exactly on the previous node's
                centre — no absolute track behind the row, and nothing to keep
                in sync when the label lengths change. */}
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[calc(-50%_+_18px)] right-[calc(50%_+_18px)] top-[14px] h-px",
                  i <= current ? "bg-primary/50" : "bg-border",
                )}
              />
            )}

            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition-colors",
                done && "bg-primary text-primary-foreground",
                active && !needsOperator && "bg-primary/10 text-primary ring-2 ring-primary/25",
                active && needsOperator && "panel-ink-warn bg-warning/10 ring-2 ring-warning/30",
                !done && !active && "bg-background text-muted-foreground ring-1 ring-border",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>

            <span
              className={cn(
                "min-w-0 truncate text-[11px] leading-none",
                done || active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One sentence of truth per stage, plus the next thing to do.
 *
 * `leanUi` swaps the wording only, never the meaning: a lean tenant is not
 * shown "test mode" as a concept it can act on, but it is still told plainly
 * that the account is not activated and that nothing can be sold until it is.
 */
function stageCopy(
  stage: Stage,
  { leanUi, submittedOn }: { leanUi: boolean; submittedOn: string | null },
): string {
  switch (stage) {
    case "not_started":
      return "You are not set up with Bonzah yet. Apply once, and Bonzah reviews your business and sets up your account — you do not need to find credentials yourself.";
    case "in_review":
      return submittedOn
        ? `Your application went to Bonzah on ${submittedOn} and is with their team. They will set your account up from their side when they approve it — there is nothing to do here in the meantime.`
        : "Your application is with Bonzah's team. They will set your account up from their side when they approve it.";
    case "changes_requested":
      return "Bonzah sent your application back for changes. Update the details they asked about and submit it again.";
    case "approved_not_activated":
      return "Your application was approved, but this account has not been set up with a Bonzah login yet, so no cover can be sold. If Bonzah sent you a login by email, add it below — otherwise contact them.";
    case "connected_not_activated":
      return leanUi
        ? "A Bonzah login is saved, but Bonzah has not activated this account for live policies yet. No cover is offered at checkout until they do."
        : "A Bonzah login is saved, but this account is still in test mode, so nothing sold would be real cover. Bonzah switches it to live once onboarding is complete.";
    case "selling_off":
      return "Your Bonzah account is working, but insurance is switched off, so customers are not offered cover while they book.";
    case "live":
      return "Bonzah is live. Customers are offered cover at checkout, and policies are paid out of your prepaid balance.";
  }
}
