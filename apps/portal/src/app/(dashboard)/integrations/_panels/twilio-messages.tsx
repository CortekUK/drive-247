"use client";

// ── Twilio Messages (SMS) ─────────────────────────────────────────────────────
//
// Everything the operator needs to run outbound and two-way SMS: connect their
// own Twilio account, buy a number or use one they have, see whether it is
// actually working and why not, send a real test, pause sending, disconnect.
//
// THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`). Not connected:
// the shared account + number flow (`twilio-setup.tsx`) IS the screen.
// Connected: one main screen — a picture, a headline, one sentence, one
// button — and the details behind quiet links (Account details with the
// connection test, Send a test, Sending, Delivery, Disconnecting).
//
// SCOPE — SMS only. Twilio Calling is a separate card (`twilio-calling.tsx`)
// that owns the voice app, forwarding, voicemail and recording. The two share
// ONE Twilio account and number, so the number flow is shared too.
//
// There are no test/live modes in this integration — one set of Twilio
// credentials, no sandbox — so `isTestModeUiHidden` has nothing to hide. The
// only mode-shaped fact is the operator's own Twilio trial plan, which only
// ever surfaces as Twilio's verbatim reason a test send was refused.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Loader2, Phone, Send } from "lucide-react";

import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";

import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import { CopyValue, PanelCard, PanelError, PanelLink, PanelLoading, PanelNote, PanelRow, StatusChip } from "./_kit";
import {
  explainErrorCode,
  hasRegistrationProblem,
  useSmsDelivery,
  useTwilioDisconnect,
  useTwilioProbe,
  useTwilioSetEnabled,
  useTwilioSnapshot,
  useTwilioTest,
  type SmsDelivery,
  type TwilioSnapshot,
} from "./twilio-messages-data";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, SubScreen } from "./_screens";
import { useTestText } from "./twilio-test-text";
import { TwilioNumberFlow, demoPause, maskSid, prettyNumber, twilioDemo, useTwilioDemo, type TwilioDemoState } from "./twilio-setup";
import { MessagesEmptyArt } from "@/components/illustrations-v2/scenes/messages";
import { SupportEmptyArt } from "@/components/illustrations-v2/scenes/support";

const TWILIO_COMPLIANCE = "https://console.twilio.com/us1/service/sms/compliance";

/** `manage-twilio-connection` `test`'s own default body — what a test text says. */
const TEST_TEXT = "This is a test SMS from your Drive247 portal. Your Twilio connection is working!";

/* ──────────────────────────────── helpers ───────────────────────────────── */

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The demo's stand-in for the stored row. Never sent anywhere. */
function demoSnapshot(s: TwilioDemoState): TwilioSnapshot {
  return {
    accountSid: s.live ? "AC3f9bxxxxxxxxxxxxxxxxxxxxxxxx5a6b" : null,
    phoneNumber: s.live ? s.number : null,
    phoneNumberSid: s.live ? "PNdemo" : null,
    messagingServiceSid: null,
    enabled: s.smsOn,
    verifiedAt: s.live ? new Date().toISOString() : null,
  };
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

/** The real row, or the demo's stand-in for it on the canary. */
function useSnapshot(tenant: PanelTenant) {
  const real = useTwilioSnapshot(tenant.id);
  const { demo, state } = useTwilioDemo(tenant);
  return {
    demo,
    data: demo ? (real.data ? demoSnapshot(state) : undefined) : real.data,
    isLoading: real.isLoading,
    isError: real.isError,
    error: real.error,
    refetch: real.refetch,
  };
}

/* ─────────────────────────────── status chip ────────────────────────────── */

export function TwilioMessagesStatus({ tenant }: { tenant: PanelTenant }) {
  const snapshot = useSnapshot(tenant);
  const connected = !snapshot.demo && !!snapshot.data?.accountSid && !!snapshot.data?.enabled;
  // Only a real connected tenant has a delivery history worth two reads.
  const delivery = useSmsDelivery(tenant.id, connected);
  const { state, label } = deriveState(snapshot.data, delivery.data, snapshot.isLoading, snapshot.isError);
  return <StatusChip state={state} label={label} />;
}

/* ─────────────────────────────────── panel ──────────────────────────────── */

type Screen = "home" | "change" | "account" | "test" | "sending" | "delivery" | "disconnect";

export default function TwilioMessagesPanel({ tenant, onClose, onBack }: IntegrationPanelProps) {
  const router = useRouter();
  // The rest of the portal reads `integration_twilio_sms` off TenantContext —
  // the booking-site SMS consent checkbox and the Messages page both branch on
  // it — so every write here has to push the context forward too.
  const { refetchTenant } = useTenant();
  const { isAdmin } = useAuth();
  const canManage = isAdmin();

  const snapshot = useSnapshot(tenant);
  const snap = snapshot.data;
  const demo = snapshot.demo;
  const connected = !!snap?.accountSid;
  const delivery = useSmsDelivery(tenant.id, !demo && connected && !!snap?.enabled);

  const probe = useTwilioProbe(tenant.id);
  const testText = useTestText();
  const setEnabled = useTwilioSetEnabled(tenant.id);
  const disconnect = useTwilioDisconnect(tenant.id);

  const [screen, setScreen] = useState<Screen>("home");
  const home = () => setScreen("home");

  // Leaving a sub-screen when the connection it describes goes away.
  useEffect(() => {
    if (!connected && screen !== "home") setScreen("home");
  }, [connected, screen]);

  if (snapshot.isLoading) return <PanelLoading rows={4} />;
  if (snapshot.isError || !snap) {
    return (
      <PanelError
        message={(snapshot.error as Error)?.message ?? "Unknown error"}
        onRetry={() => void snapshot.refetch()}
      />
    );
  }

  const afterConnect = async (phoneNumber: string) => {
    if (!demo) await refetchTenant();
    toast({ title: "Twilio connected", description: `Texts now go out from ${prettyNumber(phoneNumber)}.` });
    home();
  };

  /* ── not connected: the number flow is the screen ──────────────────────── */

  if (!connected) {
    if (!canManage) {
      return (
        <>
          <Hero art={MessagesEmptyArt} title="Twilio isn't connected yet.">
            Only an admin or head admin can connect a Twilio account — ask one of them to open this card.
          </Hero>
          <ScreenNav className="mt-8" onBack={onBack} />
        </>
      );
    }
    return <TwilioNumberFlow tenant={tenant} need="sms" onBack={onBack} onConnected={afterConnect} />;
  }

  /* ── screens behind quiet links ────────────────────────────────────────── */

  if (screen === "change") {
    return <TwilioNumberFlow tenant={tenant} need="sms" useStored onBack={() => setScreen("account")} onConnected={afterConnect} />;
  }

  if (screen === "account") {
    return (
      <SubScreen title="Account details" description="The Twilio account and number your texts go out from." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Twilio account" mono>
            {maskSid(snap.accountSid!)}
          </PanelRow>
          <PanelRow label="Sending number">
            {snap.phoneNumber ? (
              <CopyValue value={snap.phoneNumber} />
            ) : (
              <span className="text-warning">Not set</span>
            )}
          </PanelRow>
          <PanelRow label="Auth token">
            <span className="text-muted-foreground">Stored, never shown</span>
          </PanelRow>
          <PanelRow label="Connected">{formatDate(snap.verifiedAt)}</PanelRow>
        </PanelCard>
        {/* Each step on screen as it runs. Real: `get-status` looks the number
            up on the account and reads where its replies are pointed (it does
            NOT restamp "Connected" — only a connect writes that). The demo
            ends the way a real Send a test does: the text arriving on the
            phone (Ghulam, Oct 2 — "this real kind of test"). */}
        <ConnectionTest
          idle={demo ? "Checks the number and replies, then texts this phone." : "Ask Twilio to confirm the number and where replies go."}
          disabled={!canManage}
          run={
            demo
              ? async (say) => {
                  say("Checking the number with Twilio…");
                  await demoPause(null, 700);
                  say("Checking replies come here…");
                  await demoPause(null, 700);
                  say("Texting this phone…");
                  await demoPause(null, 500);
                  await testText.show(prettyNumber(snap.phoneNumber), TEST_TEXT);
                  return "Working · your test text arrived";
                }
              : async (say) => {
                  say("Checking the number with Twilio…");
                  const r = await probe.mutateAsync();
                  if (!r.confirmed) {
                    throw new Error("Twilio wouldn't confirm this number — the token may have changed or the number was released.");
                  }
                  say("Checking replies come here…");
                  if (r.smsWebhookMatches === false) {
                    throw new Error("Replies aren't pointed at Drive247 — pick the number again to fix it.");
                  }
                  return `Working · Twilio confirmed ${prettyNumber(r.phoneNumber)}, replies come here`;
                }
          }
        />
        {testText.node}
        {canManage && <QuietNav items={[{ label: "Use a different number", onClick: () => setScreen("change") }]} />}
      </SubScreen>
    );
  }

  if (screen === "test") {
    return (
      <SendTest
        tenant={tenant}
        demo={demo}
        from={prettyNumber(snap.phoneNumber)}
        enabled={snap.enabled}
        canManage={canManage}
        onBack={home}
      />
    );
  }

  if (screen === "sending") {
    return (
      <SubScreen title="Sending" onBack={home}>
        <PanelCard className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{snap.enabled ? "On" : "Paused"}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {snap.enabled
                  ? "Booking confirmations, pickup and return reminders, payment alerts, replies from Messages and lockbox codes all go out by text."
                  : "Every outbound text is held back — including the lockbox code, which is how a customer opens the box with the car keys. Customers can still text you; you can't answer."}
              </p>
            </div>
            <Switch
              checked={snap.enabled}
              disabled={!canManage || setEnabled.isPending}
              onCheckedChange={(next) => {
                if (demo) {
                  twilioDemo.patch({ smsOn: next });
                  return;
                }
                setEnabled.mutate(next, {
                  onSuccess: async () => {
                    await refetchTenant();
                    toast({
                      title: next ? "Texts are on" : "Texts paused",
                      description: next ? "Outbound texts send again." : "Your connection is kept — switch it back on any time.",
                    });
                  },
                  onError: (err) =>
                    toast({ title: "Couldn't change sending", description: (err as Error)?.message, variant: "destructive" }),
                });
              }}
            />
          </div>
        </PanelCard>
      </SubScreen>
    );
  }

  if (screen === "delivery") {
    return (
      <SubScreen
        title="Delivery"
        description="What carriers did with the texts you sent from Messages."
        onBack={home}
      >
        <DeliveryBody delivery={delivery.data} loading={delivery.isLoading} />
      </SubScreen>
    );
  }

  if (screen === "disconnect") {
    return (
      <DisconnectScreen
        name="Twilio"
        canManage={canManage}
        pending={disconnect.isPending}
        onBack={home}
        onConfirm={() => {
          if (demo) {
            twilioDemo.reset();
            return;
          }
          disconnect.mutate(undefined, {
            onSuccess: async () => {
              await refetchTenant();
              toast({ title: "Twilio disconnected", description: "Texts are off and the credentials are removed." });
            },
            onError: (err) =>
              toast({ title: "Couldn't disconnect", description: (err as Error)?.message, variant: "destructive" }),
          });
        }}
        consequence={
          <>
            Texts stop straight away, and so do calls — they share this account. Your Twilio account, your number and
            your message history stay as they are; connecting again needs your auth token.
          </>
        }
      />
    );
  }

  /* ── the main screen ───────────────────────────────────────────────────── */

  const { label } = deriveState(snap, delivery.data, false, false);
  const blocked = label === "Carrier blocked";
  const failing = label === "Messages failing";
  const number = prettyNumber(snap.phoneNumber);

  const title = !snap.phoneNumber
    ? "There's no number to text from."
    : !snap.enabled
      ? "Texts are paused."
      : blocked
        ? "Carriers are turning your texts away."
        : failing
          ? "Your last text didn't arrive."
          : `You're texting from ${number}.`;

  const body = !snap.phoneNumber
    ? "Pick a number and I'll point it at Drive247 — until then every text fails."
    : !snap.enabled
      ? "Nothing goes out by text until you switch sending back on. Replies still arrive."
      : blocked
        ? "This number isn't registered for A2P 10DLC, so US carriers drop what it sends. Register it in your Twilio console — I'll go green as soon as a text gets through."
        : failing
          ? "Twilio couldn't deliver it. The Delivery screen has what carriers said."
          : "Confirmations, reminders and updates go out from this number, and replies land in Messages.";

  const action = !snap.phoneNumber ? (
    <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("change")} disabled={!canManage}>
      <Phone /> Pick a number
    </Button>
  ) : !snap.enabled ? (
    <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("sending")}>
      Turn texts back on <ArrowRight />
    </Button>
  ) : blocked ? (
    <Button className="h-10 rounded-2xl px-6" asChild>
      <a href={TWILIO_COMPLIANCE} target="_blank" rel="noopener noreferrer">
        Register in Twilio <ArrowUpRight />
      </a>
    </Button>
  ) : (
    <Button
      className="h-10 rounded-2xl px-6"
      onClick={() => {
        router.push("/messages");
        onClose();
      }}
    >
      Open Messages <ArrowRight />
    </Button>
  );

  const links = [
    { label: "Account details", onClick: () => setScreen("account") },
    { label: "Send a test", onClick: () => setScreen("test") },
    { label: "Sending", onClick: () => setScreen("sending") },
    ...(!demo && (delivery.data?.sampled ?? 0) > 0 ? [{ label: "Delivery", onClick: () => setScreen("delivery") }] : []),
    ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
  ];

  return (
    <>
      <Hero
        art={blocked || failing ? SupportEmptyArt : MessagesEmptyArt}
        eyebrow={label ?? "Live"}
        title={title}
        actions={<div className="flex justify-center">{action}</div>}
        footer={<QuietNav items={links} />}
      >
        {body}
      </Hero>
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}

/* ─────────────────────────────── send a test ────────────────────────────── */

/** A real text, from the tenant's number, billed to the tenant's Twilio account. */
function SendTest({
  tenant,
  demo,
  from,
  enabled,
  canManage,
  onBack,
}: {
  tenant: PanelTenant;
  demo: boolean;
  from: string;
  enabled: boolean;
  canManage: boolean;
  onBack: () => void;
}) {
  const test = useTwilioTest(tenant.id);
  const testText = useTestText();
  const [to, setTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const valid = /^\+[1-9]\d{7,14}$/.test(to);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      if (demo) await demoPause(null, 1200);
      else await test.mutateAsync({ to });
      setResult({ ok: true, text: `Twilio accepted it — check ${prettyNumber(to)}.` });
      // The phone, showing the text as it lands (the edge function's own
      // default wording, which is exactly what was sent).
      void testText.show(from, TEST_TEXT);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Twilio refused the text." });
    } finally {
      setSending(false);
    }
  };

  return (
    <SubScreen
      title="Send a test"
      description="A real text from your number, billed by Twilio like any other."
      onBack={onBack}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && enabled && canManage && !sending) void send();
        }}
      >
        <span className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-input bg-background px-3.5 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30">
          <Phone className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/[^\d+]/g, ""))}
            placeholder="Your mobile, like +14155551234"
            inputMode="tel"
            aria-label="Send the test to"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&:not(:placeholder-shown)]:font-mono placeholder:text-muted-foreground/70"
          />
        </span>
        <Button type="submit" className="h-11 shrink-0 rounded-2xl px-5" disabled={!valid || !enabled || !canManage || sending}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send
        </Button>
      </form>
      <p
        className={
          result ? (result.ok ? "text-sm text-success" : "text-sm text-destructive") : "text-xs text-muted-foreground"
        }
      >
        {result
          ? result.text
          : !enabled
            ? "Sending is paused, so test texts are held back too."
            : "On a Twilio trial account, texts only reach numbers you've verified in Twilio."}
      </p>
      {testText.node}
    </SubScreen>
  );
}

/* ──────────────────── delivery + carrier registration ───────────────────── */

/**
 * The honest answer to "are my messages arriving?". A2P 10DLC registration
 * lives in the operator's own Twilio console and is never reported to us, so
 * this shows the one thing we DO hold — Twilio's verdict on each chat text we
 * sent — and says what it covers.
 */
function DeliveryBody({ delivery, loading }: { delivery: SmsDelivery | undefined; loading: boolean }) {
  if (loading) return <PanelLoading rows={2} />;
  if (!delivery || delivery.sampled === 0) {
    return <PanelNote>No texts have been sent from Messages yet, so there&rsquo;s nothing to judge.</PanelNote>;
  }
  const blockedNow = hasRegistrationProblem(delivery);
  const reasons = delivery.reasonsUnavailable ? [] : delivery.reasons.slice(0, 2);
  return (
    <>
      <PanelCard className="divide-y divide-border/60">
        <PanelRow label="Last texts" hint={`${formatDate(delivery.oldestAt)} – ${formatDate(delivery.newestAt)}`}>
          {delivery.sampled}
        </PanelRow>
        <PanelRow label="Delivered">{delivery.delivered}</PanelRow>
        <PanelRow label="Turned away">
          <span className={delivery.failed > 0 ? "text-warning" : undefined}>{delivery.failed}</span>
        </PanelRow>
      </PanelCard>
      {/* The tense is the point: "now" matches the chip, history does not. */}
      {(blockedNow || delivery.failingNow || delivery.failed > 0) && (
        <PanelNote tone={blockedNow ? "danger" : delivery.failingNow ? "warn" : "info"}>
          {blockedNow
            ? "Carriers are blocking your texts right now."
            : delivery.failingNow
              ? "Your most recent text didn't arrive."
              : "Your most recent text got through."}
          {reasons.map((r) => (
            <span key={r.code} className="mt-1 block">
              {explainErrorCode(r.code).text} ({r.count}&times;, error {r.code})
            </span>
          ))}
          {delivery.reasonsUnavailable && delivery.failed > 0 && (
            <span className="mt-1 block">Twilio&rsquo;s reasons aren&rsquo;t readable from this login.</span>
          )}
          {blockedNow && (
            <span className="mt-1 block">
              Fix it under <PanelLink href={TWILIO_COMPLIANCE}>Regulatory compliance</PanelLink> in Twilio.
            </span>
          )}
        </PanelNote>
      )}
    </>
  );
}
