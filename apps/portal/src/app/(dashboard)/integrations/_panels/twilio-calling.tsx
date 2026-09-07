"use client";

// ── Twilio Calling ────────────────────────────────────────────────────────────
//
// Inbound call handling on the operator's Twilio number: forwarding to a real
// phone, voicemail when nobody picks up, and call recording with the AI
// transcript that follows it.
//
// WHAT THIS PANEL DOES NOT OWN — the Twilio ACCOUNT.
// Voice and SMS run on ONE Twilio subaccount per tenant
// (`twilio_account_sid` / `twilio_auth_token` / `twilio_phone_number`), and
// `manage-twilio-voice`'s `setup` refuses to run until that account AND its
// phone number exist. The Twilio Messages panel owns entering and verifying
// those credentials; this file only READS them, and where they are missing it
// says so and points at that card rather than growing a second, competing
// credential form. Two forms writing the same three columns is how one of them
// ends up clearing what the other just saved.
//
// ⚠️ ISOLATION (V2_PLAN §5). `tenants` has RLS enabled but its SELECT policy is
// `tenants_public_select … USING (true)` for anon AND authenticated — so as an
// isolation boundary the policy is a no-op, and `.eq('id', tenant.id)` is the
// only thing scoping the read below. `call_logs` is the same story. Nothing
// here writes to a table directly: every mutation goes through
// `manage-twilio-voice`, which resolves the tenant from the caller's own
// `app_users` row and validates the number against the tenant's Twilio line.
//
// NO TEST MODE, deliberately. `isTestModeUiHidden` is true for the canary, and
// Twilio Calling has nothing to put behind it: there is no `twilio_voice_mode`
// column and no sandbox/live split anywhere in the voice path. "Preview
// routing" and "Place a test call" below are verification actions against the
// LIVE configuration, not a sandbox — so they are not gated, and adding a TEST
// badge to them would invent a mode the product does not have.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Mic,
  PhoneCall,
  PhoneForwarded,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Voicemail as VoicemailIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Switch } from "@/components/ui-v2/switch";
import { Separator } from "@/components/ui-v2/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui-v2/alert-dialog";

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

/* ────────────────────────────── state ──────────────────────────────────── */

/**
 * The columns this integration lives in. All of them already exist.
 *
 * `twilio_auth_token` and `twilio_api_key_secret` are deliberately NOT in this
 * list. Those two are the plaintext secrets that were scraped out of `tenants`
 * through PostgREST and used to abuse the Twilio accounts
 * (20260723090000_lock_down_tenants_rls.sql). `authenticated` can still read
 * them, so leaving them out is a choice, not a constraint — nothing on this
 * screen needs them, and a secret that never enters the browser bundle cannot
 * leak from it.
 */
const VOICE_FIELDS = [
  // shared with Twilio Messages — read-only here
  "twilio_account_sid",
  "twilio_phone_number",
  // voice plumbing
  "twilio_voice_enabled",
  "twilio_twiml_app_sid",
  "twilio_api_key_sid",
  "twilio_voice_webhook_configured",
  // forwarding
  "call_forwarding_enabled",
  "forwarding_number",
  "forwarding_caller_id_mode",
  // voicemail
  "voicemail_enabled",
  "voicemail_greeting_url",
  // recording
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
 * Read straight off `tenants` rather than through `manage-twilio-voice`'s
 * `get-status`.
 *
 * Two reasons, both about the STATUS CHIP, which the board paints for every
 * card on first load. `get-status` is an edge-function round trip, and — more
 * importantly — it refuses any role below `admin`. A manager or ops user
 * opening Integrations would get a 403 and a card that reads as broken when the
 * integration is fine. A row read answers for every role, and the mutations
 * below still carry the real permission check.
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
    // The chip is cheap but not free; a minute of staleness on a config screen
    // is invisible, and every mutation invalidates this key explicitly.
    staleTime: 60_000,
  });
}

type Readiness = {
  state: IntegrationState;
  label?: string;
  /** Set when the state is `attention`: what is wrong, and how to fix it. */
  problem?: { title: string; detail: string };
};

/**
 * The single honest answer to "is calling working?".
 *
 * Voice needs four things and they fail independently: an account, a number, a
 * TwiML app + API key, and the number's voice webhook actually pointed at us.
 * `twilio_voice_enabled = true` with `twilio_voice_webhook_configured = false`
 * is the dangerous one — the operator believes calls are being answered while
 * every inbound call rings into nothing — so it gets its own label rather than
 * being folded into "Connected".
 */
function deriveReadiness(config: VoiceConfig | undefined, isError: boolean): Readiness {
  // A failed read is NOT "not connected". Saying so would invite an operator to
  // "reconnect" working voice, which tears down the TwiML app and API key.
  if (isError || !config) return { state: "attention", label: "Status unavailable" };

  if (!config.twilio_account_sid) return { state: "disconnected", label: "No Twilio account" };
  if (!config.twilio_voice_enabled) return { state: "disconnected" };

  if (!config.twilio_phone_number) {
    return {
      state: "attention",
      label: "No phone number",
      problem: {
        title: "Calling is on, but there is no phone number to receive calls",
        detail:
          "The Twilio number lives on the Twilio Messages card. Until one is set, nothing can ring.",
      },
    };
  }

  if (!config.twilio_voice_webhook_configured) {
    return {
      state: "attention",
      label: "Calls not routed",
      problem: {
        title: "Your Twilio number is not pointed at Drive247",
        detail:
          "Calling is switched on, but Twilio has nowhere to send an incoming call — it will ring into nothing and the caller hears an error. Turn calling off and on again to rebuild the routing.",
      },
    };
  }

  if (!config.twilio_twiml_app_sid || !config.twilio_api_key_sid) {
    return {
      state: "attention",
      label: "Setup incomplete",
      problem: {
        title: "Part of the Twilio setup is missing",
        detail:
          "The voice app or API key this integration created is gone from your Twilio account. Turn calling off and on again to recreate them.",
      },
    };
  }

  if (config.call_forwarding_enabled && !config.forwarding_number) {
    return {
      state: "attention",
      label: "Forwarding has no number",
      problem: {
        title: "Call forwarding is on but no number is set",
        detail:
          "Calls still ring in the browser, but nothing rings a phone. Add the number you want calls forwarded to below.",
      },
    };
  }

  return { state: "connected" };
}

/* ─────────────────────────────── chip ──────────────────────────────────── */

export function TwilioCallingStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useVoiceConfig(tenant.id);
  if (isLoading) return <StatusChip state="loading" />;
  const { state, label } = deriveReadiness(data, isError);
  return <StatusChip state={state} label={label} />;
}

/* ───────────────────────── edge-function access ────────────────────────── */

/**
 * supabase-js collapses any non-2xx from an edge function into the generic
 * "Edge Function returned a non-2xx status code" and buries the real message in
 * the response body. Everything `manage-twilio-voice` tells an operator is in
 * that body — "Twilio SMS must be configured first", "…would create a call
 * loop", the role refusal — so it is unwrapped here.
 *
 * Reads the WHOLE stream via `Response`, unlike v1's single `reader.read()`,
 * which silently truncates any message that spans more than one chunk.
 */
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
 * All writes go through the v1 edge function rather than an `update()` here.
 *
 * That is reuse of the part that matters: the function owns the loop guard that
 * refuses a forwarding number equal to the Twilio line (which would make every
 * call dial itself), the role check, and — for setup/disable — the Twilio-side
 * API Key, TwiML App and phone-number webhook that no client-side update could
 * touch. V2_PLAN §7: call it, never edit it.
 */
async function invokeVoice(action: string, tenantId: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("manage-twilio-voice", {
    // `tenantId` is honoured only for super admins (who have `tenant_id = NULL`
    // in `app_users`); for everyone else the function uses their own tenant and
    // ignores this. Sending it is what makes the panel work for Ghulam's login.
    body: { action, tenantId, ...params },
  });
  if (error) {
    throw new Error((await readEdgeError(error)) || (error as any).message || "Request failed");
  }
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

/* ────────────────────────── small local pieces ─────────────────────────── */

/**
 * A destructive or billable action behind a confirmation.
 *
 * Local rather than in the kit: three of the controls on this screen cost real
 * money or tear down Twilio resources, and the kit has no confirm primitive.
 */
function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  // `React.ReactNode` via the UMD global, not an `import type { ReactNode }`:
  // there are two copies of @types/react in this tree, and an imported
  // ReactNode resolves to a different declaration than the one the ui-v2
  // components were typed against.
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <AlertDialog>
      {/* `asChild` rather than a wrapper element with an onClick: the buttons
          passed in here are disabled in several states, and a disabled button
          carries `pointer-events-none`, so a click would fall through to the
          wrapper and open the dialog anyway. Radix on the button itself honours
          `disabled`. */}
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A picker row for the two caller-ID modes. */
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
      className={cn(
        "w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-50",
        active ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-3.5 shrink-0 rounded-full border",
            active ? "border-[4px] border-primary" : "border-muted-foreground/40",
          )}
        />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <p className="mt-1 pl-[22px] text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </button>
  );
}

/* ───────────────────────────── recent calls ────────────────────────────── */

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
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RecentCalls({ tenantId }: { tenantId: string }) {
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
    staleTime: 30_000,
  });

  if (isLoading) return <PanelLoading rows={2} />;

  // A failed read of the history says nothing about whether calling works, so
  // it stays a quiet line rather than the panel-wide PanelError.
  if (isError) {
    return <p className="text-xs text-muted-foreground">Could not load recent calls.</p>;
  }

  if (!data?.length) {
    return (
      <PanelNote>
        No calls logged yet. The first call in or out of your Twilio number will appear here — that
        is the proof the routing above is actually working.
      </PanelNote>
    );
  }

  return (
    <PanelCard className="divide-y px-0 py-0">
      {data.map((call) => {
        const inbound = call.direction === "inbound";
        const other = inbound ? call.from_number : call.to_number;
        const duration = formatDuration(call.duration_seconds);
        return (
          <div key={call.id} className="flex items-center gap-2.5 px-3.5 py-2">
            {inbound ? (
              <ArrowDownLeft className="size-3.5 shrink-0 text-success" />
            ) : (
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-foreground">{other || "Unknown"}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {call.created_at ? new Date(call.created_at).toLocaleString() : "—"}
                {duration ? ` · ${duration}` : ""}
                {call.status ? ` · ${call.status}` : ""}
              </p>
            </div>
            {call.recording_url && <Mic className="size-3 shrink-0 text-muted-foreground" />}
            {call.ai_summary && <Sparkles className="size-3 shrink-0 text-primary" />}
          </div>
        );
      })}
    </PanelCard>
  );
}

/* ────────────────────────── routing preview ────────────────────────────── */

/**
 * Reads the TwiML `twilio-voice-inbound` would actually return and states, in
 * words, what a caller would experience.
 *
 * Parsed rather than restated from the config columns on purpose: the whole
 * value of this control is that it reflects what the SERVER decided, so a
 * disagreement between this summary and the switches above is exactly the bug
 * an operator needs to see.
 */
function summarizePreview(twiml: string): string[] {
  const lines: string[] = [];
  const clients = (twiml.match(/<Client>/g) || []).length;
  const numbers = [...twiml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((m) => m[1]);

  if (twiml.includes("may be recorded")) lines.push("Plays the recording notice to the caller.");
  lines.push(
    clients > 0
      ? `Rings ${clients} signed-in browser${clients === 1 ? "" : "s"}.`
      : "Rings no browsers — no active staff accounts to call.",
  );
  if (numbers.length) {
    const businessLine = /callerId=/.test(twiml);
    lines.push(
      `Rings ${numbers.join(", ")} — showing ${businessLine ? "your business line" : "the caller's number"}.`,
    );
  } else {
    lines.push("Rings no phones — call forwarding is off or has no number.");
  }
  if (twiml.includes("twilio-voice-whisper")) {
    lines.push("Announces the caller's name to you before connecting.");
  }
  lines.push(
    twiml.includes("twilio-voicemail-handler")
      ? "Falls through to voicemail after 30 seconds unanswered."
      : "Says nobody is available after 30 seconds unanswered — no voicemail.",
  );
  return lines;
}

/* ───────────────────────────── the panel ───────────────────────────────── */

export default function TwilioCallingPanel({ tenant }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const { data: config, isLoading, isError, error, refetch } = useVoiceConfig(tenant.id);

  // Mirrors `manage-twilio-voice`'s own gate exactly. Super admins are mapped
  // to `head_admin` by the auth store, which matches how the function treats
  // them. Showing a control that is guaranteed to 403 is worse than not showing
  // it, so read-only roles get the state and none of the switches.
  const { appUser } = useAuth();
  const canManage = appUser?.role === "head_admin" || appUser?.role === "admin";

  const [fwdInput, setFwdInput] = useState<string | null>(null);
  const [greetingInput, setGreetingInput] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readiness = useMemo(() => deriveReadiness(config, isError), [config, isError]);

  /**
   * Invalidate BOTH this panel's key and v1's `twilio-voice-status`.
   *
   * `GlobalVoiceCallProvider` is mounted in the dashboard layout, so v1's
   * `useTwilioVoice` query is live on this very page and is what decides
   * whether the browser softphone registers a Twilio Device. Without the second
   * invalidation, enabling calling here leaves the softphone down (and
   * disabling leaves it up) until a full page reload.
   */
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: configKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: ["twilio-voice-status"] });
    queryClient.invalidateQueries({ queryKey: ["twilio-calling-recent", tenant.id] });
    // A preview describes the configuration as it was when it was taken. Once
    // anything changes it is a confident, out-of-date answer to the one
    // question this control exists to answer honestly — so it is discarded
    // rather than left on screen next to the switch that just invalidated it.
    setPreview(null);
  };

  const fail = (err: any) =>
    toast({ title: "Twilio Calling", description: err?.message || "Something went wrong", variant: "destructive" });

  const setup = useMutation({
    mutationFn: () => invokeVoice("setup", tenant.id),
    onSuccess: () => {
      refreshAll();
      toast({
        title: "Calling is on",
        description: "Your Twilio number now routes incoming calls to Drive247.",
      });
    },
    onError: fail,
  });

  const disable = useMutation({
    mutationFn: () => invokeVoice("disable", tenant.id),
    onSuccess: () => {
      refreshAll();
      toast({ title: "Calling is off", description: "Your Twilio number no longer routes calls to Drive247." });
    },
    onError: fail,
  });

  const update = useMutation({
    mutationFn: (params: Record<string, any>) => invokeVoice("update-forwarding", tenant.id, params),
    onSuccess: () => refreshAll(),
    onError: fail,
  });

  const previewCall = useMutation({
    mutationFn: () => invokeVoice("preview-forward-call", tenant.id),
    onSuccess: (data: any) => setPreview(data?.twiml || ""),
    onError: fail,
  });

  const testCall = useMutation({
    // `confirm: true` is the edge function's own guard against placing a real,
    // billed call by accident. It is only ever sent from inside the confirmation
    // dialog below — never hardcode it into an unguarded button.
    mutationFn: () => invokeVoice("test-forward-call", tenant.id, { confirm: true }),
    onSuccess: (data: any) =>
      toast({ title: "Test call placed", description: `Ringing ${data?.to ?? "your phone"} now.` }),
    onError: fail,
  });

  if (isLoading) return <PanelLoading rows={4} />;
  if (isError || !config) {
    return <PanelError message={(error as any)?.message || "Unknown error"} onRetry={() => refetch()} />;
  }

  const hasAccount = !!config.twilio_account_sid;
  const voiceOn = !!config.twilio_voice_enabled;
  const busy = setup.isPending || disable.isPending || update.isPending;

  const fwdValue = fwdInput ?? config.forwarding_number ?? "";
  const fwdNormalized = normalizePhone(fwdValue);
  const fwdDirty = fwdNormalized !== normalizePhone(config.forwarding_number || "");
  const fwdInvalid = fwdNormalized.length > 0 && !E164.test(fwdNormalized);
  const fwdLoops = isSameLine(fwdNormalized, config.twilio_phone_number);

  const greetingValue = greetingInput ?? config.voicemail_greeting_url ?? "";
  const greetingDirty = greetingValue.trim() !== (config.voicemail_greeting_url || "");

  const saveForwardingNumber = () => {
    update.mutate(
      { forwardingNumber: fwdNormalized || null },
      {
        onSuccess: () => {
          setFwdInput(null);
          toast({ title: fwdNormalized ? "Forwarding number saved" : "Forwarding number cleared" });
        },
      },
    );
  };

  /**
   * Uploads a greeting into the existing `voicemails` bucket and stores its
   * public URL.
   *
   * The bucket is PUBLIC, and it has to be: Twilio's `<Play>` fetches the file
   * with no credentials, so a signed or private URL would produce a voicemail
   * greeting that silently plays nothing. The key is tenant-prefixed to match
   * how `twilio-voicemail-handler` writes recordings (`{tenantId}/vm-…`) — the
   * prefix is organisational, not a security boundary, so nothing secret goes
   * in here.
   */
  const uploadGreeting = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Keep the greeting under 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
      const path = `${tenant.id}/greeting-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voicemails")
        .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from("voicemails").getPublicUrl(path);
      if (!urlData?.publicUrl) throw new Error("Could not resolve the uploaded file's URL");

      await invokeVoice("update-forwarding", tenant.id, { voicemailGreetingUrl: urlData.publicUrl });
      setGreetingInput(null);
      refreshAll();
      toast({ title: "Greeting uploaded", description: "Callers will hear this instead of the default." });
    } catch (err: any) {
      fail(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-5 pt-1">
      {/* ── What is wrong, if anything ─────────────────────────────────── */}
      {readiness.problem && (
        <PanelNote tone="warn">
          <span className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="font-medium">{readiness.problem.title}.</strong>{" "}
              {readiness.problem.detail}
            </span>
          </span>
        </PanelNote>
      )}

      {/* ── The account dependency, stated rather than hidden ──────────── */}
      {!hasAccount && (
        <PanelNote>
          Calling and SMS share one Twilio account. This tenant has no Twilio account connected yet,
          so there is nothing to receive a call — open the{" "}
          <strong className="font-medium text-foreground">Twilio Messages</strong> card first and
          connect the account and phone number there. Calling can be switched on the moment that is
          done.
        </PanelNote>
      )}

      {/* ── Connection ─────────────────────────────────────────────────── */}
      <PanelSection title="Connection">
        <PanelCard>
          <PanelRow label="Business number" hint="The number customers call">
            {config.twilio_phone_number ? (
              <CopyValue value={config.twilio_phone_number} />
            ) : (
              <span className="text-muted-foreground">Not set</span>
            )}
          </PanelRow>
          <Separator className="-mx-3.5" />
          <PanelRow label="Twilio account" hint="Shared with Twilio Messages" mono>
            {config.twilio_account_sid ? (
              <CopyValue value={config.twilio_account_sid} />
            ) : (
              <span className="font-sans text-muted-foreground">Not connected</span>
            )}
          </PanelRow>
          <Separator className="-mx-3.5" />
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
            <>
              <Separator className="-mx-3.5" />
              <PanelRow label="Voice app" mono>
                <CopyValue value={config.twilio_twiml_app_sid} />
              </PanelRow>
            </>
          )}
        </PanelCard>

        {hasAccount && !voiceOn && (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Turning this on creates a voice app and an API key inside your own Twilio account, and
              points your number&rsquo;s voice webhook at Drive247. Your SMS setup is not touched.
            </p>
            <Button size="sm" onClick={() => setup.mutate()} disabled={!canManage || busy}>
              <PhoneCall className="size-3.5" />
              {setup.isPending ? "Setting up…" : "Turn on calling"}
            </Button>
          </div>
        )}
      </PanelSection>

      {voiceOn && (
        <>
          {/* ── Call forwarding ──────────────────────────────────────── */}
          <PanelSection
            title="Call forwarding"
            description="Ring a real phone at the same time as the browser. Whoever answers first gets the call."
            action={
              <Switch
                checked={!!config.call_forwarding_enabled}
                disabled={!canManage || busy}
                onCheckedChange={(v) => update.mutate({ callForwardingEnabled: v })}
              />
            }
          >
            {config.call_forwarding_enabled && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Forward to</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="+15551234567"
                      value={fwdValue}
                      disabled={!canManage}
                      onChange={(e) => setFwdInput(e.target.value)}
                      className="h-8 flex-1 font-mono text-[13px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || !fwdDirty || fwdInvalid || fwdLoops || update.isPending}
                      onClick={saveForwardingNumber}
                    >
                      Save
                    </Button>
                  </div>
                  {fwdInvalid && (
                    <p className="text-[11px] text-destructive">
                      Use the full international format, e.g. +15551234567. Twilio silently fails to
                      dial anything else.
                    </p>
                  )}
                  {!fwdInvalid && fwdLoops && (
                    <p className="text-[11px] text-destructive">
                      This is your own Twilio number — forwarding to it would make every call dial
                      itself.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">What your phone shows</Label>
                  <div className="grid gap-2">
                    <ModeOption
                      active={(config.forwarding_caller_id_mode ?? "caller") === "caller"}
                      disabled={!canManage || update.isPending}
                      onSelect={() => update.mutate({ forwardingCallerIdMode: "caller" })}
                      title="The caller's number"
                      detail="Your phone shows the customer's own number, so saved contacts, call history and calling back all work normally."
                    />
                    <ModeOption
                      active={config.forwarding_caller_id_mode === "business_line"}
                      disabled={!canManage || update.isPending}
                      onSelect={() => update.mutate({ forwardingCallerIdMode: "business_line" })}
                      title="Your business line"
                      detail="Your phone shows your Drive247 number, so you know it is a work call before answering. Because the customer's number is hidden, we speak their name to you before connecting."
                    />
                  </div>
                </div>
              </div>
            )}
          </PanelSection>

          {/* ── Voicemail ────────────────────────────────────────────── */}
          <PanelSection
            title="Voicemail"
            description="When nobody answers within 30 seconds, the caller can leave a message. It lands in that customer's conversation thread."
            action={
              <Switch
                checked={!!config.voicemail_enabled}
                disabled={!canManage || busy}
                onCheckedChange={(v) => update.mutate({ voicemailEnabled: v })}
              />
            }
          >
            {config.voicemail_enabled && (
              <div className="space-y-2.5">
                {config.voicemail_greeting_url ? (
                  <PanelCard className="space-y-2">
                    <div className="flex items-center gap-2">
                      <VoicemailIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Custom greeting</span>
                    </div>
                    <audio controls src={config.voicemail_greeting_url} className="w-full" />
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!canManage || update.isPending}
                        onClick={() =>
                          update.mutate(
                            { voicemailGreetingUrl: null },
                            { onSuccess: () => toast({ title: "Back to the default greeting" }) },
                          )
                        }
                      >
                        <Trash2 className="size-3" />
                        Remove
                      </Button>
                    </div>
                  </PanelCard>
                ) : (
                  <PanelCard>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Using the default greeting: &ldquo;You&rsquo;ve reached {tenant.company_name || "us"}.
                      No one is available right now. Please leave a message after the beep.&rdquo;
                    </p>
                  </PanelCard>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Custom greeting</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="https://…/greeting.mp3"
                      value={greetingValue}
                      disabled={!canManage || uploading}
                      onChange={(e) => setGreetingInput(e.target.value)}
                      className="h-8 flex-1 text-[13px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || !greetingDirty || update.isPending || uploading}
                      onClick={() =>
                        update.mutate(
                          { voicemailGreetingUrl: greetingValue.trim() || null },
                          {
                            onSuccess: () => {
                              setGreetingInput(null);
                              toast({ title: "Greeting saved" });
                            },
                          },
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadGreeting(file);
                      }}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!canManage || uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="size-3" />
                      {uploading ? "Uploading…" : "Upload an MP3 or WAV"}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Publicly readable by link — Twilio fetches it without a login.
                    </span>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Messages are capped at 2 minutes.
                </p>
              </div>
            )}
          </PanelSection>

          {/* ── Call recording ───────────────────────────────────────── */}
          <PanelSection
            title="Call recording"
            description="Records both sides, then transcribes and summarises the call into the customer's thread."
            action={
              <Switch
                checked={!!config.call_recording_enabled}
                disabled={!canManage || busy}
                onCheckedChange={(v) => update.mutate({ callRecordingEnabled: v })}
              />
            }
          >
            {/* The consent story is stated in full because it is genuinely
                asymmetric in the code: twilio-voice-inbound plays the notice on
                the CALLER's leg, while twilio-voice-connect plays it on the
                STAFF member's leg before the customer's phone even rings. An
                operator who reads "a consent notice plays" and assumes it
                covers outbound calls is exposed in every all-party-consent
                state. Do not shorten this to "a notice plays". */}
            <PanelNote tone={config.call_recording_enabled ? "warn" : "info"}>
              <p>
                <strong className="font-medium">Incoming calls:</strong> the caller hears &ldquo;This
                call may be recorded for quality and training purposes&rdquo; before anyone is
                connected.
              </p>
              <p className="mt-1.5">
                <strong className="font-medium">Outgoing calls you place from the browser:</strong>{" "}
                that notice plays to <em>you</em>, not to the customer — they are never told. In
                all-party-consent states (California, Florida, Illinois, Maryland, Massachusetts,
                Michigan, Montana, Nevada, New Hampshire, Pennsylvania and Washington) you must say
                it yourself before the conversation starts.
              </p>
              <p className="mt-1.5">
                The name announcement on a forwarded call is <em>not</em> a recording notice — it is
                spoken only to you, so the caller never hears it.
              </p>
            </PanelNote>
          </PanelSection>

          {/* ── Verify ───────────────────────────────────────────────── */}
          <PanelSection
            title="Verify"
            description="Prove the routing end to end before a real customer finds a gap in it."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage || previewCall.isPending}
                onClick={() => previewCall.mutate()}
              >
                <Play className="size-3.5" />
                {previewCall.isPending ? "Checking…" : "Preview routing"}
              </Button>

              <ConfirmAction
                trigger={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canManage || !config.forwarding_number || testCall.isPending}
                  >
                    <PhoneForwarded className="size-3.5" />
                    {testCall.isPending ? "Dialling…" : "Place a test call"}
                  </Button>
                }
                title="Place a real call?"
                description={
                  <>
                    This dials{" "}
                    <span className="font-mono">{config.forwarding_number || "your number"}</span>{" "}
                    for real, from your own Twilio account, and you will be billed for it at your
                    Twilio rate. Answer it to hear exactly what a forwarded call sounds like.
                  </>
                }
                confirmLabel="Call me now"
                onConfirm={() => testCall.mutate()}
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Preview costs nothing and rings nobody — it asks the server what it would do with an
              incoming call right now.
              {!config.forwarding_number && " A test call needs a forwarding number first."}
            </p>

            {preview && (
              <PanelCard className="space-y-2">
                <ul className="space-y-1">
                  {summarizePreview(preview).map((line) => (
                    <li key={line} className="flex gap-2 text-xs leading-relaxed text-foreground">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {line}
                    </li>
                  ))}
                </ul>
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none">Raw instructions sent to Twilio</summary>
                  <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                    {preview}
                  </pre>
                </details>
              </PanelCard>
            )}
          </PanelSection>

          {/* ── Recent calls ─────────────────────────────────────────── */}
          <PanelSection title="Recent calls">
            <RecentCalls tenantId={tenant.id} />
          </PanelSection>

          {/* ── Disconnect ───────────────────────────────────────────── */}
          <PanelSection>
            <Separator />
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Stop routing calls to Drive247. SMS and your phone number stay exactly as they are.
              </p>
              <ConfirmAction
                destructive
                trigger={
                  <Button size="sm" variant="destructive" disabled={!canManage || disable.isPending}>
                    {disable.isPending ? "Turning off…" : "Turn off"}
                  </Button>
                }
                title="Turn off calling?"
                description={
                  <>
                    This deletes the voice app and API key from your Twilio account and unhooks your
                    number from Drive247, so incoming calls stop reaching you immediately. Your call
                    history, recordings and voicemails are kept. Turning it back on recreates them
                    from scratch.
                  </>
                }
                confirmLabel="Turn off calling"
                onConfirm={() => disable.mutate()}
              />
            </div>
          </PanelSection>
        </>
      )}

      {!canManage && (
        <PanelNote>
          You can see this configuration but not change it. Twilio Calling settings can only be
          changed by an admin or head admin.
        </PanelNote>
      )}

      <PanelLink href="https://console.twilio.com/us1/monitor/logs/calls">
        Open call logs in Twilio
      </PanelLink>
    </div>
  );
}
