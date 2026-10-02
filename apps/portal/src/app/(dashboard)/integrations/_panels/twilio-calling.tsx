"use client";

// ── Twilio Calling ────────────────────────────────────────────────────────────
//
// Inbound call handling on the operator's Twilio number: ringing the browser
// and a real phone (showing the caller or the business line), voicemail when
// nobody picks up, and call recording with the AI summary that follows it.
//
// THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`). No Twilio
// account yet: the shared account + number flow (`twilio-setup.tsx`) — buy a
// number or use one you have — and calling is switched on the moment the
// number is in. Account but calling off: one screen, one button. On: one main
// screen and the rest behind quiet links (Account details with the connection
// test, Forwarding & business line, Voicemail, Recording, Recent calls,
// Disconnecting).
//
// ONE ACCOUNT, TWO CARDS. Voice and SMS run on one Twilio account and number
// (`twilio_account_sid` / `twilio_auth_token` / `twilio_phone_number`), and
// `manage-twilio-voice` `setup` refuses to run until both exist. Both cards
// reach them through the same flow (`twilio-numbers-v2`), so there is still
// only one writer of those three columns from v2.
//
// ⚠️ ISOLATION (V2_PLAN §5). `tenants`' SELECT policy is a no-op as an
// isolation boundary, so `.eq('id', tenant.id)` is the only thing scoping the
// read below; `call_logs` likewise. Every write goes through an edge function
// that resolves the tenant from the caller's own `app_users` row.
//
// NO TEST MODE, deliberately: there is no sandbox/live split anywhere in the
// voice path. "Test" and "Place a test call" verify the LIVE configuration.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Loader2, Mic, PhoneCall, PhoneForwarded, Sparkles, Trash2, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
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

import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import { CopyValue, PanelCard, PanelError, PanelLoading, PanelNote, PanelRow, StatusChip } from "./_kit";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, SubScreen } from "./_screens";
import { useTwilioProbe } from "./twilio-messages-data";
import { useTestRing } from "./twilio-test-ring";
import { TwilioNumberFlow, demoPause, maskSid, prettyNumber, twilioDemo, useTwilioDemo, type TwilioDemoState } from "./twilio-setup";
import { SupportEmptyArt } from "@/components/illustrations-v2/scenes/support";
import { RemindersEmptyArt } from "@/components/illustrations-v2/scenes/reminders";

/* ────────────────────────────── state ──────────────────────────────────── */

/**
 * The columns this integration lives in. `twilio_auth_token` and
 * `twilio_api_key_secret` are deliberately NOT read: they are the plaintext
 * secrets once scraped out of `tenants` (20260723090000_lock_down_tenants_rls),
 * and nothing on this screen needs them.
 */
const VOICE_FIELDS = [
  "twilio_account_sid",
  "twilio_phone_number",
  "twilio_voice_enabled",
  "twilio_twiml_app_sid",
  "twilio_api_key_sid",
  "twilio_voice_webhook_configured",
  "call_forwarding_enabled",
  "forwarding_number",
  "forwarding_caller_id_mode",
  "voicemail_enabled",
  "voicemail_greeting_url",
  "call_recording_enabled",
].join(", ");

type CallerIdMode = "caller" | "business_line";

type VoiceConfig = {
  twilio_account_sid: string | null;
  twilio_phone_number: string | null;
  twilio_voice_enabled: boolean | null;
  twilio_twiml_app_sid: string | null;
  twilio_api_key_sid: string | null;
  twilio_voice_webhook_configured: boolean | null;
  call_forwarding_enabled: boolean | null;
  forwarding_number: string | null;
  forwarding_caller_id_mode: CallerIdMode | null;
  voicemail_enabled: boolean | null;
  voicemail_greeting_url: string | null;
  call_recording_enabled: boolean | null;
};

const configKey = (tenantId: string) => ["twilio-calling", tenantId];

/**
 * Read straight off `tenants` rather than through `manage-twilio-voice`
 * `get-status`: the board paints this card's chip on first load for every
 * role, and `get-status` both costs a round trip and refuses anyone below
 * admin — a manager would see a broken card for a working integration.
 */
function useVoiceConfig(tenantId: string) {
  return useQuery({
    queryKey: configKey(tenantId),
    queryFn: async (): Promise<VoiceConfig> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(VOICE_FIELDS)
        .eq("id", tenantId) // ⚠️ the only isolation — see the header note
        .single();
      if (error) throw error;
      return data as unknown as VoiceConfig;
    },
    staleTime: 60_000,
  });
}

/** The demo's stand-in for the row. Never sent anywhere. */
function demoConfig(s: TwilioDemoState): VoiceConfig {
  return {
    twilio_account_sid: s.live ? "AC3f9bxxxxxxxxxxxxxxxxxxxxxxxx5a6b" : null,
    twilio_phone_number: s.live ? s.number : null,
    twilio_voice_enabled: s.live && s.voiceOn,
    twilio_twiml_app_sid: s.voiceOn ? "AP7c1e9d2b4a6f8e0c3d5b7a9f1e2d4c6b" : null,
    twilio_api_key_sid: s.voiceOn ? "SKdemo" : null,
    twilio_voice_webhook_configured: s.voiceOn,
    call_forwarding_enabled: s.forwarding,
    forwarding_number: s.forwardTo,
    forwarding_caller_id_mode: s.callerIdMode,
    voicemail_enabled: s.voicemail,
    voicemail_greeting_url: s.greeting,
    call_recording_enabled: s.recording,
  };
}

/** The real row, or the demo's stand-in for it on the canary. */
function useConfig(tenant: PanelTenant) {
  const real = useVoiceConfig(tenant.id);
  const { demo, state } = useTwilioDemo(tenant);
  return { ...real, demo, data: demo ? (real.data ? demoConfig(state) : undefined) : real.data };
}

type Readiness = {
  state: IntegrationState;
  label?: string;
  /** Set when the state is `attention`: what is wrong, and how to fix it. */
  problem?: { title: string; detail: string };
};

/**
 * The single honest answer to "is calling working?". Voice needs an account,
 * a number, a voice app + API key, and the number's voice webhook pointed at
 * us — and they fail independently. Voice on with the webhook off is the
 * dangerous one (every call rings into nothing), so it gets its own label.
 */
function deriveReadiness(config: VoiceConfig | undefined, isError: boolean): Readiness {
  // A failed read is NOT "not connected" — that would invite a "reconnect"
  // that tears down a working voice app and API key.
  if (isError || !config) return { state: "attention", label: "Status unavailable" };

  if (!config.twilio_account_sid) return { state: "disconnected", label: "No Twilio account" };
  if (!config.twilio_voice_enabled) return { state: "disconnected" };

  if (!config.twilio_phone_number) {
    return {
      state: "attention",
      label: "No phone number",
      problem: { title: "There's no number to ring.", detail: "Calling is on, but no number is connected. Pick one and calls start reaching you." },
    };
  }
  if (!config.twilio_voice_webhook_configured) {
    return {
      state: "attention",
      label: "Calls not routed",
      problem: {
        title: "Calls aren't reaching Drive247.",
        detail: "Twilio has nowhere to send an incoming call, so callers hear an error. Turn calling off and on again under Disconnecting to rebuild it.",
      },
    };
  }
  if (!config.twilio_twiml_app_sid || !config.twilio_api_key_sid) {
    return {
      state: "attention",
      label: "Setup incomplete",
      problem: {
        title: "Part of the Twilio setup is missing.",
        detail: "The voice app or key I created is gone from your Twilio account. Turn calling off and on again to recreate them.",
      },
    };
  }
  if (config.call_forwarding_enabled && !config.forwarding_number) {
    return {
      state: "attention",
      label: "Forwarding has no number",
      problem: {
        title: "Forwarding is on, but to no number.",
        detail: "Calls still ring in the browser, but no phone rings. Add your number under Forwarding.",
      },
    };
  }
  return { state: "connected" };
}

/* ─────────────────────────────── chip ──────────────────────────────────── */

export function TwilioCallingStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useConfig(tenant);
  if (isLoading) return <StatusChip state="loading" />;
  const { state, label } = deriveReadiness(data, isError);
  return <StatusChip state={state} label={label} />;
}

/* ───────────────────────── edge-function access ────────────────────────── */

/** The real reason `manage-twilio-voice` gave, read whole from the body. */
async function readEdgeError(error: unknown): Promise<string | null> {
  const body = (error as any)?.context?.body;
  if (!body) return null;
  try {
    const parsed = JSON.parse(await new Response(body).text());
    return typeof parsed?.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

/**
 * Every write goes through v1's `manage-twilio-voice` — it owns the loop
 * guard, the role check and the Twilio-side voice app, key and webhook.
 * V2_PLAN §7: call it, never edit it. `tenantId` is honoured only for a super
 * admin, which is what makes this work for Ghulam's login.
 */
async function invokeVoice(action: string, tenantId: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("manage-twilio-voice", {
    body: { action, tenantId, ...params },
  });
  if (error) throw new Error((await readEdgeError(error)) || (error as any).message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

/* ─────────────────────────── phone helpers ─────────────────────────────── */

/** Twilio's `<Number>` verb needs E.164 — anything else fails at dial time, not save time. */
const E164 = /^\+[1-9]\d{7,14}$/;
const normalizePhone = (raw: string) => raw.replace(/[^\d+]/g, "");

/** Mirrors the loop check inside `manage-twilio-voice` so the operator hears it before saving. */
function isSameLine(a: string | null | undefined, b: string | null | undefined) {
  const da = (a || "").replace(/[^+\d]/g, "");
  const db = (b || "").replace(/[^+\d]/g, "");
  if (!da || !db) return false;
  return da === db || da.endsWith(db.replace("+", "")) || db.endsWith(da.replace("+", ""));
}

/**
 * What the server would do with an incoming call right now, from the TwiML
 * `preview-forward-call` returns — parsed, not restated from the switches, so
 * a disagreement between the two is visible rather than hidden.
 */
function summarizePreview(twiml: string): string {
  const clients = (twiml.match(/<Client>/g) || []).length;
  const numbers = [...twiml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((m) => prettyNumber(m[1]));
  const parts = [`rings ${clients} browser${clients === 1 ? "" : "s"}${numbers.length ? ` and ${numbers.join(", ")}` : ""}`];
  parts.push(twiml.includes("twilio-voicemail-handler") ? "voicemail after 30s" : "no voicemail");
  return parts.join(", ");
}

/* ───────────────────────────── the panel ───────────────────────────────── */

type Screen = "home" | "change" | "account" | "forwarding" | "voicemail" | "recording" | "calls" | "disconnect";

export default function TwilioCallingPanel({ tenant, onBack, onClose }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const { refetchTenant } = useTenant();
  const { data: config, isLoading, isError, error, refetch, demo } = useConfig(tenant);

  // Mirrors `manage-twilio-voice`'s own gate. Super admins are mapped to
  // head_admin by the auth store, matching how the function treats them.
  const { appUser } = useAuth();
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  const [screen, setScreen] = useState<Screen>("home");
  const home = () => setScreen("home");
  // The live "is the number still ours?" lookup Messages uses too.
  const probe = useTwilioProbe(tenant.id);
  // The test ends by ringing this browser like a real call (Ghulam, Oct 2).
  const testRing = useTestRing();

  /**
   * Invalidates v1's `twilio-voice-status` too: `GlobalVoiceCallProvider` is
   * mounted on this page and decides from it whether the browser softphone
   * registers, so without it enabling calling here leaves the softphone down
   * until a reload.
   */
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: configKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: ["twilio-voice-status"] });
    queryClient.invalidateQueries({ queryKey: ["twilio-calling-recent", tenant.id] });
  };

  const fail = (err: any) =>
    toast({ title: "Twilio Calling", description: err?.message || "Something went wrong", variant: "destructive" });

  const setup = useMutation({
    mutationFn: async () => (demo ? demoPause(null, 1600).then(() => twilioDemo.patch({ voiceOn: true })) : invokeVoice("setup", tenant.id)),
    onSuccess: () => {
      refreshAll();
      toast({ title: "Calling is on", description: "Calls to your number now reach you here." });
    },
    onError: fail,
  });

  const disable = useMutation({
    mutationFn: async () => (demo ? demoPause(null, 900).then(() => twilioDemo.patch({ voiceOn: false })) : invokeVoice("disable", tenant.id)),
    onSuccess: () => {
      refreshAll();
      home();
      toast({ title: "Calling is off", description: "Your number no longer sends calls to Drive247." });
    },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: async (params: Record<string, any>) => {
      if (!demo) return invokeVoice("update-forwarding", tenant.id, params);
      // The demo keeps the same switches in the browser.
      const p: Partial<TwilioDemoState> = {};
      if ("callForwardingEnabled" in params) p.forwarding = params.callForwardingEnabled;
      if ("forwardingNumber" in params) p.forwardTo = params.forwardingNumber;
      if ("forwardingCallerIdMode" in params) p.callerIdMode = params.forwardingCallerIdMode;
      if ("voicemailEnabled" in params) p.voicemail = params.voicemailEnabled;
      if ("voicemailGreetingUrl" in params) p.greeting = params.voicemailGreetingUrl;
      if ("callRecordingEnabled" in params) p.recording = params.callRecordingEnabled;
      return demoPause(null, 350).then(() => twilioDemo.patch(p));
    },
    onSuccess: () => refreshAll(),
    onError: fail,
  });

  const testCall = useMutation({
    // `confirm: true` is the edge function's own guard against a real, billed
    // call by accident — only ever sent from inside the confirmation below.
    mutationFn: async () => (demo ? demoPause({ to: config?.forwarding_number }) : invokeVoice("test-forward-call", tenant.id, { confirm: true })),
    onSuccess: (data: any) =>
      toast({ title: "Test call placed", description: `Ringing ${data?.to ? prettyNumber(data.to) : "your phone"} now.` }),
    onError: fail,
  });

  if (isLoading) return <PanelLoading rows={4} />;
  if (isError || !config) {
    return <PanelError message={(error as any)?.message || "Unknown error"} onRetry={() => refetch()} />;
  }

  const hasAccount = !!config.twilio_account_sid;
  const voiceOn = !!config.twilio_voice_enabled;
  const readiness = deriveReadiness(config, false);
  const number = prettyNumber(config.twilio_phone_number);

  // The number is in: switch calling on straight away — that is what the
  // operator came here for.
  const afterConnect = async (phoneNumber: string) => {
    if (!demo) await refetchTenant();
    home();
    if (!voiceOn) setup.mutate();
    else toast({ title: "Number connected", description: `Calls now come in on ${prettyNumber(phoneNumber)}.` });
  };

  /* ── no account: the number flow is the screen ─────────────────────────── */

  if (!hasAccount && !setup.isPending) {
    if (!canManage) {
      return (
        <>
          <Hero art={SupportEmptyArt} title="Calling isn't set up yet.">
            Only an admin or head admin can connect Twilio — ask one of them to open this card.
          </Hero>
          <ScreenNav className="mt-8" onBack={onBack} />
        </>
      );
    }
    return <TwilioNumberFlow tenant={tenant} need="voice" onBack={onBack} onConnected={afterConnect} />;
  }

  if (setup.isPending) {
    return (
      <Hero
        art={SupportEmptyArt}
        title="Turning on calling…"
        actions={
          <div className="flex justify-center">
            <Button className="h-10 rounded-2xl px-6" disabled>
              <Loader2 className="animate-spin" /> Setting up your number
            </Button>
          </div>
        }
      >
        I&rsquo;m creating a voice app in your Twilio account and pointing {number}&rsquo;s calls at Drive247.
      </Hero>
    );
  }

  /* ── screens behind quiet links ────────────────────────────────────────── */

  if (screen === "change") {
    return (
      <TwilioNumberFlow tenant={tenant} need="voice" useStored onBack={() => setScreen(voiceOn ? "account" : "home")} onConnected={afterConnect} />
    );
  }

  if (screen === "account") {
    return (
      <SubScreen title="Account details" description="The Twilio number your calls come in on, and where they go." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Business number" hint="The number customers call">
            {config.twilio_phone_number ? <CopyValue value={config.twilio_phone_number} /> : <span className="text-muted-foreground">Not set</span>}
          </PanelRow>
          <PanelRow label="Twilio account" hint="Shared with Twilio Messages" mono>
            {maskSid(config.twilio_account_sid!)}
          </PanelRow>
          <PanelRow label="Call routing">
            {voiceOn && config.twilio_voice_webhook_configured ? (
              <span className="text-success">Pointed at Drive247</span>
            ) : voiceOn ? (
              <span className="text-warning">Not configured</span>
            ) : (
              <span className="text-muted-foreground">Off</span>
            )}
          </PanelRow>
          {config.twilio_twiml_app_sid && (
            <PanelRow label="Voice app" mono>
              {maskSid(config.twilio_twiml_app_sid)}
            </PanelRow>
          )}
        </PanelCard>
        {/* Four checks, no call placed (Ghulam, Oct 2: the test has to
            prove it properly), each one on screen while it runs:
              1. Twilio confirms the number is on the account and takes calls
                 — a live lookup with the stored token, so a revoked token or
                 a released number fails here, not silently later.
              2. The voice app and key calling was set up with still exist.
              3. Where Twilio sends the number's calls RIGHT NOW (read live).
              4. What the server would do with a call (`preview-forward-call`
                 — costs nothing, rings nobody); nothing ringing is a fail. */}
        <ConnectionTest
          idle="Checks the number, voice app and routing, then rings this browser."
          disabled={!canManage}
          run={
            demo
              ? async (say) => {
                  say("Checking the number with Twilio…");
                  await demoPause(null, 700);
                  say("Checking the voice app…");
                  await demoPause(null, 600);
                  say("Checking where calls go…");
                  await demoPause(null, 600);
                  say("Asking what would ring…");
                  await demoPause(null, 700);
                  say("Ringing this browser…");
                  const outcome = await testRing.ring(prettyNumber(config.twilio_phone_number));
                  return outcome === "answered"
                    ? "Working · this browser rang and you answered"
                    : outcome === "declined"
                      ? "Working · this browser rang, you declined"
                      : "Working · this browser rang, nobody answered";
                }
              : async (say) => {
                  say("Checking the number with Twilio…");
                  const line = await probe.mutateAsync();
                  if (!line.confirmed) {
                    throw new Error("Twilio wouldn't confirm this number — the token changed or the number was released.");
                  }
                  if (line.capabilities && !line.capabilities.voice) throw new Error("This number can't take calls.");

                  say("Checking the voice app…");
                  const status = await invokeVoice("get-status", tenant.id);
                  if (!status?.voiceEnabled) throw new Error("Calling is switched off.");
                  if (!status?.twimlAppSid || !status?.apiKeyConfigured) {
                    throw new Error("The voice app or key is missing — turn calling off and on to rebuild it.");
                  }

                  say("Checking where calls go…");
                  if (status?.voiceWebhookMatches === false) {
                    throw new Error("This number's calls aren't pointed at Drive247 any more.");
                  }
                  if (status?.voiceWebhookMatches == null) throw new Error("Twilio didn't say where this number's calls go.");

                  say("Asking what would ring…");
                  const preview = await invokeVoice("preview-forward-call", tenant.id);
                  const twiml: string = preview?.twiml || "";
                  if (!/<Client>/.test(twiml) && !/<Number/.test(twiml)) {
                    throw new Error("Nothing would ring — nobody is signed in and forwarding is off.");
                  }
                  // The last proof is a real one: ring the browser of the person
                  // testing (`twilio-voice-test-v2`). The portal's own
                  // incoming-call card answers it — the one Messages uses — and
                  // a modal dialog would make that card unclickable, so this
                  // dialog steps aside as the call goes out.
                  say("Ringing this browser…");
                  const { error: ringError } = await supabase.functions.invoke("twilio-voice-test-v2", {
                    body: { action: "ring-me", tenantId: tenant.id },
                  });
                  if (ringError) throw new Error((await readEdgeError(ringError)) || "Twilio couldn't ring this browser.");
                  window.setTimeout(onClose, 600);
                  return `Working · ${summarizePreview(twiml)} — ringing you now`;
                }
          }
        />
        {canManage && <QuietNav items={[{ label: "Use a different number", onClick: () => setScreen("change") }]} />}
        {testRing.node}
      </SubScreen>
    );
  }

  if (screen === "forwarding") {
    return <Forwarding tenantId={tenant.id} demo={demo} config={config} canManage={canManage} update={update} onBack={home} />;
  }

  if (screen === "voicemail") {
    return <Voicemail tenant={tenant} demo={demo} config={config} canManage={canManage} update={update} refreshAll={refreshAll} onBack={home} />;
  }

  if (screen === "recording") {
    return (
      <SubScreen title="Recording" onBack={home}>
        <ToggleCard
          title={config.call_recording_enabled ? "Calls are recorded" : "Calls aren't recorded"}
          detail="Both sides are recorded, then I write a short summary into the customer's conversation."
          checked={!!config.call_recording_enabled}
          disabled={!canManage || update.isPending}
          onChange={(v) => update.mutate({ callRecordingEnabled: v })}
        />
        {/* Asymmetric in the code, so said in full: the notice plays on the
            CALLER's leg for incoming calls, but on the STAFF member's leg for
            outgoing ones — the customer is never told. Don't shorten. */}
        <PanelNote tone={config.call_recording_enabled ? "warn" : "info"}>
          <span className="block">
            <strong className="font-medium">Incoming:</strong> the caller hears &ldquo;This call may be recorded&rdquo;
            before anyone answers.
          </span>
          <span className="mt-1.5 block">
            <strong className="font-medium">Outgoing from the browser:</strong> that notice plays to <em>you</em>, not the
            customer. In all-party-consent states (California, Florida, Illinois, Maryland, Massachusetts, Michigan,
            Montana, Nevada, New Hampshire, Pennsylvania, Washington) say it yourself first.
          </span>
        </PanelNote>
      </SubScreen>
    );
  }

  if (screen === "calls") {
    return (
      <SubScreen title="Recent calls" description="The proof calls are reaching you." onBack={home}>
        <RecentCalls tenantId={tenant.id} demo={demo} />
      </SubScreen>
    );
  }

  if (screen === "disconnect") {
    return (
      <DisconnectScreen
        name="calling"
        canManage={canManage}
        pending={disable.isPending}
        onBack={home}
        onConfirm={() => disable.mutate()}
        consequence={
          <>
            I&rsquo;ll delete the voice app and key from your Twilio account and unhook your number, so calls stop
            reaching you straight away. Texts, your number, call history, recordings and voicemails all stay.
          </>
        }
      />
    );
  }

  /* ── the main screen ───────────────────────────────────────────────────── */

  if (!voiceOn) {
    return (
      <>
        <Hero
          art={SupportEmptyArt}
          eyebrow="Off"
          title={config.twilio_phone_number ? `Turn on calling for ${number}.` : "Pick a number for calls."}
          actions={
            canManage && (
              <div className="flex justify-center">
                {config.twilio_phone_number ? (
                  <Button className="h-10 rounded-2xl px-6" onClick={() => setup.mutate()}>
                    <PhoneCall /> Turn on calling
                  </Button>
                ) : (
                  <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("change")}>
                    Pick a number <ArrowRight />
                  </Button>
                )}
              </div>
            )
          }
          footer={
            canManage && config.twilio_phone_number && (
              <QuietNav items={[{ label: "Use a different number", onClick: () => setScreen("change") }]} />
            )
          }
        >
          {canManage
            ? "Your Twilio account is connected. I'll set up a voice app there and point this number's calls at Drive247 — your texts aren't touched."
            : "Only an admin or head admin can turn calling on."}
        </Hero>
        <ScreenNav className="mt-5" onBack={onBack} />
      </>
    );
  }

  const fwdOn = !!config.call_forwarding_enabled && !!config.forwarding_number;
  const businessLine = config.forwarding_caller_id_mode === "business_line";

  const title = readiness.problem?.title ?? `Calls to ${number} ring through.`;
  const body =
    readiness.problem?.detail ??
    (fwdOn
      ? `They ring here in the browser and on ${prettyNumber(config.forwarding_number)}, showing ${businessLine ? "your business line" : "the caller's number"}.${config.voicemail_enabled ? " Miss one and they can leave a voicemail." : ""}`
      : "They ring here in the browser. Add your own phone under Forwarding so you never miss one.");

  const action = !canManage ? null : fwdOn ? (
    <TestCallButton
      number={config.forwarding_number!}
      pending={testCall.isPending || testRing.ringing}
      // northwind: nothing real dials — the phone rings on screen instead.
      skipConfirm={demo}
      onConfirm={() =>
        demo
          ? void testRing.ring(prettyNumber(config.twilio_phone_number), "Call from Test Customer. This is how a forwarded call reaches you.")
          : testCall.mutate()
      }
    />
  ) : (
    <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("forwarding")}>
      <PhoneForwarded /> Set up forwarding
    </Button>
  );

  const links = [
    { label: "Account details", onClick: () => setScreen("account") },
    { label: "Forwarding", onClick: () => setScreen("forwarding") },
    { label: "Voicemail", onClick: () => setScreen("voicemail") },
    { label: "Recording", onClick: () => setScreen("recording") },
    { label: "Recent calls", onClick: () => setScreen("calls") },
    ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
  ];

  return (
    <>
      <Hero
        art={readiness.problem ? RemindersEmptyArt : SupportEmptyArt}
        eyebrow={readiness.label ?? "Live"}
        title={title}
        actions={action && <div className="flex justify-center">{action}</div>}
        footer={<QuietNav items={links} />}
      >
        {body}
      </Hero>
      {testRing.node}
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}

/* ───────────────────────────── small pieces ────────────────────────────── */

function ToggleCard({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <PanelCard className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
    </PanelCard>
  );
}

/** A real, billed call — always behind a confirmation. */
function TestCallButton({
  number,
  pending,
  skipConfirm,
  onConfirm,
}: {
  number: string;
  pending: boolean;
  skipConfirm?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="h-10 rounded-2xl px-6" disabled={pending} onClick={() => (skipConfirm ? onConfirm() : setOpen(true))}>
        {pending ? <Loader2 className="animate-spin" /> : <PhoneCall />}
        {pending ? "Dialling…" : "Place a test call"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place a real call?</AlertDialogTitle>
            <AlertDialogDescription>
              I&rsquo;ll ring <span className="font-mono">{prettyNumber(number)}</span> for real, from your Twilio
              account, at your Twilio rate. Answer it to hear exactly what a forwarded call sounds like.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Call me now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Update = { mutate: (p: Record<string, any>, o?: { onSuccess?: () => void }) => void; isPending: boolean };

/* ── forwarding + the business line ───────────────────────────────────────── */

function Forwarding({
  tenantId,
  demo,
  config,
  canManage,
  update,
  onBack,
}: {
  tenantId: string;
  demo: boolean;
  config: VoiceConfig;
  canManage: boolean;
  update: Update;
  onBack: () => void;
}) {
  const [input, setInput] = useState<string | null>(null);
  const value = input ?? config.forwarding_number ?? "";
  const normalized = normalizePhone(value);
  const dirty = normalized !== normalizePhone(config.forwarding_number || "");
  const invalid = normalized.length > 0 && !E164.test(normalized);
  const loops = isSameLine(normalized, config.twilio_phone_number);
  const on = !!config.call_forwarding_enabled;
  const mode = config.forwarding_caller_id_mode ?? "caller";
  const ring = useTestRing();

  return (
    <SubScreen title="Forwarding & business line" onBack={onBack}>
      <ToggleCard
        title="Ring my phone too"
        detail="Your phone rings at the same time as the browser. Whoever answers first gets the call."
        checked={on}
        disabled={!canManage || update.isPending}
        onChange={(v) => update.mutate({ callForwardingEnabled: v })}
      />
      <div className={cn("space-y-3.5 transition-opacity duration-200", !on && "pointer-events-none opacity-50")}>
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canManage || !dirty || invalid || loops) return;
            update.mutate(
              { forwardingNumber: normalized || null },
              { onSuccess: () => { setInput(null); toast({ title: normalized ? "Forwarding number saved" : "Forwarding number cleared" }); } },
            );
          }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-input bg-background px-3.5 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30">
              <PhoneForwarded className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={value}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Your mobile, like +15551234567"
                inputMode="tel"
                disabled={!canManage || !on}
                aria-label="Forward calls to"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&:not(:placeholder-shown)]:font-mono placeholder:text-muted-foreground/70"
              />
            </span>
            <Button type="submit" variant="outline" className="h-11 shrink-0 rounded-2xl px-5" disabled={!canManage || !dirty || invalid || loops || update.isPending}>
              Save
            </Button>
          </div>
          {(invalid || loops) && (
            <p className="px-1 text-[11px] text-destructive">
              {invalid
                ? "Use the full international format, with the country code, like +15551234567."
                : "That's your business line — forwarding to it would make every call dial itself."}
            </p>
          )}
        </form>

        <div className="space-y-2">
          <p className="px-1 text-xs text-muted-foreground">When it rings, your phone shows</p>
          <div className="grid grid-cols-2 gap-2.5">
            <ModeOption
              active={mode === "caller"}
              disabled={!canManage || update.isPending}
              onSelect={() => update.mutate({ forwardingCallerIdMode: "caller" })}
              title="The caller's number"
              detail="Saved contacts and calling back work as normal."
            />
            <ModeOption
              active={mode === "business_line"}
              disabled={!canManage || update.isPending}
              onSelect={() => update.mutate({ forwardingCallerIdMode: "business_line" })}
              title="Your business line"
              detail="You know it's a work call. I say the caller's name before connecting."
            />
          </div>
        </div>

        {/* A REAL, billed call from the tenant's own Twilio account, so it asks
            first. `test-forward-call` always rings from the business line and
            whispers "Test Customer" — the card says exactly that. It rings the
            SAVED number, so an unsaved edit has to be saved first. */}
        <ConnectionTest
          title="Test call"
          icon={PhoneCall}
          idle={
            !config.forwarding_number
              ? "Save your number, then I'll ring it."
              : dirty
                ? "Save the new number first."
                : demo
                  ? `Shows how a call reaches ${prettyNumber(config.forwarding_number)}.`
                  : `I'll ring ${prettyNumber(config.forwarding_number)} so you hear it for real.`
          }
          disabled={!canManage || !on || !config.forwarding_number || dirty}
          confirm={demo ? undefined : {
            title: "Place a real call?",
            description: (
              <>
                I&rsquo;ll ring <span className="font-mono">{prettyNumber(config.forwarding_number)}</span> from your
                business line, at your Twilio rate. When you answer I&rsquo;ll say &ldquo;Test Customer&rdquo; first
                — just like a real forwarded call.
              </>
            ),
            action: "Call me now",
          }}
          run={async (say) => {
            say(`Calling ${prettyNumber(config.forwarding_number)}…`);
            if (demo) {
              // northwind has no Twilio account, so nothing real can dial: the
              // phone rings on screen instead, the way the forwarded test call
              // arrives — from the business line, with the name said first.
              await demoPause(null, 700);
              const outcome = await ring.ring(
                prettyNumber(config.twilio_phone_number),
                "Call from Test Customer. This is how a forwarded call reaches you.",
              );
              return outcome === "answered"
                ? "Working · your phone rang and you answered"
                : outcome === "declined"
                  ? "Working · your phone rang, you declined"
                  : "Working · your phone rang, nobody answered";
            }
            const res = await invokeVoice("test-forward-call", tenantId, { confirm: true });
            return `Ringing ${prettyNumber(res?.to ?? config.forwarding_number)} now — answer it`;
          }}
        />
        {ring.node}
      </div>
    </SubScreen>
  );
}

function ModeOption({
  active,
  title,
  detail,
  disabled,
  onSelect,
}: {
  active: boolean;
  title: string;
  detail: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "rounded-2xl border px-3.5 py-3 text-left transition-colors duration-200 disabled:opacity-60 motion-reduce:transition-none",
        active ? "border-primary/50 bg-primary/10" : "bg-background/70 hover:border-primary/30",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("size-3.5 shrink-0 rounded-full border", active ? "border-[4px] border-primary" : "border-muted-foreground/40")} />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </span>
      <span className="mt-1 block pl-[22px] text-xs leading-relaxed text-muted-foreground">{detail}</span>
    </button>
  );
}

/* ── voicemail ────────────────────────────────────────────────────────────── */

function Voicemail({
  tenant,
  demo,
  config,
  canManage,
  update,
  refreshAll,
  onBack,
}: {
  tenant: PanelTenant;
  demo: boolean;
  config: VoiceConfig;
  canManage: boolean;
  update: Update;
  refreshAll: () => void;
  onBack: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Into the existing PUBLIC `voicemails` bucket — it has to be public, since
   * Twilio's `<Play>` fetches the file with no credentials. Tenant-prefixed
   * like `twilio-voicemail-handler`'s recordings; the prefix is tidiness, not
   * security, so nothing secret goes in. The demo uploads nothing.
   */
  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Keep the greeting under 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      if (demo) {
        await demoPause(null, 900);
        twilioDemo.patch({ greeting: URL.createObjectURL(file) });
      } else {
        const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
        const path = `${tenant.id}/greeting-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("voicemails").upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("voicemails").getPublicUrl(path);
        if (!data?.publicUrl) throw new Error("Couldn't resolve the uploaded file's address");
        await invokeVoice("update-forwarding", tenant.id, { voicemailGreetingUrl: data.publicUrl });
        refreshAll();
      }
      toast({ title: "Greeting uploaded", description: "Callers hear this instead of the default." });
    } catch (err: any) {
      toast({ title: "Twilio Calling", description: err?.message || "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const on = !!config.voicemail_enabled;
  return (
    <SubScreen title="Voicemail" onBack={onBack}>
      <ToggleCard
        title={on ? "Voicemail is on" : "Voicemail is off"}
        detail="Nobody answers in 30 seconds and the caller can leave up to 2 minutes. It lands in their conversation."
        checked={on}
        disabled={!canManage || update.isPending}
        onChange={(v) => update.mutate({ voicemailEnabled: v })}
      />
      <div className={cn("space-y-3 transition-opacity duration-200", !on && "pointer-events-none opacity-50")}>
        {config.voicemail_greeting_url ? (
          <PanelCard className="space-y-2 py-3">
            <p className="text-xs text-muted-foreground">Your greeting</p>
            <audio controls src={config.voicemail_greeting_url} className="h-9 w-full" />
          </PanelCard>
        ) : (
          <PanelCard className="py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Callers hear: &ldquo;You&rsquo;ve reached {tenant.company_name || "us"}. No one is available right now.
              Please leave a message after the beep.&rdquo;
            </p>
          </PanelCard>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <div className="flex justify-center gap-2">
          <Button variant="outline" className="rounded-2xl" disabled={!canManage || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {uploading ? "Uploading…" : config.voicemail_greeting_url ? "Replace greeting" : "Upload your own greeting"}
          </Button>
          {config.voicemail_greeting_url && (
            <Button
              variant="ghost"
              className="rounded-2xl"
              disabled={!canManage || update.isPending}
              onClick={() => update.mutate({ voicemailGreetingUrl: null }, { onSuccess: () => toast({ title: "Back to the default greeting" }) })}
            >
              <Trash2 /> Use the default
            </Button>
          )}
        </div>
        <p className="text-center text-[11px] text-muted-foreground">MP3 or WAV, under 5 MB. Anyone with its link can play it.</p>
      </div>
    </SubScreen>
  );
}

/* ── recent calls ─────────────────────────────────────────────────────────── */

type CallRow = {
  id: string;
  direction: string;
  status: string;
  from_number: string | null;
  to_number: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  ai_summary: string | null;
  created_at: string | null;
};

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function RecentCalls({ tenantId, demo }: { tenantId: string; demo: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["twilio-calling-recent", tenantId],
    queryFn: async (): Promise<CallRow[]> => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("id, direction, status, from_number, to_number, duration_seconds, recording_url, ai_summary, created_at")
        .eq("tenant_id", tenantId) // ⚠️ isolation — call_logs is read by tenant, never globally
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as CallRow[];
    },
    enabled: !demo,
    staleTime: 30_000,
  });

  if (!demo && isLoading) return <PanelLoading rows={2} />;
  if (isError) return <p className="text-xs text-muted-foreground">Couldn&rsquo;t load recent calls.</p>;
  if (demo || !data?.length) {
    return (
      <PanelNote>
        No calls yet. The first call in or out of your number shows up here — that&rsquo;s the proof it&rsquo;s all
        working.
      </PanelNote>
    );
  }

  return (
    <PanelCard className="divide-y px-0 py-0">
      {data.map((call) => {
        const inbound = call.direction === "inbound";
        const duration = formatDuration(call.duration_seconds);
        return (
          <div key={call.id} className="flex items-center gap-2.5 px-3.5 py-2">
            {inbound ? (
              <ArrowDownLeft className="size-3.5 shrink-0 text-success" />
            ) : (
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-foreground">
                {prettyNumber(inbound ? call.from_number : call.to_number) || "Unknown"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {call.created_at ? new Date(call.created_at).toLocaleString() : "—"}
                {duration ? ` · ${duration}` : ""}
                {call.status ? ` · ${call.status}` : ""}
              </p>
            </div>
            {call.recording_url && <Mic className="size-3 shrink-0 text-muted-foreground" />}
            {call.ai_summary && <Sparkles className="size-3 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
          </div>
        );
      })}
    </PanelCard>
  );
}
