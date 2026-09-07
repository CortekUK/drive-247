"use client";

// ── Square panel ─────────────────────────────────────────────────────────────
//
// The sibling of `stripe-connect.tsx`, one card to its right. The two are one
// product: same register, same section order, same refusal to dress a broken
// integration up as a working one.
//
// THREE RAILS, and the panel is honest about all of them:
//
//   payment_provider = 'stripe', unlocked   Square is AVAILABLE. Choosing it is
//                                           a one-time rail decision, so the
//                                           panel says what locks, what it
//                                           means for Stripe, and confirms
//                                           before writing (`ChooseSquare`).
//   payment_provider = 'stripe', locked     Square is not available. Said
//                                           plainly, with a pointer to support.
//   payment_provider = 'square'             The connect / manage flow.
//
// The Stripe panel deliberately does not own the choice; this one does, and it
// writes it the way v1's `payment-provider-choice.tsx` does, column for
// column — see `useChooseSquare` in `square-data.ts`.
//
// TWO BACKGROUND JOBS ARE NOT RUNNING, and the panel is written around that
// rather than pretending otherwise: `refresh-square-tokens` (the 30-day expiry
// defence) stopped on 3 Sep 2026 and `recover-pending-square-payments` was
// never scheduled. So token validity is computed from `token_expires_at`
// against the clock, the healthy state never says "renews automatically", and
// no button here calls a function that only helps when a worker runs. See the
// note above `deriveSquareVerdict`.
//
// LEAN MODE. `isTestModeUiHidden` is true for the canary: no mode row, no TEST
// badge, and `set-square-mode` is never called from here. Presentation only —
// the connect and disconnect calls send the tenant's OWN `square_mode`,
// because hiding a concept must not change what the money does.
//
// ⚠️ Every query lives in `square-data.ts` and every one carries the tenant
// filter. See the isolation note at the top of that file.

import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { useAuth } from "@/stores/auth-store";
import { isTestModeUiHidden } from "@/lib/lean-areas";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
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

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import {
  CopyValue,
  PanelCard,
  PanelError,
  PanelLoading,
  PanelNote,
  PanelRow,
  PanelSection,
  StatusChip,
} from "./_kit";
import {
  deriveSquareVerdict,
  isSquareCountrySupported,
  SQUARE_COUNTRIES,
  SQUARE_LIMITS,
  SQUARE_TOKEN_LIFETIME_DAYS,
  useChooseSquare,
  useConnectSquare,
  useDisconnectSquare,
  useSquareOAuthReturn,
  useSquarePaymentHealth,
  useSquarePaymentsCount,
  useSquareStatus,
  type SquareConnectionRow,
  type SquareMode,
  type SquareSnapshot,
  type SquareVerdict,
} from "./square-data";

/* ─────────────────────────────── helpers ────────────────────────────────── */

const fmtDate = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? format(new Date(iso), "d MMM yyyy") : "—";

const fmtAgo = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime())
    ? formatDistanceToNow(new Date(iso), { addSuffix: true })
    : "—";

/** "Valid until 4 Oct 2026 (29 days)" / "Expired 2 days ago" — the tense carries the fault. */
function tokenPhrase(expiresAt: string | null, days: number | null): string {
  if (!expiresAt || days === null) return "No expiry recorded";
  if (days < 0) return `Expired ${fmtAgo(expiresAt)}`;
  if (days === 0) return `Expires today (${fmtDate(expiresAt)})`;
  return `Valid until ${fmtDate(expiresAt)} (${days} day${days === 1 ? "" : "s"})`;
}

/**
 * The seller dashboard for the environment this connection actually lives in.
 * Sandbox merchants exist only on the sandbox host; sending a test-mode
 * operator to app.squareup.com lands them on a login for an account they do
 * not have. The host is chosen by the connection's mode even where the mode
 * itself is not shown.
 */
const dashboardHref = (mode: SquareMode) =>
  mode === "live" ? "https://app.squareup.com/dashboard/" : "https://app.squareupsandbox.com/dashboard/";

/* ──────────────────────────────── chip ──────────────────────────────────── */

/**
 * The board card's status pill.
 *
 * Also the host for the OAuth return handler: the operator comes back to the
 * board with the dialog CLOSED, so the panel is not mounted to notice it. The
 * chip is (it paints on every card), and the board file belongs to someone
 * else. See `useSquareOAuthReturn`.
 */
export function SquareStatus({ tenant }: { tenant: PanelTenant }) {
  useSquareOAuthReturn(tenant);
  const { data, isLoading, isError } = useSquareStatus(tenant);

  if (isLoading) return <StatusChip state="loading" />;
  // A failed READ is not a disconnected integration. Saying "Not connected"
  // invites a reconnect, and a reconnect here revokes and replaces the
  // credentials of a connection that may be perfectly healthy.
  if (isError || !data) return <StatusChip state="attention" label="Status unavailable" />;

  const verdict = deriveSquareVerdict(data);
  return <StatusChip state={verdict.state} label={verdict.label} />;
}

/* ──────────────────────────────── panel ─────────────────────────────────── */

export default function SquarePanel({ tenant, onClose }: IntegrationPanelProps) {
  const status = useSquareStatus(tenant);
  const { appUser } = useAuth();

  // `square-oauth-start`, `square-disconnect` and the rail write all reject
  // anything below admin (the edge functions' `authorizeCaller` accepts exactly
  // head_admin | admin of THIS tenant, or a super admin — whom the auth store
  // rewrites to head_admin on load). Showing a viewer a live button that can
  // only 403 is worse than showing it disabled with the reason.
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  // Lean tenants have no test/live concept, so no mode row. Presentation only —
  // nothing in this file reads `square_mode` for anything but the two calls
  // that must carry it.
  const hideModeUi = isTestModeUiHidden(tenant.slug);

  const verdict = useMemo(() => deriveSquareVerdict(status.data), [status.data]);
  const live = verdict.rail === "square" && !!verdict.connection;
  const health = useSquarePaymentHealth(tenant, live);

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError || !status.data) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  if (verdict.rail === "stripe-locked") return <StripeLocked verdict={verdict} />;
  if (verdict.rail === "stripe-unlocked") {
    return <ChooseSquare tenant={tenant} snapshot={status.data} verdict={verdict} canManage={canManage} />;
  }

  const mode = status.data.squareMode;

  return (
    <div className="space-y-5 pt-1">
      {/* The headline. Tone tracks how much money is on the line: `danger`
          only where every payment is failing right now. */}
      <PanelNote tone={verdict.tone}>{verdict.headline}</PanelNote>

      {!live ? (
        <NotConnected
          tenant={tenant}
          snapshot={status.data}
          verdict={verdict}
          mode={mode}
          canManage={canManage}
        />
      ) : (
        <>
          <Connection
            tenant={tenant}
            verdict={verdict}
            connection={verdict.connection as SquareConnectionRow}
            mode={mode}
            hideModeUi={hideModeUi}
            canManage={canManage}
          />
          <PaymentSync health={health} />
          <Disconnect tenant={tenant} mode={mode} canManage={canManage} onClose={onClose} />
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── stripe, locked ───────────────────────────── */

function StripeLocked({ verdict }: { verdict: SquareVerdict }) {
  return (
    <div className="space-y-4 pt-1">
      <PanelNote>{verdict.headline}</PanelNote>
      {/* Same sentence the Stripe panel uses for the mirror case, on purpose:
          the two cards must agree about why the rail is fixed. The trigger
          refuses to clear the lock for anyone, so no promise is made about what
          support can do — only who to talk to. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your payment processor is fixed once chosen, because a refund has to go back through whoever
        took the charge. Talk to Drive247 support if this looks wrong.
      </p>
    </div>
  );
}

/* ─────────────────────────── stripe, unlocked ───────────────────────────── */

/**
 * The rail decision.
 *
 * Three gates, mirrored from the DB trigger and v1's screen rather than
 * invented: no payments may exist, the business must be registered in one of
 * Square's eight markets, and the operator must acknowledge what Square cannot
 * do. Then a confirmation, because the write cannot be undone — not here, not
 * in Settings, and not by clearing the column (the trigger refuses that too).
 */
function ChooseSquare({
  tenant,
  snapshot,
  verdict,
  canManage,
}: {
  tenant: PanelTenant;
  snapshot: SquareSnapshot;
  verdict: SquareVerdict;
  canManage: boolean;
}) {
  const payments = useSquarePaymentsCount(tenant, true);
  const choose = useChooseSquare(tenant);

  const storedCountry = (snapshot.tenant.country ?? "").toUpperCase();
  const [country, setCountry] = useState<string>(
    isSquareCountrySupported(storedCountry) ? storedCountry : "",
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const paymentCount = payments.data ?? 0;
  const hasPayments = paymentCount > 0;
  // A stored country outside Square's markets is a hard stop the operator
  // cannot clear from here: the DB CHECK would refuse the write, and quietly
  // overwriting a registered country to get past it is not this screen's call.
  const countryFixedElsewhere = !!storedCountry && !isSquareCountrySupported(storedCountry);
  const stripeLinked = snapshot.tenant.own_stripe_account_id ?? snapshot.tenant.stripe_account_id;

  const countryName = SQUARE_COUNTRIES.find((c) => c.code === country)?.name ?? country;
  const canConfirm = canManage && !hasPayments && !countryFixedElsewhere && !!country && acknowledged;

  return (
    <div className="space-y-5 pt-1">
      <PanelNote>{verdict.headline}</PanelNote>

      <PanelSection
        title="Choose Square instead"
        description="Payment links only. For businesses that already run on Square."
      >
        <PanelCard>
          <p className="py-1 text-xs font-medium text-foreground">With Square you will not be able to use:</p>
          <ul className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground">
            {SQUARE_LIMITS.map((l) => (
              <li key={l} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </PanelCard>

        {/* What the write touches, named in full. Every line is a column the
            confirm actually changes — see useChooseSquare — so nothing here is
            a surprise afterwards. */}
        <PanelCard>
          <p className="py-1 text-xs font-medium text-foreground">What changes when you confirm:</p>
          <ul className="space-y-1 pb-1 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <Lock className="mt-0.5 size-3 shrink-0" />
              <span>
                Square becomes your processor <strong className="font-medium text-foreground">permanently</strong>.
                The database refuses to change it again once set — there is no undo here or in Settings.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>
                Stripe Connect stops being offered.
                {stripeLinked
                  ? ` The Stripe account already linked (${stripeLinked}) stays linked but takes no more bookings.`
                  : " Nothing is linked in Stripe today, so nothing is left behind."}
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>Deposits are taken as a real charge and refunded afterwards, instead of held.</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>
                Instalment plans, auto-extend charging and pay-as-you-go reminders are switched off, because
                Square cannot store a card to charge later.
              </span>
            </li>
          </ul>
        </PanelCard>

        {hasPayments ? (
          <PanelNote tone="warn">
            You already have {paymentCount} payment{paymentCount === 1 ? "" : "s"} recorded. The
            processor is fixed once money has been taken, because refunds must go back through the
            processor that took them. Square is no longer an option for this account.
          </PanelNote>
        ) : countryFixedElsewhere ? (
          <PanelNote tone="warn">
            Square cannot process payments for a business registered in {storedCountry}. It is available
            in {SQUARE_COUNTRIES.map((c) => c.code).join(", ")}. If that country is wrong, ask Drive247
            support to correct it before choosing Square.
          </PanelNote>
        ) : !canManage ? (
          <PanelNote tone="warn">
            Only an admin or head admin can choose the payment processor. Ask one of them to open this
            card.
          </PanelNote>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Country your business is registered in
              </label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {SQUARE_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code} className="text-xs">
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Square only operates in these countries. Registered somewhere else? Square is not
                available to you, and Stripe stays your processor.
              </p>
            </div>

            {/* A <label> wrapping the control, so the whole row is the hit
                target: on v1 this checkbox rendered as an invisible box and
                Confirm stayed disabled with nothing on screen saying why. */}
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs leading-snug text-foreground">
                I understand these features will not be available, and that this choice is permanent.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setConfirmOpen(true)} disabled={!canConfirm || choose.isPending}>
                {choose.isPending ? <Loader2 className="animate-spin" /> : <Lock />}
                {choose.isPending ? "Saving…" : "Choose Square"}
              </Button>
              {/* A disabled button with no reason beside it is a dead end.
                  Name the missing step. */}
              <span className="text-[11px] text-muted-foreground">
                {!country
                  ? "Choose your country to continue."
                  : !acknowledged
                    ? "Tick the box above to continue."
                    : "You will not be asked again."}
              </span>
            </div>
          </>
        )}
      </PanelSection>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make Square your payment processor?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Your business will be recorded as registered in {countryName}, and every booking from
                  now on will be paid through Square. This locks immediately and cannot be reversed.
                </p>
                <p>
                  Instalments, auto-extend charging, saved-card charges and deposit holds are switched
                  off. Stripe Connect will no longer be offered on this account.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Stripe</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // `mutate` with callbacks rather than `await mutateAsync`:
                // AlertDialogAction dismisses on click either way, so awaiting
                // inside the handler only delays the result. The panel does not
                // close on success — the same dialog re-renders on the Square
                // rail with a Connect button, which is the next step.
                choose.mutate(country);
                setConfirmOpen(false);
              }}
            >
              Choose Square
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────────── not connected ────────────────────────────── */

function NotConnected({
  tenant,
  snapshot,
  verdict,
  mode,
  canManage,
}: {
  tenant: PanelTenant;
  snapshot: SquareSnapshot;
  verdict: SquareVerdict;
  mode: SquareMode;
  canManage: boolean;
}) {
  const connect = useConnectSquare(tenant, mode);
  // The connect ends in a full-page redirect, so the pending flag is latched
  // rather than cleared on success — the button keeps spinning until the
  // browser actually leaves. Reset only when the start call fails.
  const [leaving, setLeaving] = useState(false);
  // The DB CHECK guarantees a Square tenant has a supported country, so this
  // is belt and braces: `square-oauth-start` refuses the same case with its
  // own sentence, and offering a button it will 409 is not a control.
  const countryOk = isSquareCountrySupported(snapshot.tenant.country);

  return (
    <PanelSection title="Connect Square">
      {verdict.revokedAt && (
        <PanelNote>
          You disconnected Square on {fmtDate(verdict.revokedAt)}. Payments already taken were left
          exactly as they were in Square, and reconnecting starts fresh.
        </PanelNote>
      )}

      <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        {[
          "Sign in to Square and approve access — Drive247 never sees your Square password.",
          "Square hands back a credential for your merchant; it is held encrypted, never shown, and can be revoked from Square at any time.",
          "Drive247 checks that the account has a location cleared for card payments in your currency, and records it.",
          "Square brings you back to this portal's Settings → Payments page when it is done. This card updates the next time you open it.",
        ].map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="shrink-0 text-primary">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {!countryOk ? (
        <PanelNote tone="warn">
          Square cannot process payments for a business registered in{" "}
          {snapshot.tenant.country ?? "an unknown country"}. Ask Drive247 support to correct the
          country on this account first.
        </PanelNote>
      ) : !canManage ? (
        <PanelNote tone="warn">
          Only an admin or head admin can connect a payment processor. Ask one of them to open this
          card.
        </PanelNote>
      ) : (
        <Button
          onClick={() => {
            setLeaving(true);
            connect.mutate(undefined, { onError: () => setLeaving(false) });
          }}
          disabled={leaving}
        >
          {leaving ? <Loader2 className="animate-spin" /> : <Link2 />}
          {leaving ? "Opening Square…" : "Connect Square"}
        </Button>
      )}
    </PanelSection>
  );
}

/* ─────────────────────────────── connection ─────────────────────────────── */

function Connection({
  tenant,
  verdict,
  connection,
  mode,
  hideModeUi,
  canManage,
}: {
  tenant: PanelTenant;
  verdict: SquareVerdict;
  connection: SquareConnectionRow;
  mode: SquareMode;
  hideModeUi: boolean;
  canManage: boolean;
}) {
  const connect = useConnectSquare(tenant, mode);
  const [leaving, setLeaving] = useState(false);

  // Reconnecting is a real remedy for EVERY attention state on a live row, and
  // for a different reason each time: it re-runs the callback's location probe
  // (setup unfinished, no card location, currency mismatch), it replaces a
  // dead grant (expired, error), and — with the renewal job not running — it is
  // the only way a fresh 30-day token gets minted at all (expiring soon,
  // renewal failing). So one button, labelled for what it does.
  const offerReconnect = verdict.state === "attention";
  const reconnectLabel = verdict.setupIncomplete ? "Reconnect and re-check" : "Reconnect Square";

  return (
    <PanelSection title="Account">
      <PanelCard className="divide-y divide-border/60">
        <PanelRow label="Business">
          {connection.business_name ?? <span className="text-muted-foreground">Unnamed</span>}
        </PanelRow>

        <PanelRow label="Merchant ID" mono>
          {connection.merchant_id ? (
            <CopyValue value={connection.merchant_id} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </PanelRow>

        {/* Square binds the currency to the LOCATION and never converts. A
            location is also mandatory on every payment link, so "none" here is
            "cannot take money", full stop. */}
        <PanelRow
          label="Location"
          hint="Square needs a location on every payment link, and bills in that location's currency."
        >
          {connection.location_id ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-[12px]">{connection.location_id}</span>
              {connection.location_currency && (
                <span
                  className={
                    verdict.currencyMismatch
                      ? "text-warning"
                      : "text-muted-foreground"
                  }
                >
                  {connection.location_currency.toUpperCase()}
                </span>
              )}
            </span>
          ) : (
            <span className="text-warning">None cleared for cards</span>
          )}
        </PanelRow>

        <PanelRow label="Connected">{fmtDate(connection.connected_at)}</PanelRow>

        {!hideModeUi && (
          <PanelRow label="Square mode">{mode === "live" ? "Live" : "Test"}</PanelRow>
        )}

        {/* The hint deliberately does NOT promise a renewal. The job that
            renews is server-side, this screen cannot see it, and today it is
            not running — so the date is presented as what it is: a deadline
            that only moves if something moves it. */}
        <PanelRow
          label="Access"
          hint={`Square access lasts ${SQUARE_TOKEN_LIFETIME_DAYS} days. Renewing it is a background job on Drive247's side, not something this screen can run — if this date is within a week, or already past, that renewal has not happened, and reconnecting is the fix you have from here.`}
        >
          <span
            className={
              verdict.tokenExpired
                ? "text-destructive"
                : verdict.expiringSoon
                  ? "text-warning"
                  : undefined
            }
          >
            {tokenPhrase(connection.token_expires_at, verdict.daysUntilExpiry)}
          </span>
        </PanelRow>
      </PanelCard>

      {/* Verbatim, not paraphrased: this string is what support needs to tell
          "revoked in the Square dashboard" from "merchant deactivated" from
          "platform credentials missing". */}
      {connection.last_error && (
        <PanelNote tone="warn">
          Last message on this connection:
          <span className="mt-1 block break-words font-mono text-[11px] opacity-80">
            {connection.last_error}
          </span>
        </PanelNote>
      )}

      <PanelSection
        title="Permissions"
        description="What you approved this portal to do inside your Square account."
      >
        {connection.scopes && connection.scopes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {connection.scopes.map((scope) => (
              <span
                key={scope}
                className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 font-mono text-[11px] text-primary"
              >
                {scope}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not recorded yet — Square reports the granted scopes when the connection is (re)established.
          </p>
        )}
      </PanelSection>

      <div className="flex flex-wrap items-center gap-2">
        {offerReconnect &&
          (canManage ? (
            <Button
              onClick={() => {
                setLeaving(true);
                connect.mutate(undefined, { onError: () => setLeaving(false) });
              }}
              disabled={leaving}
            >
              {leaving ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {leaving ? "Opening Square…" : reconnectLabel}
            </Button>
          ) : null)}

        <Button variant="ghost" asChild>
          <a href={dashboardHref(connection.square_mode)} target="_blank" rel="noopener noreferrer">
            Open Square
            <ArrowUpRight />
          </a>
        </Button>
      </div>

      {offerReconnect && !canManage && (
        <PanelNote tone="warn">
          Only an admin or head admin can reconnect Square — ask one of them to restore payments.
        </PanelNote>
      )}

      {/* Said out loud rather than hidden, because "where is the refresh
          button?" is otherwise the obvious next question. Refreshing what is
          stored is what reopening the card does; only reconnecting asks Square
          anything. */}
      {!offerReconnect && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
          <span>
            Nothing to do right now. This card re-reads the stored connection each time it opens; only
            reconnecting asks Square anything new.
          </span>
        </p>
      )}
    </PanelSection>
  );
}

/* ───────────────────────────── payment sync ─────────────────────────────── */

function PaymentSync({ health }: { health: ReturnType<typeof useSquarePaymentHealth> }) {
  if (health.isLoading) return <PanelLoading rows={2} />;
  if (health.isError) {
    return (
      <PanelSection title="Payments">
        <PanelError
          message={health.error instanceof Error ? health.error.message : "Unknown error"}
          onRetry={() => void health.refetch()}
        />
      </PanelSection>
    );
  }

  const h = health.data;
  if (!h) return null;

  return (
    <PanelSection title="Payments" description="How Square payments reach your records here.">
      {h.total === 0 ? (
        <PanelNote>
          No Square payments yet. Rows appear here as customers pay their links — this fills up on its
          own once the fleet is trading.
        </PanelNote>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Paid" value={h.completed} />
            <Tile label="Awaiting" value={h.pending} tone={h.pendingStale ? "warn" : undefined} />
            <Tile label="All Square" value={h.total} />
          </div>

          <PanelCard>
            <PanelRow label="Last payment">{fmtAgo(h.lastPaidAt)}</PanelRow>
            {h.pending > 0 && (
              <PanelRow label="Oldest unpaid link">{fmtAgo(h.oldestPendingAt)}</PanelRow>
            )}
          </PanelCard>
        </>
      )}

      {/* Nothing on this screen settles a payment. Square tells Drive247 when a
          link is paid; a missed message leaves the row "awaiting" while the
          customer's money has moved, and the server-side sweep that would
          catch it takes no tenant argument (it settles EVERY operator's rows),
          so it is not something a tenant button may fire. Say what is true. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Square tells Drive247 the moment a link is paid. If that message is ever missed, the payment
        stays &ldquo;awaiting&rdquo; here even though the customer paid — Drive247 re-checks those on the
        platform side, not from this screen.
      </p>

      {h.pendingStale && (
        <PanelNote tone="warn">
          A link has been unpaid for over an hour. That is usually just a customer who has not paid
          yet — but if they say they have, the payment needs looking at on the platform side.
        </PanelNote>
      )}
    </PanelSection>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-2.5 py-2 text-center">
      <div className={`text-lg font-medium leading-tight ${tone === "warn" ? "text-warning" : ""}`}>
        {value}
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

/* ─────────────────────────────── disconnect ─────────────────────────────── */

function Disconnect({
  tenant,
  mode,
  canManage,
  onClose,
}: {
  tenant: PanelTenant;
  mode: SquareMode;
  canManage: boolean;
  onClose: () => void;
}) {
  const disconnect = useDisconnectSquare(tenant, mode);
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
          Disconnect Square
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Disconnect Square?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  New bookings will not be able to take card payments, and no Square refund can be
                  issued from this portal, until Square is connected again. The stored credentials are
                  deleted — reconnecting means signing in to Square and approving access again.
                </p>
                {/* The distinction operators get wrong: disconnecting is not a
                    refund and not a rollback. Money already in Square stays in
                    Square, and the rows here are untouched — square-disconnect
                    never deletes the connection row either, so a refund that
                    settles later can still find this tenant. */}
                <p>
                  Payments already taken are not touched — they stay in your Square account, and your
                  Drive247 records of them are unchanged.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Closing the PANEL is deferred to success on purpose. Closing
                // it unconditionally would drop an operator whose disconnect
                // just failed back onto a card that still reads "Connected",
                // with the error toast the only trace — on success that same
                // card flipping to "Not connected" in front of them is the
                // confirmation.
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
