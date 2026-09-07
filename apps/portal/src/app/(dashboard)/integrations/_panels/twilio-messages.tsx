"use client";

// ── Twilio Messages (SMS) ─────────────────────────────────────────────────────
//
// Everything the operator needs to run outbound and two-way SMS: connect their
// own Twilio account, see whether it is actually working, find out when it is
// not and why, send a real test, pause sending, and disconnect.
//
// SCOPE — SMS only. Twilio Calling is a separate card with a separate panel
// (`twilio-calling.tsx`) and owns the TwiML app, call forwarding, voicemail and
// recording. The two integrations share ONE Twilio account, and the account
// credentials belong here: this panel enters them, verifies them and clears
// them. Calling assumes they already exist. WhatsApp
// (`integration_twilio_whatsapp`) is a third thing again and is not touched.
//
// There are no test/live modes in this integration — no Drive247 mode column,
// no sandbox endpoint, one set of Twilio credentials — so `isTestModeUiHidden`
// has nothing to hide here and is deliberately not consulted. The only
// mode-shaped fact on screen is the operator's OWN Twilio account being on a
// trial plan, which is Twilio's state, not ours, and only ever surfaces as the
// verbatim reason a test send was refused.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Switch } from "@/components/ui-v2/switch";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui-v2/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";

import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
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
  explainErrorCode,
  hasRegistrationProblem,
  useSmsDelivery,
  useTwilioConnect,
  useTwilioDisconnect,
  useTwilioProbe,
  useTwilioSetEnabled,
  useTwilioSnapshot,
  useTwilioTest,
  type SmsDelivery,
  type TwilioSnapshot,
} from "./twilio-messages-data";

// The two URLs `manage-twilio-connection` writes onto the number at connect
// time. Shown so an operator who later edits their number in the Twilio console
// can put them back without a support ticket.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const INBOUND_WEBHOOK = `${SUPABASE_URL}/functions/v1/twilio-inbound-sms`;
const STATUS_WEBHOOK = `${SUPABASE_URL}/functions/v1/twilio-sms-status`;

const TWILIO_CONSOLE = "https://console.twilio.com";
const TWILIO_NUMBERS = "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming";
const TWILIO_COMPLIANCE = "https://console.twilio.com/us1/service/sms/compliance";

/* ──────────────────────────────── helpers ───────────────────────────────── */

/** `AC1234…7f9c`. The SID is a username, not a secret, but there is no reason to print it whole. */
function maskSid(sid: string): string {
  return sid.length > 12 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The one place the card's word is decided, so the chip and the dialog can
 * never disagree.
 *
 * Note what does NOT collapse into "Connected": credentials stored but sending
 * switched off, and credentials perfect but carriers rejecting the messages.
 * The second is the whole reason `attention` exists — an unregistered A2P 10DLC
 * campaign fails silently, and the operator otherwise learns about it from a
 * customer who never got their booking confirmation.
 */
function deriveState(
  snapshot: TwilioSnapshot | undefined,
  delivery: SmsDelivery | undefined,
  isLoading: boolean,
  isError: boolean,
): { state: IntegrationState; label?: string } {
  // A failed read is not a disconnected integration. Saying "Not connected"
  // here would invite a reconnect that overwrites credentials that are fine.
  if (isError) return { state: "attention", label: "Status unavailable" };
  if (isLoading || !snapshot) return { state: "loading" };
  if (!snapshot.accountSid) return { state: "disconnected" };
  if (!snapshot.phoneNumber) return { state: "attention", label: "No sending number" };
  if (!snapshot.enabled) return { state: "attention", label: "Sending paused" };
  if (hasRegistrationProblem(delivery)) return { state: "attention", label: "Carrier blocked" };
  if (delivery?.failingNow) return { state: "attention", label: "Messages failing" };
  return { state: "connected" };
}

/* ─────────────────────────────── status chip ────────────────────────────── */

export function TwilioMessagesStatus({ tenant }: { tenant: PanelTenant }) {
  const snapshot = useTwilioSnapshot(tenant.id);
  const connected = !!snapshot.data?.accountSid && !!snapshot.data?.enabled;
  // Only a connected tenant has a delivery history worth two reads. Northwind
  // has no Twilio account at all, so this never fires on the canary today.
  const delivery = useSmsDelivery(tenant.id, connected);

  const { state, label } = deriveState(
    snapshot.data,
    delivery.data,
    snapshot.isLoading,
    snapshot.isError,
  );
  return <StatusChip state={state} label={label} />;
}

/* ─────────────────────────────────── panel ──────────────────────────────── */

export default function TwilioMessagesPanel({ tenant, onClose }: IntegrationPanelProps) {
  const router = useRouter();
  // The rest of the portal reads `integration_twilio_sms` off TenantContext —
  // the booking-site SMS consent checkbox and the Messages page both branch on
  // it — so every write here has to push the context forward too.
  const { refetchTenant } = useTenant();
  const { isAdmin } = useAuth();
  const canManage = isAdmin();

  const snapshot = useTwilioSnapshot(tenant.id);
  const snap = snapshot.data;
  const connected = !!snap?.accountSid;
  const delivery = useSmsDelivery(tenant.id, connected && !!snap?.enabled);

  if (snapshot.isLoading) return <PanelLoading rows={4} />;
  if (snapshot.isError) {
    return (
      <PanelError
        message={(snapshot.error as Error)?.message ?? "Unknown error"}
        onRetry={() => snapshot.refetch()}
      />
    );
  }

  return connected ? (
    <ConnectedPanel
      tenant={tenant}
      snapshot={snap!}
      delivery={delivery.data}
      deliveryLoading={delivery.isLoading}
      canManage={canManage}
      refetchTenant={refetchTenant}
      onOpenMessages={() => {
        router.push("/messages");
        onClose();
      }}
    />
  ) : (
    <ConnectPanel tenant={tenant} canManage={canManage} refetchTenant={refetchTenant} />
  );
}

/* ─────────────────────────── not connected yet ──────────────────────────── */

/**
 * The first screen a new operator sees, and the one that decides whether SMS
 * ever gets switched on. Northwind is here today: every Twilio column is null.
 *
 * It asks for exactly what the send path uses — Account SID, Auth Token, and a
 * number that already exists on that account — and nothing else. There is no
 * field for a Messaging Service SID: `sendTenantSMS` always posts `From` = the
 * stored number, and `tenants.twilio_messaging_service_sid` is null for all 57
 * tenants with no code reading it. A field that changed nothing would be worse
 * than no field.
 */
function ConnectPanel({
  tenant,
  canManage,
  refetchTenant,
}: {
  tenant: PanelTenant;
  canManage: boolean;
  refetchTenant: () => Promise<void>;
}) {
  const connect = useTwilioConnect(tenant.id);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const sidLooksWrong = accountSid.length > 0 && !accountSid.startsWith("AC");
  const phoneLooksWrong = phoneNumber.length > 0 && !phoneNumber.startsWith("+");
  const ready =
    !!accountSid && !!authToken && !!phoneNumber && !sidLooksWrong && !phoneLooksWrong;

  // No local "connected!" screen: a successful connect invalidates the snapshot,
  // the parent re-reads it, and this component unmounts in favour of the
  // connected panel. Anything rendered here on success would flash and vanish.
  return (
    <div className="space-y-5">
      <PanelNote>
        Drive247 sends SMS through <span className="font-medium text-foreground">your own</span>{" "}
        Twilio account. You keep the number, Twilio bills you directly, and disconnecting here
        never touches either.
      </PanelNote>

      <PanelSection
        title="Before you connect"
        description="Three things to have ready. About ten minutes in the Twilio console."
      >
        <PanelCard className="space-y-2.5 py-3">
          <SetupStep n={1}>
            A Twilio account — <PanelLink href="https://www.twilio.com/try-twilio">sign up</PanelLink>{" "}
            if you do not have one.
          </SetupStep>
          <SetupStep n={2}>
            A phone number on that account with <span className="text-foreground">SMS</span>{" "}
            enabled, from{" "}
            <PanelLink href={TWILIO_NUMBERS}>Phone Numbers &rarr; Active numbers</PanelLink>.
          </SetupStep>
          <SetupStep n={3}>
            The <span className="text-foreground">Account SID</span> and{" "}
            <span className="text-foreground">Auth Token</span> from the{" "}
            <PanelLink href={TWILIO_CONSOLE}>console home page</PanelLink>. The token is hidden
            until you click to reveal it.
          </SetupStep>
        </PanelCard>
      </PanelSection>

      <PanelSection title="Twilio credentials">
        <div className="space-y-3">
          <Field
            id="twilio-sms-sid"
            label="Account SID"
            hint={sidLooksWrong ? "An Account SID starts with “AC”." : "Starts with “AC”."}
            invalid={sidLooksWrong}
          >
            <Input
              id="twilio-sms-sid"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value.trim())}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-[13px]"
              autoComplete="off"
              disabled={!canManage}
            />
          </Field>

          <Field
            id="twilio-sms-token"
            label="Auth Token"
            hint="Stored for this account only. It is never shown back on this screen."
          >
            <Input
              id="twilio-sms-token"
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value.trim())}
              placeholder="••••••••••••••••••••••••••••••••"
              className="font-mono text-[13px]"
              autoComplete="off"
              disabled={!canManage}
            />
          </Field>

          <Field
            id="twilio-sms-number"
            label="Sending number"
            hint={
              phoneLooksWrong
                ? "Include the country code, starting with “+”."
                : "The number customers will see. E.164, e.g. +14155551234."
            }
            invalid={phoneLooksWrong}
          >
            <Input
              id="twilio-sms-number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.trim())}
              placeholder="+14155551234"
              className="font-mono text-[13px]"
              autoComplete="off"
              disabled={!canManage}
            />
          </Field>
        </div>
      </PanelSection>

      {/* The edge function enforces this too (head_admin/admin only); saying so
          up front beats a 403 after the operator has typed a live auth token. */}
      {!canManage && (
        <PanelNote>Connecting Twilio needs an admin or head admin account.</PanelNote>
      )}

      {connect.isError && (
        <PanelNote tone="warn">
          Twilio refused the connection, so nothing was saved.
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {(connect.error as Error)?.message}
          </span>
        </PanelNote>
      )}

      <Button
        className="w-full"
        disabled={!ready || !canManage || connect.isPending}
        onClick={() =>
          connect.mutate(
            { accountSid, authToken, phoneNumber },
            {
              onSuccess: async (data) => {
                // Clear the token from component state the moment it is no
                // longer needed — it stays in the DOM otherwise.
                setAuthToken("");
                await refetchTenant();
                toast({
                  title: "Twilio connected",
                  description: `${data?.friendlyName || "Your Twilio account"} is now sending SMS from ${data?.phoneNumber || phoneNumber}.`,
                });
              },
            },
          )
        }
      >
        {connect.isPending ? (
          <>
            <Loader2 className="animate-spin" /> Verifying with Twilio…
          </>
        ) : (
          "Connect Twilio"
        )}
      </Button>

      <PanelSection title="What happens when you connect">
        <PanelCard className="space-y-1.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <p>&bull; We check the credentials against Twilio before saving anything.</p>
          <p>&bull; We confirm the number is on that account and can send SMS.</p>
          <p>
            &bull; We point Twilio at Drive247 for incoming replies and delivery receipts, so
            two-way chat works straight away.
          </p>
          {/* Accurate, and the inaccuracy would matter: `manage-twilio-connection`
              catches a webhook failure and warns rather than aborting, so a
              connection CAN be saved with the webhooks unset — which looks
              perfect until a customer replies and nothing arrives. */}
          <p>
            &bull; If the credentials or the number are refused, nothing is stored. If only the
            webhook step fails, the connection is still saved and you can apply the URLs by hand
            from this panel afterwards.
          </p>
        </PanelCard>
      </PanelSection>

      <PanelNote tone="warn">
        <span className="font-medium">Sending to the US or Canada?</span> Carriers there reject
        messages from numbers that are not registered for A2P 10DLC — silently, even with
        everything above correct. Complete the one-off registration under{" "}
        <PanelLink href={TWILIO_COMPLIANCE}>Messaging &rarr; Regulatory compliance</PanelLink> in
        your Twilio console. It takes about fifteen minutes plus a few days of carrier review.
      </PanelNote>
    </div>
  );
}

/* ───────────────────────────── connected ────────────────────────────────── */

function ConnectedPanel({
  tenant,
  snapshot,
  delivery,
  deliveryLoading,
  canManage,
  refetchTenant,
  onOpenMessages,
}: {
  tenant: PanelTenant;
  snapshot: TwilioSnapshot;
  delivery: SmsDelivery | undefined;
  deliveryLoading: boolean;
  canManage: boolean;
  refetchTenant: () => Promise<void>;
  onOpenMessages: () => void;
}) {
  const probe = useTwilioProbe(tenant.id);
  const test = useTwilioTest(tenant.id);
  const setEnabled = useTwilioSetEnabled(tenant.id);
  const disconnect = useTwilioDisconnect(tenant.id);

  const [testTo, setTestTo] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  return (
    <div className="space-y-5">
      {/* Every action below goes through `manage-twilio-connection`, which
          refuses anything but head_admin/admin, or writes to `tenants`. The
          figures are readable by anyone; say once why the controls are not. */}
      {!canManage && (
        <PanelNote>
          You can see this connection but not change it — that needs an admin or head admin
          account.
        </PanelNote>
      )}

      {/* ── the connection itself ── */}
      <PanelSection
        title="Connection"
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage || probe.isPending}
            onClick={() => probe.mutate()}
          >
            {probe.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check
          </Button>
        }
      >
        <PanelCard>
          <PanelRow label="Twilio account" mono>
            {maskSid(snapshot.accountSid!)}
          </PanelRow>
          <PanelRow label="Auth token">
            <span className="text-muted-foreground">Stored</span>
          </PanelRow>
          <PanelRow label="Sending number" hint="What customers see the message come from.">
            {snapshot.phoneNumber ? (
              <CopyValue value={snapshot.phoneNumber} />
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </PanelRow>
          <PanelRow
            label="Credentials verified"
            hint="Stamped when they were last entered and accepted by Twilio."
          >
            {formatDate(snapshot.verifiedAt)}
          </PanelRow>
        </PanelCard>

        {!snapshot.phoneNumber && (
          <PanelNote tone="danger">
            No sending number is stored, so every outbound message will fail. Re-enter your
            credentials below with the number you want to send from.
          </PanelNote>
        )}

        {/* The probe is a live Twilio call, not a database read — `get-status`
            looks up the number on the account. It deliberately does NOT restamp
            "Credentials verified" above: only the connect flow writes that
            column, and quietly widening its meaning would change what the v1
            Settings screen claims for the same tenant. */}
        {probe.isError && (
          <PanelNote tone="warn">
            Could not reach Twilio to check. Nothing has been changed.
            <span className="mt-1 block font-mono text-[11px] opacity-80">
              {(probe.error as Error)?.message}
            </span>
          </PanelNote>
        )}
        {probe.data &&
          (probe.data.confirmed ? (
            <PanelNote>
              <CheckCircle2 className="mr-1.5 inline size-3.5 -translate-y-px text-success" />
              Twilio confirmed {probe.data.phoneNumber} just now
              {probe.data.capabilities && (
                <>
                  {" "}
                  &middot; SMS {probe.data.capabilities.sms ? "yes" : "no"}, MMS{" "}
                  {probe.data.capabilities.mms ? "yes" : "no"}
                </>
              )}
              .
            </PanelNote>
          ) : (
            <PanelNote tone="danger">
              Twilio would not confirm this number. The auth token may have been rotated, the
              number released, or the account suspended. Re-enter your credentials below.
            </PanelNote>
          ))}
      </PanelSection>

      <DeliverySection delivery={delivery} loading={deliveryLoading} enabled={snapshot.enabled} />

      {/* ── test send ── */}
      <PanelSection
        title="Send a test message"
        description="A real SMS from your number, billed by Twilio like any other."
      >
        <div className="space-y-2.5">
          <Input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value.trim())}
            placeholder="+14155551234"
            className="font-mono text-[13px]"
            aria-label="Test recipient"
          />
          <Textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Optional — leave blank for a default test message"
            rows={2}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage || !testTo || !snapshot.enabled || test.isPending}
            onClick={() =>
              test.mutate(
                { to: testTo, message: testMessage },
                {
                  onSuccess: () =>
                    toast({
                      title: "Test message sent",
                      description: `Twilio accepted the message to ${testTo}.`,
                    }),
                },
              )
            }
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Send test
          </Button>
          {!snapshot.enabled && (
            <p className="text-xs text-muted-foreground">
              Sending is paused, so test messages are refused too.
            </p>
          )}
          {test.isError && (
            <PanelNote tone="warn">
              Twilio refused the message.
              <span className="mt-1 block font-mono text-[11px] opacity-80">
                {(test.error as Error)?.message}
              </span>
              <span className="mt-1.5 block opacity-90">
                On a Twilio trial account you can only send to numbers you have verified under
                Phone Numbers &rarr; Verified Caller IDs.
              </span>
            </PanelNote>
          )}
        </div>
      </PanelSection>

      {/* ── master switch ── */}
      <PanelSection title="SMS sending">
        <PanelCard className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-foreground">
                {snapshot.enabled ? "On" : "Paused"}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {snapshot.enabled
                  ? "Booking confirmations, pickup and return reminders, payment alerts, replies from the Messages page and lockbox codes all go out over SMS."
                  : "Every outbound SMS is refused: booking confirmations, pickup and return reminders, payment alerts, replies from the Messages page — and the lockbox code, which is how a customer opens the box holding the car keys. Customers can still text you and their messages still arrive; you cannot answer them."}
              </p>
            </div>
            <Switch
              checked={snapshot.enabled}
              disabled={!canManage || setEnabled.isPending}
              onCheckedChange={(next) =>
                setEnabled.mutate(next, {
                  onSuccess: async () => {
                    await refetchTenant();
                    toast({
                      title: next ? "SMS switched on" : "SMS paused",
                      description: next
                        ? "Outbound messages will send again."
                        : "Your credentials are kept — switch it back on at any time.",
                    });
                  },
                  onError: (err) =>
                    toast({
                      title: "Could not change SMS",
                      description: (err as Error)?.message,
                      variant: "destructive",
                    }),
                })
              }
            />
          </div>
        </PanelCard>
        {snapshot.enabled && (
          <button
            type="button"
            onClick={onOpenMessages}
            className="text-sm text-primary hover:underline"
          >
            Open Messages &rarr;
          </button>
        )}
      </PanelSection>

      {/* ── webhooks ── */}
      <Disclosure label="Webhook URLs">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Set on your number automatically when you connected. If you edit the number in the
          Twilio console and replies or delivery receipts stop arriving, put these back.
        </p>
        <PanelCard className="space-y-2.5">
          <div>
            <p className="text-[11px] text-muted-foreground">A message comes in</p>
            <CopyValue value={INBOUND_WEBHOOK} className="mt-0.5 text-[11px]" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Status callback</p>
            <CopyValue value={STATUS_WEBHOOK} className="mt-0.5 text-[11px]" />
          </div>
        </PanelCard>
      </Disclosure>

      {/* ── replace credentials ── */}
      <Disclosure label="Replace credentials">
        <ReplaceCredentials
          tenant={tenant}
          currentSid={snapshot.accountSid!}
          currentNumber={snapshot.phoneNumber}
          canManage={canManage}
          refetchTenant={refetchTenant}
        />
      </Disclosure>

      {/* ── disconnect ── */}
      <PanelSection title="Disconnect">
        {confirmDisconnect ? (
          <div className="space-y-2.5">
            <PanelNote tone="danger">
              Drive247 will forget your Account SID, auth token and number, and SMS will stop
              immediately. Your Twilio account, your number and your message history are not
              touched — you can reconnect whenever you like, but you will need the auth token
              again.
            </PanelNote>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, {
                    onSuccess: async () => {
                      await refetchTenant();
                      setConfirmDisconnect(false);
                      toast({
                        title: "Twilio disconnected",
                        description: "SMS is off and the credentials have been removed.",
                      });
                    },
                    onError: (err) =>
                      toast({
                        title: "Could not disconnect",
                        description: (err as Error)?.message,
                        variant: "destructive",
                      }),
                  })
                }
              >
                {disconnect.isPending ? <Loader2 className="animate-spin" /> : <Unplug />}
                Yes, disconnect
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage}
            onClick={() => setConfirmDisconnect(true)}
          >
            <Unplug />
            Disconnect Twilio
          </Button>
        )}
      </PanelSection>
    </div>
  );
}

/* ──────────────────── delivery + carrier registration ───────────────────── */

/**
 * The honest answer to "are my messages arriving?".
 *
 * A2P 10DLC registration status is NOT in our database and cannot be. The
 * `twilio_brand_status` / `twilio_campaign_status` columns that once cached it
 * were dropped in 20260410120001 when the product moved to bring-your-own
 * Twilio: operators register in their own console and we are never told the
 * outcome. So this section does not claim to know, and says so — while
 * surfacing the one thing we DO hold, which is Twilio's verdict on each message
 * we sent. A run of 30034s is what an unregistered campaign looks like from
 * this side of the wire.
 */
function DeliverySection({
  delivery,
  loading,
  enabled,
}: {
  delivery: SmsDelivery | undefined;
  loading: boolean;
  enabled: boolean;
}) {
  if (!enabled) return null;

  const registrationReasons =
    delivery?.reasons.filter((r) => explainErrorCode(r.code).registration) ?? [];
  // Same predicate the card's chip uses, so the two can never disagree.
  const blockedNow = hasRegistrationProblem(delivery);

  return (
    <PanelSection
      title="Delivery & carrier registration"
      description="Drive247 cannot read your A2P 10DLC registration — that lives in your Twilio console. What it can show is what carriers did with the messages you sent."
    >
      {loading ? (
        <PanelLoading rows={1} />
      ) : !delivery || delivery.sampled === 0 ? (
        <PanelNote>
          No two-way chat messages have been sent yet, so there is nothing to judge. If you send
          to US or Canadian numbers, register for A2P 10DLC under{" "}
          <PanelLink href={TWILIO_COMPLIANCE}>Messaging &rarr; Regulatory compliance</PanelLink>{" "}
          before you rely on it — carriers reject unregistered traffic without telling the sender.
        </PanelNote>
      ) : (
        <div className="space-y-2.5">
          <PanelCard>
            <PanelRow
              label="Last messages"
              hint={`${formatDate(delivery.oldestAt)} – ${formatDate(delivery.newestAt)}`}
            >
              {delivery.sampled}
            </PanelRow>
            <PanelRow label="Delivered">{delivery.delivered}</PanelRow>
            <PanelRow label="Rejected">
              <span className={delivery.failed > 0 ? "text-warning" : undefined}>
                {delivery.failed}
              </span>
            </PanelRow>
            {delivery.pending > 0 && (
              <PanelRow label="Awaiting a receipt">{delivery.pending}</PanelRow>
            )}
          </PanelCard>

          {/* Three mutually exclusive verdicts, and the tense of each is the
              point. `blockedNow` and `failingNow` describe the CURRENT state
              and match the card's chip; the third is history, and reading it
              in the present tense would send an operator to re-fix something
              they already fixed. */}
          {blockedNow ? (
            <PanelNote tone="danger">
              <AlertTriangle className="mr-1.5 inline size-3.5 -translate-y-px" />
              <span className="font-medium">Carriers are blocking your messages.</span>
              {registrationReasons.map((r) => (
                <span key={r.code} className="mt-1 block">
                  {explainErrorCode(r.code).text} ({r.count}&times; in this sample, Twilio error{" "}
                  {r.code})
                </span>
              ))}
              <span className="mt-1.5 block">
                Fix it under{" "}
                <PanelLink href={TWILIO_COMPLIANCE}>
                  Messaging &rarr; Regulatory compliance
                </PanelLink>{" "}
                in your Twilio console. Nothing on this screen can clear it for you.
              </span>
            </PanelNote>
          ) : delivery.failingNow ? (
            <PanelNote tone="warn">
              <span className="font-medium">Your most recent message did not arrive.</span>
              {delivery.reasonsUnavailable ? (
                <span className="mt-1 block">
                  Twilio&rsquo;s reason codes are not readable from this login, so the cause
                  cannot be named here. Check Monitor &rarr; Logs &rarr; Messaging in your Twilio
                  console.
                </span>
              ) : (
                delivery.reasons.map((r) => (
                  <span key={r.code} className="mt-1 block">
                    {explainErrorCode(r.code).text} ({r.count}&times;, Twilio error {r.code})
                  </span>
                ))
              )}
            </PanelNote>
          ) : delivery.failed > 0 ? (
            <PanelNote>
              {delivery.failed} of these {delivery.sampled} were rejected
              {delivery.newestFailureAt &&
                `, the last on ${formatDate(delivery.newestFailureAt)}`}
              , but your most recent message got through.
              {!delivery.reasonsUnavailable &&
                delivery.reasons.map((r) => (
                  <span key={r.code} className="mt-1 block">
                    {explainErrorCode(r.code).text} ({r.count}&times;, Twilio error {r.code})
                  </span>
                ))}
            </PanelNote>
          ) : null}

          {/* Stated rather than hidden: these figures cover the Messages page
              only. The 16 notify-* senders call sendTenantSMS directly and
              write no message row, so their delivery receipts arrive with no
              tenant attached (67 of 131 rows in production) and cannot honestly
              be counted here. */}
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            Counts cover two-way chat messages. Automated notifications are sent the same way but
            are not recorded per tenant, so they are not included.
          </p>
        </div>
      )}
    </PanelSection>
  );
}

/* ───────────────────────── replace credentials ──────────────────────────── */

/**
 * Rotating the auth token, moving to a different number, or repairing a
 * connection Twilio no longer accepts.
 *
 * It re-runs the same `connect` action, which is the only path that re-verifies
 * against Twilio and restamps `twilio_connection_verified_at`. The token has to
 * be typed again because we never send a stored one back to the browser — that
 * is the point, not an oversight.
 */
function ReplaceCredentials({
  tenant,
  currentSid,
  currentNumber,
  canManage,
  refetchTenant,
}: {
  tenant: PanelTenant;
  currentSid: string;
  currentNumber: string | null;
  canManage: boolean;
  refetchTenant: () => Promise<void>;
}) {
  const connect = useTwilioConnect(tenant.id);
  const [accountSid, setAccountSid] = useState(currentSid);
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState(currentNumber ?? "");

  const ready = !!accountSid && !!authToken && !!phoneNumber;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Enter the auth token again to re-verify. Nothing is saved unless Twilio accepts all
        three, so a wrong value cannot break a working connection.
      </p>
      <Field id="twilio-sms-sid-2" label="Account SID">
        <Input
          id="twilio-sms-sid-2"
          value={accountSid}
          onChange={(e) => setAccountSid(e.target.value.trim())}
          className="font-mono text-[13px]"
          autoComplete="off"
          disabled={!canManage}
        />
      </Field>
      <Field id="twilio-sms-token-2" label="Auth Token">
        <Input
          id="twilio-sms-token-2"
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value.trim())}
          placeholder="••••••••••••••••••••••••••••••••"
          className="font-mono text-[13px]"
          autoComplete="off"
          disabled={!canManage}
        />
      </Field>
      <Field id="twilio-sms-number-2" label="Sending number">
        <Input
          id="twilio-sms-number-2"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value.trim())}
          className="font-mono text-[13px]"
          autoComplete="off"
          disabled={!canManage}
        />
      </Field>
      {connect.isError && (
        <PanelNote tone="warn">
          Twilio refused these credentials, so the stored ones are unchanged.
          <span className="mt-1 block font-mono text-[11px] opacity-80">
            {(connect.error as Error)?.message}
          </span>
        </PanelNote>
      )}
      <Button
        size="sm"
        disabled={!ready || !canManage || connect.isPending}
        onClick={() =>
          connect.mutate(
            { accountSid, authToken, phoneNumber },
            {
              onSuccess: async () => {
                setAuthToken("");
                await refetchTenant();
                toast({
                  title: "Credentials updated",
                  description: "Twilio accepted them and the webhooks were re-applied.",
                });
              },
            },
          )
        }
      >
        {connect.isPending ? <Loader2 className="animate-spin" /> : null}
        Verify &amp; save
      </Button>
    </div>
  );
}

/* ────────────────────────────── small pieces ────────────────────────────── */

function Field({
  id,
  label,
  hint,
  invalid,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && (
        <p className={`text-[11px] leading-snug ${invalid ? "text-warning" : "text-muted-foreground/70"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function SetupStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * A collapsed block for the controls an operator needs rarely, in a narrow dialog.
 *
 * `children` is typed against the UMD `React` global rather than the `ReactNode`
 * imported above. Two copies of `@types/react` are resolvable here (the app's
 * own and the hoisted root one), and Radix's `CollapsibleContent` is compiled
 * against the other one — so the imported alias is rejected where the global is
 * accepted. Same clash already visible in `rentals/[id]/page.tsx`.
 */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted/40">
        {label}
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
