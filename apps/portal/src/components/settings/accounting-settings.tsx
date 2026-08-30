/**
 * AccountingSettings — Sprint 2 surface.
 *
 * Settings → Accounting tab. Gated to Growth+ tier via useFeatureAccess
 * (Confirmed Decision D1). Shows two provider cards (Xero + Zoho Books). For
 * each: not-connected → "Connect" button; connected → status row + Disconnect.
 *
 * Sprint 5 — both Xero and Zoho cards are fully wired. Zoho card opens the
 * region-selector modal before redirecting to the right data centre.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, CheckCircle2, AlertTriangle, Loader2, ExternalLink, ChevronRight, Settings2, ScrollText } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import {
  useAccountingConnections,
  useActiveAccountingConnection,
  useConnectXero,
  useDisconnectAccounting,
  type AccountingConnectionRow,
  type AccountingProvider,
} from "@/hooks/use-accounting-connection";
import { AccountingMappings } from "./accounting-mappings";
import { AccountingSyncLog } from "./accounting-sync-log";
import { AccountingBackfillWizard } from "./accounting-backfill-wizard";
import { ZohoRegionSelector } from "./zoho-region-selector";
import { Calendar as CalendarIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type View =
  | { kind: "cards" }
  | { kind: "mappings"; provider: AccountingProvider }
  | { kind: "log"; provider: AccountingProvider };

/**
 * Human wording for the `reason` codes the OAuth callbacks emit. Anything not
 * listed falls through to the raw code, which is still better than silence.
 */
const OAUTH_REASONS: Record<string, string> = {
  state_expired:
    "The connection request timed out before you finished authorising. Click Connect again and complete the provider's screens without pausing.",
  invalid_state: "That connection link had already been used or was not recognised. Click Connect to start a fresh one.",
  state_provider_mismatch: "That connection link was for a different provider. Click Connect again.",
  missing_params: "The provider redirected back without an authorisation code.",
  server_misconfigured: "The server is missing this provider's API credentials.",
  token_exchange_failed: "The provider rejected the authorisation code.",
  invalid_code: "The provider rejected the authorisation code — it may have already been used.",
  invalid_client: "The provider rejected our API credentials. The client id or secret is wrong for this data centre.",
  no_access_token: "The provider did not return an access token.",
  no_refresh_token:
    "The provider did not return a refresh token, so the connection could not be kept alive. Revoke the app in the provider's console and reconnect.",
  connections_lookup_failed: "Connected, but we could not read your organisation list.",
  organisations_lookup_failed:
    "You authorised successfully, but the provider rejected our request for your organisation list. This usually means a missing permission — reconnect, and if it repeats check the server logs.",
  no_organisations:
    "You authorised successfully, but that account has no Zoho Books organisation yet. Create one at books.zoho.com — signed in as the same account you just authorised with — then reconnect.",
  persist_failed: "The connection succeeded but could not be saved. Please try again.",
};

export function AccountingSettings() {
  const access = useFeatureAccess("finance_sync");
  const allConnections = useAccountingConnections();
  const xero = useActiveAccountingConnection("xero");
  const zoho = useActiveAccountingConnection("zoho");
  const [view, setView] = useState<View>({ kind: "cards" });

  // ── Report the OAuth round-trip result ───────────────────────────────────
  //
  // The callbacks redirect back with ?status=success|error&provider=…&reason=…
  // but this page only ever read ?tab, so every outcome was swallowed. On
  // failure the operator landed on an ordinary-looking settings page with no
  // message at all and reasonably concluded it had worked; on success the
  // provider card kept its cached "not connected" state until a manual reload.
  //
  // Provider-agnostic on purpose — Xero had exactly the same blind spot.
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { tenant, refetchTenant } = useTenant();
  const handledOAuthResult = useRef(false);

  useEffect(() => {
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");
    if (!status || !provider) return;
    // StrictMode double-invokes effects in dev; without this the toast fires twice.
    if (handledOAuthResult.current) return;
    handledOAuthResult.current = true;

    const label = provider === "zoho" ? "Zoho Books" : "Xero";

    if (status === "success") {
      // The card reads cached connection state, so it will not show the new
      // connection until these are refetched.
      qc.invalidateQueries({ queryKey: ["accounting-connections", tenant?.id] });
      void refetchTenant?.();   // integration_<provider> drives other UI
      toast.success(`${label} connected`);
    } else {
      const reason = searchParams.get("reason") ?? "unknown";
      toast.error(`Couldn't connect ${label}`, {
        description: OAUTH_REASONS[reason] ?? `The provider reported: ${reason}`,
        duration: 10000,
      });
    }

    // Strip the result params so a refresh or a back-navigation does not
    // replay the toast, while keeping the operator on the accounting tab.
    router.replace("/settings?tab=accounting");
  }, [searchParams, router, qc, tenant?.id, refetchTenant]);

  if (access.isLoading || allConnections.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    );
  }

  if (!access.canAccess) {
    return <FinanceSyncPaywall planName={access.planName} requiredTier={access.requiredTierLabel} />;
  }

  // Sub-views: mappings + sync log
  if (view.kind === "mappings") {
    return <AccountingMappings provider={view.provider} onBack={() => setView({ kind: "cards" })} />;
  }
  if (view.kind === "log") {
    return <AccountingSyncLog provider={view.provider} onBack={() => setView({ kind: "cards" })} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calculator className="h-4 w-4" />
          Finance Sync
        </div>
        <h2 className="mt-1 text-lg font-semibold">Accounting integrations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync every rental charge, payment, refund and damage to your accounting system automatically.
          Your accountant gets clean books without you re-keying anything.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderCard
          provider="xero"
          name="Xero"
          tagline="Cloud accounting trusted by 3.5M+ businesses"
          connection={xero.data}
          onConnect={ConnectXeroButton}
          onOpenMappings={() => setView({ kind: "mappings", provider: "xero" })}
          onOpenLog={() => setView({ kind: "log", provider: "xero" })}
        />
        <ProviderCard
          provider="zoho"
          name="Zoho Books"
          tagline="Online accounting for small businesses"
          connection={zoho.data}
          onConnect={ConnectZohoButton}
          onOpenMappings={() => setView({ kind: "mappings", provider: "zoho" })}
          onOpenLog={() => setView({ kind: "log", provider: "zoho" })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        You can connect both providers if you use different accounting systems for different parts of your business.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider card
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: "xero" | "zoho";
  name: string;
  tagline: string;
  connection: AccountingConnectionRow | null;
  onConnect: () => JSX.Element;
  onOpenMappings: () => void;
  onOpenLog: () => void;
}

function ProviderCard({ provider, name, tagline, connection, onConnect: ConnectButton, onOpenMappings, onOpenLog }: ProviderCardProps) {
  const [backfillOpen, setBackfillOpen] = useState(false);
  const disconnect = useDisconnectAccounting();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{name}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">{tagline}</CardDescription>
          </div>
          {connection && connection.status === "active" && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
            </Badge>
          )}
          {connection && connection.status === "expired" && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <AlertTriangle className="mr-1 h-3 w-3" /> Expired
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {!connection || connection.status !== "active" ? (
          <>
            {connection?.status === "expired" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Your connection has expired. Reconnect to keep syncing financial events.
              </p>
            )}
            {connection?.status === "revoked" && (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
                You disconnected this provider on {new Date(connection.disconnected_at ?? connection.updated_at).toLocaleDateString()}.
              </p>
            )}
            <ConnectButton />
          </>
        ) : (
          <>
            <dl className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Organisation</dt>
                <dd className="truncate font-medium">{connection.external_org_name ?? connection.external_org_id.slice(0, 8)}</dd>
              </div>
              {connection.external_region && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Region</dt>
                  <dd className="font-medium">.{connection.external_region}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Connected</dt>
                <dd className="font-medium">{new Date(connection.connected_at).toLocaleDateString()}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Last synced</dt>
                <dd className="font-medium">
                  {connection.last_synced_at
                    ? new Date(connection.last_synced_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onOpenMappings} className="text-xs">
                <Settings2 className="mr-1 h-3 w-3" /> Configure mappings
              </Button>
              <Button variant="outline" size="sm" onClick={onOpenLog} className="text-xs">
                <ScrollText className="mr-1 h-3 w-3" /> View sync log
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBackfillOpen(true)} className="text-xs">
                <CalendarIcon className="mr-1 h-3 w-3" /> Sync historical data
              </Button>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disconnect.isPending}
                    className="ml-auto text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {disconnect.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      New financial events will stop syncing to {name}. Existing invoices in {name} are untouched.
                      You can reconnect anytime.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await disconnect.mutateAsync(provider);
                        setConfirmOpen(false);
                      }}
                      className="bg-red-600 text-white hover:bg-red-700"
                    >
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
      <AccountingBackfillWizard
        open={backfillOpen}
        provider={provider}
        onClose={() => setBackfillOpen(false)}
        onOpenMappings={onOpenMappings}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect buttons
// ─────────────────────────────────────────────────────────────────────────────

function ConnectXeroButton() {
  const connect = useConnectXero();
  return (
    <Button
      onClick={() => {
        // Pass the current portal origin so the OAuth callback knows where to
        // send the operator back to. Without this the callback would emit a
        // relative /settings path that resolves against the Supabase function
        // host (yields "requested path is invalid").
        const redirectBack = typeof window !== "undefined"
          ? `${window.location.origin}/settings?tab=accounting`
          : undefined;
        connect.mutate({ redirectBack });
      }}
      disabled={connect.isPending}
      className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
    >
      {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Connect Xero <ChevronRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

function ConnectZohoButton() {
  const [regionOpen, setRegionOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setRegionOpen(true)}
        className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
      >
        Connect Zoho <ChevronRight className="ml-1 h-3.5 w-3.5" />
      </Button>
      <ZohoRegionSelector open={regionOpen} onClose={() => setRegionOpen(false)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paywall
// ─────────────────────────────────────────────────────────────────────────────

function FinanceSyncPaywall({ planName, requiredTier }: { planName: string | null; requiredTier: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
          <Calculator className="h-5 w-5 text-indigo-600" />
        </div>
        <h3 className="mt-4 text-base font-medium">
          Finance Sync requires the {requiredTier} tier
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          You&apos;re currently on {planName ?? "the Basic tier"}. Upgrade to {requiredTier} to sync rentals,
          payments, refunds and damages to Xero or Zoho Books automatically.
        </p>
        <Button asChild className="mt-4 bg-[#0f172a] text-white hover:bg-[#0f172a]/90">
          <a href="/settings?tab=subscription">
            View plans <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
