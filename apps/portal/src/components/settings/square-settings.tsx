/**
 * SquareSettings — Settings → Payments, for tenants whose money runs on Square.
 *
 * A SIBLING of <StripeConnectSettings />, never a shared component. The two
 * processors do not describe the same thing: Stripe Connect shows an account id
 * and an onboarding-complete flag, while Square shows a merchant, a LOCATION
 * (a payment link is impossible without one), the location's currency (Square
 * never converts), and a credential with 30 days to live. Trying to express
 * both through one component would mean a props union whose branches share
 * nothing but the word "Connect".
 *
 * Rendering rule, in order:
 *   1. not a Square tenant (or still resolving)  → render NOTHING
 *   2. country outside Square's 8 markets        → explain, offer no button
 *   3. linked but Square not card-ready          → persistent "one more step"
 *   4. token expired / connection errored        → prominent reconnect + reason
 *   5. connected                                 → merchant, location, expiry, scopes
 *   6. otherwise                                 → Connect
 *
 * A token value is never rendered, never logged, and is not even readable from
 * here: the hook reads `square_connections_public`, a view defined without the
 * secret-id columns.
 */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  MapPin,
  RefreshCw,
  TestTube2,
  Unplug,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  useSquareConnection,
  SQUARE_SUPPORTED_COUNTRIES,
  SQUARE_SUPPORTED_COUNTRY_NAMES,
  SQUARE_TOKEN_LIFETIME_DAYS,
  type SquareConnectionRow,
} from "@/hooks/use-square-connection";

interface Props {
  /**
   * Optional narrowing from the settings page. It can only ever REMOVE edit
   * rights: the component still asks the permission system itself, so a viewer
   * cannot be handed a live Disconnect button by a page that forgot to pass it.
   */
  canEdit?: boolean;
}

/**
 * Wording for the `reason` codes `square-oauth-callback` redirects with.
 *
 * The first five are every code that function actually emits, read off it
 * rather than guessed: `state_expired`, `missing_code`, `connection_failed`
 * (outcome `error`) and `no_card_capable_location`, `currency_mismatch`
 * (outcome `incomplete`). The rest are Square's own OAuth error strings, which
 * the callback passes straight through when Square supplies one. Anything
 * unlisted falls through to the raw code, which still beats silence.
 */
const OAUTH_REASONS: Record<string, string> = {
  state_expired:
    "The connection request timed out before you finished authorising. Click Connect again and complete Square's screens without pausing.",
  missing_code: "Square redirected back without an authorisation code.",
  connection_failed:
    "Square authorised the connection, but we could not finish saving it. Please try again.",
  no_card_capable_location:
    "That Square account has no location that can take card payments yet. Create or activate a location in your Square dashboard, then reconnect below.",
  currency_mismatch:
    "Your Square location bills in a different currency from this portal. Square never converts between currencies — align the two in Square, then reconnect.",
  access_denied: "The Square sign-in was cancelled before it finished.",
  invalid_request: "Square rejected the connection request.",
  invalid_client: "Square rejected our application credentials for this environment.",
  invalid_grant:
    "Square rejected the authorisation code — it is only valid for five minutes and only once.",
  unauthorized_client: "This portal is not authorised to connect that Square account.",
};

export function SquareSettings({ canEdit: canEditProp }: Props = {}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { canEditSettings } = useManagerPermissions();
  const { isAdmin } = useAuth();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // Tracked locally rather than reading query.isFetching: the hook polls every
  // 60s, so isFetching would put the Refresh button into a spinner (and disable
  // it) once a minute for no reason the operator can see.
  const [refreshing, setRefreshing] = useState(false);

  const sq = useSquareConnection();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sq.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Safe by default, and aligned with the SERVER's authority.
  //
  // `isAdmin()` is the binding term: it is head_admin|admin (the auth store
  // rewrites a super admin to head_admin), which is character-for-character the
  // set square-oauth-start's authorizeCaller accepts. Gating on anything wider
  // — a manager holding an editor grant on the Payments tab, say — would render
  // an enabled Connect button that the edge function answers with 403, and the
  // operator would reasonably read that as the integration being broken.
  //
  // `canEditSettings` stays in the AND so the ordinary settings read-only rules
  // still apply, and the optional prop can only ever narrow further.
  const canEdit =
    canEditProp !== false && isAdmin() && canEditSettings("payments");

  // ── Report the OAuth round-trip result ──────────────────────────────────
  //
  // Contract with square-oauth-callback: it returns the operator to
  // …/settings?tab=payments&square=ok|incomplete|error[&reason=<code>].
  // Without this the operator lands on an ordinary-looking settings page after
  // a failed authorisation and reasonably concludes it worked.
  const handledOAuthResult = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("square");
    if (!result) return;
    // React StrictMode double-invokes effects in dev; without this the toast fires twice.
    if (handledOAuthResult.current) return;
    handledOAuthResult.current = true;

    const reason = params.get("reason") ?? "";
    const explained = reason ? OAUTH_REASONS[reason] : undefined;

    if (result === "ok") {
      toast.success("Square connected");
    } else if (result === "incomplete") {
      // Deliberately NOT an error. Nothing failed — Square simply has not
      // finished enabling this merchant for card processing (or the location's
      // currency does not match), and NOTHING will ever push a "now it works"
      // signal, so the operator has to come back and re-check. Long duration
      // because it carries an instruction, not an acknowledgement. (Same
      // failure mode that cost Global Motion two days on the Stripe side in
      // Aug 2026 — "Stripe connected, you can accept payments" while charges
      // were still disabled.)
      toast.warning("One more step in Square", {
        description:
          explained ??
          "Your Square account is linked, but it cannot take card payments yet. " +
            "Finish Square's own setup, then reconnect below — that is what re-checks the location.",
        duration: 15000,
      });
    } else {
      toast.error("Couldn't connect Square", {
        description: explained ?? (reason ? `Square reported: ${reason}` : "Please try again."),
        duration: 10000,
      });
    }

    // The card reads cached state, so it would keep showing "Not connected".
    queryClient.invalidateQueries({ queryKey: ["square-connection", tenant?.id] });

    // Strip only OUR params so a refresh does not replay the toast, while
    // leaving ?tab=payments alone — history.replaceState rather than the Next
    // router so the settings page does not remount mid-toast.
    params.delete("square");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [queryClient, tenant?.id]);

  // ── 1. Not a Square tenant ───────────────────────────────────────────────
  //
  // Also covers the loading window ON PURPOSE. Rendering a skeleton before the
  // provider is known would flash a Square-shaped card on all 52 Stripe
  // tenants' Payments tab; an empty slot that fills in half a second later is
  // strictly better than that.
  if (!sq.isSquareTenant) return null;

  const conn = sq.connection;
  const modeIsLive = sq.squareMode === "live";

  return (
    <>
      <Card className="shadow-none">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <CreditCard className="h-5 w-5 text-indigo-600" />
                Square
                <Badge variant="outline" className="ml-1 gap-1 font-normal">
                  {modeIsLive ? <Zap className="h-3 w-3" /> : <TestTube2 className="h-3 w-3" />}
                  {modeIsLive ? "Live" : "Sandbox"}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Connect the Square account that takes your booking payments. Customers pay through a
                Square-hosted link; the money lands in your own Square balance.
              </CardDescription>
            </div>
            <StatusChip
              connected={sq.isConnected}
              needsReconnect={sq.needsReconnect}
              setupIncomplete={sq.isSetupIncomplete}
              expiringSoon={sq.isExpiringSoon}
              critical={sq.isExpiryCritical}
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* A read failure NARROWS the panel, it does not replace it.
              The early return above means we only ever get here once a
              successful read has already told us this is a Square tenant, so
              `sq.connection` still holds the last good state — blanking it out
              for a transient poll failure would tell an operator their
              connection had vanished when only the request had. */}
          {sq.error ? (
            <div className="mx-6 mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Showing the last known state — we could not refresh it just now
              {sq.error.message ? `: ${sq.error.message}` : "."}
            </div>
          ) : null}

          {!sq.countrySupported ? (
            <UnsupportedCountry country={sq.country} />
          ) : sq.isSetupIncomplete ? (
            <SetupIncomplete
              connection={conn}
              canEdit={canEdit}
              connecting={sq.isConnecting}
              onReconnect={sq.connect}
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
            />
          ) : sq.needsReconnect ? (
            <ReconnectPrompt
              connection={conn}
              expired={sq.isExpired}
              canEdit={canEdit}
              connecting={sq.isConnecting}
              onReconnect={sq.connect}
            />
          ) : sq.isConnected && conn ? (
            <ConnectedDetail
              connection={conn}
              daysUntilExpiry={sq.daysUntilExpiry}
              expiringSoon={sq.isExpiringSoon}
              critical={sq.isExpiryCritical}
              tenantCurrency={tenant?.currency_code ?? null}
              modeIsLive={modeIsLive}
              canEdit={canEdit}
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              onDisconnect={() => setConfirmDisconnect(true)}
              disconnecting={sq.isDisconnecting}
            />
          ) : (
            <NotConnected
              modeIsLive={modeIsLive}
              canEdit={canEdit}
              connecting={sq.isConnecting}
              onConnect={sq.connect}
            />
          )}
        </CardContent>
      </Card>

      <GoLivePanel
        modeIsLive={modeIsLive}
        canEdit={canEdit}
        tenantCurrency={tenant?.currency_code ?? null}
        liveConnection={sq.connections.find((c) => c.square_mode === "live" && c.status === "active") ?? null}
        connecting={sq.isConnecting}
        onConnectLive={() => sq.connect("live")}
        settingMode={sq.isSettingMode}
        onSetMode={sq.setSquareMode}
      />

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-red-600" />
              Disconnect Square?
            </AlertDialogTitle>
            <AlertDialogDescription>
              New payment links will stop working immediately and no further Square payments or
              refunds can be taken from this portal until you reconnect. Payments already taken are
              unaffected and stay in your Square account. Reconnecting means signing in to Square
              and approving access again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                setConfirmDisconnect(false);
                sq.disconnect();
              }}
            >
              Yes, disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default SquareSettings;

// ─────────────────────────────────────────────────────────────────────────────
// Layout primitive — the two-column settings row (304px label + flex content)
// ─────────────────────────────────────────────────────────────────────────────

function SettingsRow({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-6 py-5 md:flex-row md:items-start md:gap-6">
      <div className="md:w-[304px] md:flex-none">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sublabel ? <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div> : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status chip
// ─────────────────────────────────────────────────────────────────────────────

function StatusChip({
  connected,
  needsReconnect,
  setupIncomplete,
  expiringSoon,
  critical,
}: {
  connected: boolean;
  needsReconnect: boolean;
  setupIncomplete: boolean;
  expiringSoon: boolean;
  critical: boolean;
}) {
  if (setupIncomplete) {
    // Amber, not red: the link to Square exists and nothing is broken on our
    // side — Square just is not ready. Red here would send the operator hunting
    // for a fault in the portal.
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Setup unfinished
      </span>
    );
  }
  if (needsReconnect) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <XCircle className="h-3.5 w-3.5" />
        Action needed
      </span>
    );
  }
  if (connected && (critical || expiringSoon)) {
    // Amber, not red, while the token is still alive — the operator can still
    // take payments today, and red here would read as "already broken".
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
          critical
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Renewal overdue
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
      Not connected
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State: country outside Square's markets
// ─────────────────────────────────────────────────────────────────────────────

function UnsupportedCountry({ country }: { country: string | null }) {
  const names = (SQUARE_SUPPORTED_COUNTRIES as readonly string[])
    .map((c) => SQUARE_SUPPORTED_COUNTRY_NAMES[c] ?? c)
    .join(", ");

  return (
    <SettingsRow
      label="Square is not available here"
      sublabel="Square can only process payments for sellers based in the countries it operates in."
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
          <Globe className="h-4 w-4" />
          {country
            ? `Square does not operate in your country (${country}).`
            : "We do not have a country on file for your business, so we cannot offer Square."}
        </p>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          Square supports sellers in {names}. There is no Connect step to try — Square would refuse
          the account. If your business is registered in one of those countries, contact support to
          have your country corrected and Square will appear here.
        </p>
      </div>
    </SettingsRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State: not connected
// ─────────────────────────────────────────────────────────────────────────────

function NotConnected({
  modeIsLive,
  canEdit,
  connecting,
  onConnect,
}: {
  modeIsLive: boolean;
  canEdit: boolean;
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <SettingsRow
      label="Connect your Square account"
      sublabel="Takes about two minutes. You sign in to Square and approve access — we never see your Square password."
    >
      <div className="rounded-lg border border-dashed border-border p-6">
        <p className="text-sm text-muted-foreground">
          No Square account is connected yet, so this portal cannot take payments. Connecting links
          your Square merchant and the location you sell from.
        </p>
        {!modeIsLive ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            You are in <strong>sandbox</strong> mode. You will be asked to sign in to a Square
            sandbox seller, and any payment taken is simulated — no real money moves.
          </p>
        ) : null}
        <Button
          className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700"
          onClick={onConnect}
          disabled={!canEdit || connecting}
        >
          {connecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting to Square…
            </>
          ) : (
            <>
              <Link2 className="mr-2 h-4 w-4" />
              Connect with Square
            </>
          )}
        </Button>
        {!canEdit ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Only an administrator can connect Square.
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State: linked to Square, but Square is not ready to take a card
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The persistent "one more step" panel.
 *
 * It has to be persistent — not a toast — because Square emits NO event when a
 * location becomes card-capable. Nothing will ever arrive to tell the portal
 * "it works now", so the only mechanism that can close this state is the
 * operator coming back.
 *
 * The primary action is deliberately "Reconnect", not a re-check: walking the
 * consent flow again is what re-runs square-oauth-callback's location probe,
 * and that probe is the only thing that can promote the row to `active`.
 * "Refresh" is offered alongside, but only re-reads what is already stored —
 * useful once the webhook or the token-refresh cron has updated it, useless on
 * its own. Labelling them accurately is the whole point: a button that claims
 * to re-ask Square, and does not, is how an operator concludes the product is
 * broken.
 */
function SetupIncomplete({
  connection,
  canEdit,
  connecting,
  onReconnect,
  refreshing,
  onRefresh,
}: {
  connection: SquareConnectionRow | null;
  canEdit: boolean;
  connecting: boolean;
  onReconnect: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <SettingsRow
      label="Square is linked, but not ready"
      sublabel="Your account is connected. Square has not cleared it to take card payments yet."
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          One more step, and it is inside Square.
        </p>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          We connected to{" "}
          <strong>{connection?.business_name || "your Square account"}</strong>, but could not find a
          location on it that is active for card processing in this portal&apos;s currency. Sort that
          out in your Square dashboard, then reconnect here — that is what re-checks the location.
        </p>

        {connection?.last_error ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-900 dark:bg-black/20">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
              What we found
            </div>
            <p className="mt-1 break-words text-xs text-amber-900 dark:text-amber-200">
              {connection.last_error}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            className="bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={onReconnect}
            disabled={!canEdit || connecting}
          >
            {connecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting to Square…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reconnect and re-check
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh status
          </Button>
        </div>
        {!canEdit ? (
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-400">
            Only an administrator can reconnect Square — ask one to finish this.
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State: expired / errored — the prominent reconnect prompt
// ─────────────────────────────────────────────────────────────────────────────

function ReconnectPrompt({
  connection,
  expired,
  canEdit,
  connecting,
  onReconnect,
}: {
  connection: SquareConnectionRow | null;
  expired: boolean;
  canEdit: boolean;
  connecting: boolean;
  onReconnect: () => void;
}) {
  return (
    <SettingsRow
      label={expired ? "Your Square connection has expired" : "Square reported a problem"}
      sublabel="Payments and refunds are stopped until this is fixed."
    >
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-200">
          <AlertTriangle className="h-4 w-4" />
          {expired
            ? "Square's permission to charge on your behalf has lapsed."
            : "Square rejected our last attempt to use this connection."}
        </p>
        <p className="mt-2 text-sm text-red-800 dark:text-red-300">
          {/* Square's OAuth tokens live 30 days and are renewed automatically well
              before that. Reaching this state means the automatic renewal could not
              complete — usually because access was revoked in the Square dashboard. */}
          Square access is renewed automatically every few days. When that cannot complete — most
          often because the app was removed from your Square dashboard — the only fix is to sign in
          to Square and approve access again. Nothing else in your portal is affected, and no
          payment history is lost.
        </p>

        {connection?.last_error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 dark:border-red-900 dark:bg-black/20">
            <div className="text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
              What Square said
            </div>
            {/* Verbatim, not paraphrased: this string is what support needs to
                tell "revoked in the dashboard" from "merchant deactivated". */}
            <p className="mt-1 break-words font-mono text-xs text-red-900 dark:text-red-200">
              {connection.last_error}
            </p>
          </div>
        ) : null}

        {(connection?.refresh_failure_count ?? 0) > 0 ? (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">
            Automatic renewal has failed {connection?.refresh_failure_count} time
            {connection?.refresh_failure_count === 1 ? "" : "s"}.
          </p>
        ) : null}

        <Button
          className="mt-4 bg-indigo-600 text-white hover:bg-indigo-700"
          onClick={onReconnect}
          disabled={!canEdit || connecting}
        >
          {connecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting to Square…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reconnect Square
            </>
          )}
        </Button>
        {!canEdit ? (
          <p className="mt-2 text-xs text-red-700 dark:text-red-400">
            Only an administrator can reconnect Square — ask one to restore payments.
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State: connected
// ─────────────────────────────────────────────────────────────────────────────

function ConnectedDetail({
  connection,
  daysUntilExpiry,
  expiringSoon,
  critical,
  tenantCurrency,
  modeIsLive,
  canEdit,
  refreshing,
  onRefresh,
  onDisconnect,
  disconnecting,
}: {
  connection: SquareConnectionRow;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  critical: boolean;
  tenantCurrency: string | null;
  modeIsLive: boolean;
  canEdit: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  // Square binds the currency to the LOCATION and never converts. A location
  // billing in USD under a portal quoting GBP does not produce a converted
  // charge — it produces a charge for the wrong number.
  const currencyMismatch =
    !!connection.location_currency &&
    !!tenantCurrency &&
    connection.location_currency.toUpperCase() !== tenantCurrency.toUpperCase();

  return (
    <div className="divide-y divide-border">
      <SettingsRow label="Merchant" sublabel="The Square seller these payments belong to.">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {connection.business_name || "Square merchant"}
          </p>
          {connection.merchant_id ? (
            <p className="font-mono text-xs text-muted-foreground">{connection.merchant_id}</p>
          ) : null}
          {connection.connected_at ? (
            <p className="text-xs text-muted-foreground">
              Connected {new Date(connection.connected_at).toLocaleDateString()}
            </p>
          ) : null}
          {!modeIsLive ? (
            <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
              Sandbox seller — payments taken here are simulated and settle no real money.
            </p>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        label="Location and currency"
        sublabel="Square requires a location on every payment link, and bills in that location's currency."
      >
        <div className="space-y-1">
          {/*
            A <div>, not a <p>. <Badge> renders a <div>, and the HTML parser
            auto-closes a <p> the moment a block element opens inside it — so the
            server markup and the client tree disagreed and React reported a
            hydration error on every render of a connected Square account.
            Nothing else here is a paragraph of prose, so div is also the honest
            element.
          */}
          <div className="flex items-center gap-2 text-sm text-foreground">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {connection.location_id ? (
              <span className="font-mono text-xs">{connection.location_id}</span>
            ) : (
              <span className="text-muted-foreground">No location recorded</span>
            )}
            {connection.location_currency ? (
              <Badge variant="outline" className="font-normal">
                {connection.location_currency.toUpperCase()}
              </Badge>
            ) : null}
          </div>
          {currencyMismatch ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Your Square location bills in {connection.location_currency?.toUpperCase()} but this
              portal quotes prices in {tenantCurrency?.toUpperCase()}. Square does not convert
              between currencies — a customer would be charged the same number in the wrong money.
              Fix this in Square before taking payments.
            </p>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        label="Access renewal"
        sublabel={`Square access lasts ${SQUARE_TOKEN_LIFETIME_DAYS} days and renews automatically in the background.`}
      >
        <ExpiryLine
          daysUntilExpiry={daysUntilExpiry}
          expiresAt={connection.token_expires_at}
          expiringSoon={expiringSoon}
          critical={critical}
        />
      </SettingsRow>

      <SettingsRow
        label="Permissions granted"
        sublabel="What you approved this portal to do inside your Square account."
      >
        {connection.scopes && connection.scopes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {connection.scopes.map((scope) => (
              <span
                key={scope}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {scope}
              </span>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="h-4 w-4" />
            Not recorded yet — Square reports the granted scopes when the connection is
            (re)established, so this fills in after the next reconnect.
          </p>
        )}
      </SettingsRow>

      <SettingsRow
        label="Manage"
        sublabel="Refresh re-reads the stored connection status. It does not re-ask Square — only reconnecting does that."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950/40"
            onClick={onDisconnect}
            disabled={!canEdit || disconnecting}
          >
            {disconnecting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Unplug className="mr-2 h-4 w-4" />
            )}
            Disconnect
          </Button>
          {!canEdit ? (
            <span className="text-xs text-muted-foreground">
              Only an administrator can disconnect Square.
            </span>
          ) : null}
        </div>
      </SettingsRow>
    </div>
  );
}

function ExpiryLine({
  daysUntilExpiry,
  expiresAt,
  expiringSoon,
  critical,
}: {
  daysUntilExpiry: number | null;
  expiresAt: string | null;
  expiringSoon: boolean;
  critical: boolean;
}) {
  if (daysUntilExpiry === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        No renewal date on file yet.
      </p>
    );
  }

  const dateLabel = expiresAt ? new Date(expiresAt).toLocaleDateString() : null;
  const dayLabel = `${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`;

  // Healthy: automatic renewal happens well before this date, so the number is
  // reassurance, not a deadline. Say so, or every operator reads a 24-day
  // countdown as a chore they have been given.
  if (!expiringSoon) {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Renews automatically — {dayLabel} of access remaining
          {dateLabel ? ` (until ${dateLabel})` : ""}.
        </p>
        <p className="text-xs text-muted-foreground">Nothing for you to do.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        critical
          ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          critical
            ? "text-red-800 dark:text-red-200"
            : "text-amber-900 dark:text-amber-200",
        )}
      >
        <AlertTriangle className="h-4 w-4" />
        {dayLabel} of Square access left{dateLabel ? ` (until ${dateLabel})` : ""}.
      </p>
      <p
        className={cn(
          "mt-1 text-sm",
          critical ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300",
        )}
      >
        Automatic renewal should have happened by now. If this number keeps falling, reconnect
        Square before it reaches zero — once it does, payments and refunds stop until you do.
      </p>
    </div>
  );
}

/**
 * Sandbox <-> production, the one control that decides whether a customer's card
 * is really charged.
 *
 * CONNECT FIRST, FLIP SECOND — and the panel is laid out in that order because
 * the reverse is unsafe. square-oauth-start accepts an explicit mode and
 * tolerates connecting production while the tenant is still on sandbox, so the
 * production account can be attached and verified by Square with no effect on
 * the customers transacting today. Only once that connection exists does the
 * switch below do anything; set-square-mode refuses it otherwise. Flipping first
 * would leave the tenant live with no live connection and fail every payment in
 * between.
 *
 * The gate is restated here as UI, never enforced here: the button is disabled
 * for the same reasons the server refuses, so the operator learns why before
 * clicking rather than after. The server is what actually decides.
 */
function GoLivePanel({
  modeIsLive,
  canEdit,
  tenantCurrency,
  liveConnection,
  connecting,
  onConnectLive,
  settingMode,
  onSetMode,
}: {
  modeIsLive: boolean;
  canEdit: boolean;
  tenantCurrency: string | null;
  liveConnection: SquareConnectionRow | null;
  connecting: boolean;
  onConnectLive: () => void;
  settingMode: boolean;
  onSetMode: (mode: "test" | "live") => void;
}) {
  const wanted = (tenantCurrency ?? "").toUpperCase();
  const got = (liveConnection?.location_currency ?? "").toUpperCase();
  const currencyMatches = Boolean(wanted) && wanted === got;
  const liveReady = Boolean(liveConnection?.location_id) && currencyMatches;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base font-medium">Environment</CardTitle>
        <CardDescription>
          {modeIsLive
            ? "This tenant is LIVE. Payments charge real cards and move real money."
            : "This tenant is in sandbox. No real money moves, and test cards are the only ones that work."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {modeIsLive ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Returning to sandbox stops real cards being charged immediately. It is never
              blocked — if live payments are failing, this is the way back.
            </p>
            <Button
              variant="outline"
              disabled={!canEdit || settingMode}
              onClick={() => onSetMode("test")}
            >
              {settingMode ? "Switching…" : "Return to sandbox"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Attach the production Square account</p>
              <p className="text-sm text-muted-foreground">
                Safe to do now — this tenant keeps transacting on sandbox until you switch below.
              </p>
              {liveConnection ? (
                <p className="text-sm">
                  Connected to <strong>{liveConnection.business_name ?? liveConnection.merchant_id}</strong>
                  {got ? ` · location bills ${got}` : " · no location cleared for card processing yet"}
                </p>
              ) : null}
              <Button variant="outline" disabled={!canEdit || connecting} onClick={onConnectLive}>
                {connecting
                  ? "Opening Square…"
                  : liveConnection
                    ? "Reconnect production account"
                    : "Connect production account"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">2. Switch this tenant to live</p>
              {!liveConnection ? (
                <p className="text-sm text-muted-foreground">
                  Connect the production account first.
                </p>
              ) : !liveConnection.location_id ? (
                <p className="text-sm text-amber-500">
                  Square has not cleared a location on that account for card processing yet.
                </p>
              ) : !currencyMatches ? (
                <p className="text-sm text-amber-500">
                  That location bills in {got || "an unknown currency"} but this tenant is set to{" "}
                  {wanted || "an unknown currency"}. Square cannot convert — connect a location in
                  the tenant's currency.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ready. After this, every payment charges a real card.
                </p>
              )}
              <Button
                disabled={!canEdit || settingMode || !liveReady}
                onClick={() => onSetMode("live")}
              >
                {settingMode ? "Switching…" : "Go live"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
