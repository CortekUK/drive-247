"use client";

// ── Xero ──────────────────────────────────────────────────────────────────────
//
// The lean product's only route to a Xero connection.
//
// `accounting` is in LEAN_HIDDEN_AREAS, so Settings → Accounting does not render
// for a lean tenant — and this card does. That is not a contradiction to be
// resolved by un-hiding the tab: the lean product surfaces accounting through
// Integrations instead of Settings, and this panel is the replacement for that
// tab, not a second copy of it. Consequently there is NOWHERE to "see the full
// screen": every link out of this panel would land on a tab the canary cannot
// open, so the panel says what it knows and stops, rather than pointing at a
// page that will not be there.
//
// WHAT THIS FEATURE ACTUALLY IS, in production, today: `integration_xero` is
// true for 0 of 57 tenants, and all three rows of `accounting_connections`
// belong to the internal `test` tenant. Nobody has ever run this live. The v1
// code below it is therefore unproven, not battle-tested, and this panel is
// written to say only what it can read — no capability is claimed on the
// strength of the v1 code appearing to implement it.
//
// ⚠️ Every query lives in `xero-data.ts` and every one carries
// `.eq("tenant_id", tenant.id)`. See the isolation note at the top of that file
// for why RLS being ON here does not make that optional.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui-v2/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-v2/select";
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
import { useAuth } from "@/stores/auth-store";
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
} from "./_kit";
import {
  deriveXeroVerdict,
  useConnectXero,
  useDisconnectXero,
  useRetryFailedXeroSync,
  useSaveXeroPaymentAccount,
  useXeroAccounts,
  useXeroOAuthReturn,
  useXeroStatus,
  useXeroSyncHealth,
  XERO_MAPPED_EVENT_TYPES,
  type XeroAccount,
  type XeroConnectionRow,
  type XeroSyncRow,
  type XeroVerdict,
} from "./xero-data";

/* ─────────────────────────────── helpers ────────────────────────────────── */

const fmtDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d MMM yyyy") : "—";

const fmtAgo = (iso: string | null | undefined) =>
  iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";

/** "expires in 24 minutes" / "expired 3 hours ago" — the tense carries the fault. */
function tokenPhrase(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry recorded";
  const ms = new Date(expiresAt).getTime() - Date.now();
  const rel = formatDistanceToNow(new Date(expiresAt), { addSuffix: true });
  return ms > 0 ? `Expires ${rel}` : `Expired ${rel}`;
}

/**
 * Bank accounts first: `recordPayment` posts against a Xero bank account, so
 * that is what an operator is looking for in a list that also contains every
 * revenue and liability code in their chart.
 */
function orderAccounts(accounts: XeroAccount[]): XeroAccount[] {
  return [...accounts].sort((a, b) => {
    const aBank = a.type === "BANK" ? 0 : 1;
    const bBank = b.type === "BANK" ? 0 : 1;
    if (aBank !== bBank) return aBank - bBank;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
}

/* ──────────────────────────────── chip ──────────────────────────────────── */

/**
 * The board card's status pill.
 *
 * Also the host for the OAuth return handler: the operator comes back from Xero
 * to the board with the dialog CLOSED, so the panel is not mounted to notice it.
 * The chip is (it paints on every card), and the board file belongs to someone
 * else. See `useXeroOAuthReturn`.
 */
export function XeroStatus({ tenant }: { tenant: PanelTenant }) {
  useXeroOAuthReturn(tenant);
  const { data, isLoading, isError } = useXeroStatus(tenant);

  if (isLoading) return <StatusChip state="loading" />;
  // A read that failed is NOT "not connected". Saying so would invite a
  // reconnect, and reconnecting rotates the credentials of a connection that
  // may be perfectly healthy.
  if (isError) return <StatusChip state="attention" label="Status unavailable" />;

  const verdict = deriveXeroVerdict(data);
  return <StatusChip state={verdict.state} label={verdict.label} />;
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

export default function XeroPanel({ tenant, onClose }: IntegrationPanelProps) {
  const status = useXeroStatus(tenant);
  const { appUser } = useAuth();

  // The four edge functions this panel calls all reject anything below admin.
  // Showing a viewer a live Connect button that can only 403 is worse than
  // showing it disabled with the reason. Super admins arrive here as
  // `head_admin` — the auth store rewrites the role on load — so this one check
  // covers them too.
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  const verdict = deriveXeroVerdict(status.data);
  const connection = status.data?.connection ?? null;
  const usable = connection?.status === "active" && !verdict.tokenExpired;

  const live = !!connection && connection.status !== "revoked";
  const health = useXeroSyncHealth(tenant, live);
  const accounts = useXeroAccounts(tenant, usable);

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5 py-1">
      {!live ? (
        <NotConnected
          tenant={tenant}
          canManage={canManage}
          disconnectedAt={connection?.disconnected_at ?? null}
        />
      ) : (
        <>
          <Connection
            tenant={tenant}
            canManage={canManage}
            connection={connection}
            verdict={verdict}
          />

          <Mappings
            tenant={tenant}
            canManage={canManage}
            usable={usable}
            accounts={accounts}
            paymentAccount={verdict.paymentAccount}
            missingEventTypes={verdict.missingEventTypes}
          />

          <SyncHealth tenant={tenant} canManage={canManage} health={health} />

          <Disconnect tenant={tenant} canManage={canManage} onClose={onClose} />
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── not connected ────────────────────────────── */

function NotConnected({
  tenant,
  canManage,
  disconnectedAt,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  disconnectedAt: string | null;
}) {
  const connect = useConnectXero(tenant);

  return (
    <PanelSection
      title="Connect Xero"
      description="Send every rental charge, payment and refund to your Xero ledger as it happens."
    >
      {disconnectedAt && (
        <PanelNote>
          You disconnected Xero on {fmtDate(disconnectedAt)}. Invoices already in Xero were left
          exactly as they were, and reconnecting picks up from where it stopped.
        </PanelNote>
      )}

      <PanelCard className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>
          Connecting sends you to Xero to authorise Drive247 against one organisation, then brings
          you back here. Drive247 never sees your Xero password — the credentials it receives are
          held encrypted and can be revoked from Xero at any time.
        </p>
        <p>
          Once connected, you also need to choose the Xero bank account customer payments are
          recorded against — invoices sync without it, payments do not. You do that on this screen.
        </p>
      </PanelCard>

      {!canManage ? (
        <PanelNote tone="warn">
          Only an admin or head admin can connect an accounting system. Ask one of them to open this
          card.
        </PanelNote>
      ) : (
        <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending ? <Loader2 className="animate-spin" /> : null}
          Continue to Xero
        </Button>
      )}
    </PanelSection>
  );
}

/* ─────────────────────────────── connection ─────────────────────────────── */

function Connection({
  tenant,
  canManage,
  connection,
  verdict,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  connection: XeroConnectionRow;
  verdict: XeroVerdict;
}) {
  const connect = useConnectXero(tenant);

  // A fault in the CREDENTIALS, as opposed to a fault in the configuration.
  // Only these two are answered by re-running OAuth; a missing mapping or a
  // stalled queue is not, and offering a reconnect for those would rotate a
  // working connection's credentials to fix something else entirely.
  const needsReconnect = verdict.tokenExpired || connection.status === "error";

  return (
    <PanelSection
      title="Connection"
      action={
        <PanelLink href="https://go.xero.com/">
          Open Xero
        </PanelLink>
      }
    >
      {needsReconnect && (
        <PanelNote tone="warn">
          {verdict.detail ?? "This Xero connection is not currently usable."}
        </PanelNote>
      )}

      <PanelCard>
        <PanelRow label="Organisation">
          {connection.external_org_name ?? <span className="text-muted-foreground">Unnamed</span>}
        </PanelRow>
        <PanelRow label="Xero organisation ID" mono>
          <CopyValue value={connection.external_org_id} />
        </PanelRow>
        <PanelRow label="Connected">{fmtDate(connection.connected_at)}</PanelRow>
        {/* The hint deliberately does NOT promise a renewal. Renewal is a
            server-side job this screen cannot see, and an expiry sitting in the
            past is the operator's evidence that it did not happen. */}
        <PanelRow
          label="Access token"
          hint="Xero issues short-lived tokens and renews them behind the scenes. An expiry already in the past means the renewal did not happen."
        >
          <span className={verdict.tokenExpired ? "text-warning" : undefined}>
            {tokenPhrase(connection.token_expires_at)}
          </span>
        </PanelRow>
      </PanelCard>

      {connection.last_error && (
        <PanelNote tone="warn">
          Last error from Xero:
          <span className="mt-1 block font-mono text-[11px] opacity-80">{connection.last_error}</span>
        </PanelNote>
      )}

      {needsReconnect &&
        (canManage ? (
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? <Loader2 className="animate-spin" /> : null}
            Reconnect Xero
          </Button>
        ) : (
          <PanelNote tone="warn">
            Only an admin or head admin can reconnect an accounting system.
          </PanelNote>
        ))}
    </PanelSection>
  );
}

/* ──────────────────────────────── mappings ──────────────────────────────── */

function Mappings({
  tenant,
  canManage,
  usable,
  accounts,
  paymentAccount,
  missingEventTypes,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  usable: boolean;
  accounts: ReturnType<typeof useXeroAccounts>;
  paymentAccount: { code: string; name: string | null } | null;
  missingEventTypes: ReadonlyArray<{ key: string; label: string }>;
}) {
  const save = useSaveXeroPaymentAccount(tenant);
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const options = useMemo(() => orderAccounts(accounts.data ?? []), [accounts.data]);
  const mappedCount = XERO_MAPPED_EVENT_TYPES.length - missingEventTypes.length;
  const showPicker = editing || !paymentAccount;

  return (
    <PanelSection
      title="Books mapping"
      description="Which Xero accounts Drive247 posts into."
      action={
        usable ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void accounts.refetch()}
            disabled={accounts.isFetching}
            title="Re-read the chart of accounts from Xero"
          >
            {accounts.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Recheck
          </Button>
        ) : undefined
      }
    >
      {/* Reading the chart of accounts IS the connection test — it authenticates
          with the stored token against Xero's own API — so its outcome is
          reported as the verdict on the credentials, not as a dropdown that
          failed to load. */}
      {!usable ? (
        <PanelNote tone="warn">
          Xero cannot be reached with the current credentials, so the chart of accounts could not be
          read. Reconnect first — the mapping below is unchanged in the meantime.
        </PanelNote>
      ) : accounts.isError ? (
        <PanelNote tone="warn">
          Xero rejected the request for your chart of accounts.
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {accounts.error instanceof Error ? accounts.error.message : "Unknown error"}
          </span>
        </PanelNote>
      ) : accounts.isPending || accounts.isFetching ? (
        <p className="text-xs text-muted-foreground">Checking Xero…</p>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="size-3.5" />
          Xero answered — {options.length} account{options.length === 1 ? "" : "s"} in your chart.
        </p>
      )}

      <PanelCard>
        <PanelRow
          label="Payment account"
          hint="The bank or clearing account customer payments are recorded against."
        >
          {paymentAccount ? (
            <span>
              {paymentAccount.name ?? (
                <span className="font-mono text-[13px]">{paymentAccount.code}</span>
              )}
              {paymentAccount.name && (
                <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">
                  {paymentAccount.code}
                </span>
              )}
            </span>
          ) : (
            <span className="text-warning">Not set</span>
          )}
        </PanelRow>
        <PanelRow label="Charge types mapped" hint={
          missingEventTypes.length > 0
            ? `Unmapped: ${missingEventTypes.map((e) => e.label).join(", ")}`
            : undefined
        }>
          <span className={missingEventTypes.length > 0 ? "text-warning" : undefined}>
            {mappedCount} of {XERO_MAPPED_EVENT_TYPES.length}
          </span>
        </PanelRow>
      </PanelCard>

      {/* The nine per-charge-type mappings are seeded automatically when the
          connection is made (`seed_default_accounting_mappings`), which is why
          they are shown as a count and not as nine dropdowns in a 32rem dialog.
          The payment account is NOT seeded — the seed has no sensible default
          for someone else's bank account — so it is the one that is editable
          here, and without it every `payment_receipt` fails with
          NO_PAYMENT_ACCOUNT. That is the whole reason this control exists. */}
      {!paymentAccount && (
        <PanelNote tone="warn">
          Until a payment account is set, invoices will sync but customer payments will not — each
          one fails as <span className="font-mono text-[11px]">NO_PAYMENT_ACCOUNT</span> and has to
          be re-queued afterwards.
        </PanelNote>
      )}

      {/* Reconnecting is a real remedy here, not a shrug: the OAuth callback
          calls `seed_default_accounting_mappings`, which inserts only the rows
          that are missing and leaves the ones you have chosen alone. */}
      {missingEventTypes.length > 0 && (
        <PanelNote tone="warn">
          {missingEventTypes.length} charge type{missingEventTypes.length === 1 ? " has" : "s have"}{" "}
          no Xero account, so charges of those kinds fail permanently rather than retrying.
          Reconnecting fills the missing ones back in with Drive247&rsquo;s defaults and leaves the
          accounts you have already chosen alone.
        </PanelNote>
      )}

      {canManage && usable && showPicker && (
        <div className="flex items-center gap-2">
          <Select value={draft} onValueChange={setDraft} disabled={options.length === 0}>
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue
                placeholder={
                  options.length === 0 ? "No accounts with a code" : "Choose a Xero account"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((a) => (
                <SelectItem key={a.code} value={a.code} className="text-xs">
                  <span className="font-mono">{a.code}</span> · {a.name}
                  {a.type === "BANK" && <span className="ml-1 text-muted-foreground">(bank)</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!draft || save.isPending}
            onClick={() => {
              const chosen = options.find((a) => a.code === draft);
              if (!chosen) return;
              save.mutate(chosen, { onSuccess: () => setEditing(false) });
            }}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          {editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {canManage && usable && paymentAccount && !editing && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(paymentAccount.code);
            setEditing(true);
          }}
        >
          Change payment account
        </Button>
      )}

      {/* Xero bank accounts are not required to carry an account code, and
          `recordPayment` posts against `Account.Code`. One with no code cannot
          be used, so it is filtered out rather than offered and then rejected. */}
      {usable && !accounts.isError && !accounts.isFetching && options.length === 0 && (
        <PanelNote tone="warn">
          None of the accounts in this Xero organisation has an account code, and payments are
          posted by code. Give your bank account a code in Xero, then press Recheck.
        </PanelNote>
      )}
    </PanelSection>
  );
}

/* ─────────────────────────────── sync health ────────────────────────────── */

function SyncHealth({
  tenant,
  canManage,
  health,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  health: ReturnType<typeof useXeroSyncHealth>;
}) {
  const retry = useRetryFailedXeroSync(tenant);

  if (health.isLoading) return <PanelLoading rows={2} />;
  if (health.isError) {
    return (
      <PanelSection title="Sync">
        <PanelError
          message={health.error instanceof Error ? health.error.message : "Unknown error"}
          onRetry={() => void health.refetch()}
        />
      </PanelSection>
    );
  }

  const h = health.data;
  if (!h) return null;

  const failures = h.recent.filter((r) => r.state === "failed");

  return (
    <PanelSection title="Sync" description="Financial events queued for Xero.">
      {h.total === 0 ? (
        <PanelNote>
          Nothing has been queued for Xero yet. Events are recorded as rentals are charged, paid and
          refunded — this fills up on its own once the fleet is trading.
        </PanelNote>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Synced" value={h.synced} />
            <Tile label="Queued" value={h.queued} />
            <Tile label="Failed" value={h.failed} tone={h.failed > 0 ? "warn" : undefined} />
            <Tile label="Skipped" value={h.skipped} />
          </div>

          <PanelCard>
            <PanelRow label="Last sync attempt">{fmtAgo(h.lastAttemptAt)}</PanelRow>
          </PanelCard>

          {/* Nothing on this screen runs the sync — `process-accounting-sync` is
              driven from the server. Queued work that has never been attempted
              is the only evidence the portal has that the worker is not draining
              this queue, and saying nothing would leave the operator waiting on
              a run that is not coming. */}
          {h.queueStalled && (
            <PanelNote tone="warn">
              {h.queued} event{h.queued === 1 ? " is" : "s are"} queued and none has been attempted
              yet. Drive247 sends these from a background worker rather than from this screen — if
              this does not clear, the queue is not being processed and it needs looking at on the
              platform side.
            </PanelNote>
          )}

          {failures.length > 0 && (
            <div className="space-y-1.5">
              {failures.slice(0, 3).map((row) => (
                <Failure key={row.id} row={row} />
              ))}
            </div>
          )}

          {canManage && h.failed > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
              // Deliberately says "this tenant", not "Xero": the bulk path of
              // `retry-accounting-sync` filters on tenant + state and not on
              // provider, so a tenant also running Zoho has those re-queued too.
              title="Re-queues every failed accounting event for this tenant"
            >
              {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Re-queue {h.failed} failed event{h.failed === 1 ? "" : "s"}
            </Button>
          )}
        </>
      )}
    </PanelSection>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border bg-muted/20 px-2.5 py-2 text-center">
      <div className={`text-lg font-medium leading-tight ${tone === "warn" ? "text-warning" : ""}`}>
        {value}
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Failure({ row }: { row: XeroSyncRow }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs leading-relaxed text-foreground">
            {row.last_error ?? "Failed with no error recorded."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {row.last_error_code ? `${row.last_error_code} · ` : ""}
            {row.attempts} attempt{row.attempts === 1 ? "" : "s"} · {fmtAgo(row.updated_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── disconnect ─────────────────────────────── */

function Disconnect({
  tenant,
  canManage,
  onClose,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  onClose: () => void;
}) {
  const disconnect = useDisconnectXero(tenant);
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <div className="border-t pt-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disconnect.isPending}
        >
          {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unplug />}
          Disconnect Xero
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Xero?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Drive247 will stop sending anything to Xero. The invoices, payments and credit
                  notes already in your Xero organisation are not touched, and the stored
                  credentials are deleted — reconnecting means authorising again.
                </p>
                {/* The distinction operators get wrong. Disconnecting is not a
                    pause on the ledger: `financial_events` is written by a
                    trigger on `ledger_entries` and by nine server-side callers,
                    none of which can see this switch. The backlog keeps growing
                    while disconnected, and reconnecting re-enqueues it. */}
                <p>
                  Your Drive247 records keep accruing either way — charges, payments and refunds are
                  still recorded here while Xero is disconnected, and they are queued up again if
                  you reconnect later.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // `mutate` with callbacks rather than `await mutateAsync`:
                // AlertDialogAction dismisses the confirmation on click either
                // way, so awaiting inside the handler only delays the result.
                //
                // Closing the PANEL is deferred to success on purpose. Closing
                // it unconditionally would drop an operator whose disconnect
                // just failed back onto a board card that still reads
                // "Connected", with the error toast the only trace — on success
                // that same card flipping to "Not connected" in front of them
                // is the confirmation.
                disconnect.mutate(undefined, { onSuccess: () => onClose() });
                setOpen(false);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
