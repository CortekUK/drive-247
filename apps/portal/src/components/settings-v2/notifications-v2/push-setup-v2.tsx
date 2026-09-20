"use client";

/**
 * Notifications v2: "Push on this device", the push setup card (build-spec
 * D14, transcript §3.14 at 19:09–20:46: "the whole flow is already built, only
 * hidden — reuse it"; install the app on the phone, grant permission, a final
 * check, with every instruction on this page).
 *
 * A numbered checklist the operator can follow on the phone itself:
 *   1. Install the app. iPhone/iPad: Share → Add to Home Screen → open it from
 *      the Home Screen (push only exists there). Android and computers: the
 *      Install button when the browser offers one, else the browser menu; it
 *      is recommended there, not required. Only the steps for the detected
 *      platform show, with a toggle for the other one.
 *   2. Allow notifications: the existing enrol switch, with the unsupported,
 *      needs-install and blocked (how to unblock) states.
 *   3. Send a test to this device, with the result inline, then "Did it show
 *      up?" — the "final check on the phone". The page's `onSendTest` goes
 *      through notification-test-v2 so the test carries the Open in app button;
 *      that function is NOT deployed yet, so when it answers "not deployed" the
 *      card sends through the live send-push route instead and says so. The
 *      step never dead-ends on a function that hasn't shipped.
 * Then one line on what this page can't choose: banner vs lock screen is set on
 * the phone.
 *
 * REUSED, NOT EDITED: `usePushNotifications` (enrol, permission, send-push),
 * `usePwaInstall` (the parked install prompt) and `lib/push`. The only new call
 * is `registerServiceWorkerV2()`, made before the hook's own registration so
 * the hook resolves to the v2 worker (public/service-worker-v2.js) instead of
 * swapping the v1 worker back in on this page.
 *
 * GATES, as on the existing push screen: nothing mounts the push hook (so no
 * worker is registered) until the tenant is known AND
 * `tenants.push_notifications_enabled` is on; otherwise a calm "not switched on
 * yet" state with the support mailto. `canEdit` locks the switch and the test,
 * exactly like `PushNotificationSettings`, so a view-only user cannot enrol
 * their own device either. Installing is never gated.
 *
 * v2 only: rendered by the v2 Notifications page (northwind canary).
 */

import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { BellOff, Check, Download, Loader2, PlusSquare, Send, Share } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import { useTenant } from "@/contexts/TenantContext";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { registerServiceWorkerV2, type PushPlatform } from "@/lib/push";
import { useV2 } from "@/lib/v2-context";
import type { NotificationTestResponse } from "@/lib/notifications-v2/types";
import { cn } from "@/lib/utils";
import { SettingsSectionSkeleton } from "../section-states";
import { SETTINGS_SECTION_TITLE } from "../settings-kit";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

export const PUSH_SUPPORT_HREF = "mailto:support@drive-247.com";

export const PUSH_SETUP_TITLE = "Push on this device";

export const PUSH_SETUP_OFF_COPY = {
  headline: "Push isn't switched on for your account yet.",
  body: "We switch it on for you. Ask support when you want it.",
  action: "Contact support",
} as const;

/**
 * The test message itself. The page hands the card an `onSendTest` that goes
 * through notification-test-v2 (so the test carries the Open in app button);
 * when that function isn't deployed the card falls back to `usePushNotifications`'
 * own send-push call with "Just my devices", which is live, and sends exactly
 * this message either way.
 */
export const PUSH_SETUP_TEST_MESSAGE = {
  title: "Test notification",
  body: "If you can see this, push works on this device.",
  url: "/settings?tab=notifications",
} as const;

/** Said on the result line when the test went out the old way (see `testSenderMissing`). */
export const PUSH_SETUP_FALLBACK_NOTE =
  "Sent the way notifications go out today. The Open in app button only shows once the new test sender is deployed.";

/**
 * True when `onSendTest` failed because notification-test-v2 isn't there —
 * a 404 from the gateway (`not_deployed`) or a fetch that never reached it
 * (`network`, supabase-js' FunctionsFetchError). Step 3 is the "final check on
 * the phone" (transcript 20:18–20:46): it must not be the one step that breaks
 * because a NEW function hasn't shipped, so the card retries the live sender.
 * Any other failure (no devices, a role the function refuses, a bad session) is
 * a real answer and is shown as it is.
 */
export function testSenderMissing(response: NotificationTestResponse | null | undefined): boolean {
  if (!response) return true;
  if (response.success !== false && !response.error) return false;
  const code = typeof response.code === "string" ? response.code : "";
  if (code === "not_deployed" || code === "network") return true;
  const text = `${response.error ?? ""} ${response.message ?? ""}`.toLowerCase();
  return text.includes("not deployed") || text.includes("was not found");
}

/* -------------------------------------------------------------------------- */
/* Pure state                                                                  */
/* -------------------------------------------------------------------------- */

/** Which install steps a device needs: iPhone/iPad, or everything else. */
export type PushSetupPlatform = "iphone" | "other";

export function pushSetupPlatform(platform: PushPlatform | string | null | undefined): PushSetupPlatform {
  return platform === "ios" ? "iphone" : "other";
}

export type PushInstallState = "done" | "required" | "recommended";
export type PushAllowState = "loading" | "needs-install" | "unsupported" | "blocked" | "off" | "on";

export interface PushSetupState {
  install: PushInstallState;
  allow: PushAllowState;
  /** Step 3 can run: this device is enrolled. */
  canTest: boolean;
}

/**
 * The checklist's state, from what the hooks report. Order matters in `allow`:
 * an iPhone in a Safari tab has no push APIs at all, which is "install first",
 * never "unsupported".
 */
export function pushSetupState(input: {
  platform: PushSetupPlatform;
  installed: boolean;
  needsInstall: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  loading: boolean;
}): PushSetupState {
  const install: PushInstallState = input.installed
    ? "done"
    : input.platform === "iphone"
      ? "required"
      : "recommended";

  let allow: PushAllowState;
  if (input.needsInstall) allow = "needs-install";
  else if (!input.supported) allow = input.platform === "iphone" && !input.installed ? "needs-install" : "unsupported";
  else if (input.loading) allow = "loading";
  else if (input.permission === "denied") allow = "blocked";
  else if (input.subscribed) allow = "on";
  else allow = "off";

  return { install, allow, canTest: allow === "on" };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface PushSetupV2Props {
  /** Same gate as the existing push screen: the switch and the test need edit rights. */
  canEdit?: boolean;
  /**
   * Send the test another way (e.g. notification-test-v2). Without it — or when
   * that function answers "not deployed" (`testSenderMissing`) — the card uses
   * the existing send-push with "Just my devices".
   */
  onSendTest?: () => Promise<NotificationTestResponse>;
  className?: string;
}

export function PushSetupV2(props: PushSetupV2Props) {
  const { tenant } = useTenant();

  if (!tenant) {
    return (
      <SettingsSectionSkeleton variant="rows" rows={3} label="Loading push setup" className={props.className} />
    );
  }

  if (tenant.push_notifications_enabled !== true) {
    return (
      <SetupCard className={props.className}>
        <div data-push-setup="off" className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{PUSH_SETUP_OFF_COPY.headline}</span>{" "}
              {PUSH_SETUP_OFF_COPY.body}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-auto">
            <a href={PUSH_SUPPORT_HREF}>{PUSH_SETUP_OFF_COPY.action}</a>
          </Button>
        </div>
      </SetupCard>
    );
  }

  return <PushSetupSteps {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Steps (only mounted with the tenant flag on)                                */
/* -------------------------------------------------------------------------- */

// useLayoutEffect warns during server rendering; nothing here runs there anyway.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type TestResult =
  | { kind: "sent"; sent: number | null; failed: number; fellBack?: boolean }
  | { kind: "none"; message: string; fellBack?: boolean }
  | { kind: "error"; message: string };

function PushSetupSteps({ canEdit = true, onSendTest, className }: PushSetupV2Props) {
  const v2Chrome = useV2("chrome");
  const push = usePushNotifications();
  const pwa = usePwaInstall();

  // A layout effect runs before every passive effect of the same commit, so
  // this registers the v2 worker BEFORE the push hook's reconcile effect asks
  // for a registration; the hook then gets this one instead of registering the
  // v1 script and replacing the v2 worker on this page.
  useIsoLayoutEffect(() => {
    if (v2Chrome) void registerServiceWorkerV2();
  }, [v2Chrome]);

  const platform = pushSetupPlatform(push.capability?.platform);
  const installed = pwa.isInstalled || push.capability?.standalone === true;
  const state = pushSetupState({
    platform,
    installed,
    needsInstall: push.needsInstall,
    supported: push.isSupported,
    permission: push.permission,
    subscribed: push.isSubscribed,
    loading: push.isLoading,
  });

  const [showOther, setShowOther] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [arrived, setArrived] = useState<"yes" | "no" | null>(null);

  const handleInstall = async () => {
    setInstallNote(null);
    const accepted = await pwa.install();
    setInstallNote(
      accepted
        ? "Installed. Open it from your Home Screen or app list."
        : "Not installed. You can install it later from your browser menu.",
    );
  };

  const handleToggle = async (next: boolean) => {
    setResult(null);
    setArrived(null);
    await (next ? push.enable() : push.disable());
  };

  const handleTest = async () => {
    setSending(true);
    setResult(null);
    setArrived(null);
    try {
      // The new sender first, when the page gave us one. If it simply isn't
      // deployed, fall through to the live send-push route rather than leaving
      // the operator with an invoke error on the one step that proves push works.
      let fellBack = !onSendTest;
      if (onSendTest) {
        const response = await onSendTest();
        if (testSenderMissing(response)) {
          fellBack = true;
        } else if (response.success === false || response.error) {
          setResult({ kind: "error", message: response.error || response.message || "The test wasn't sent." });
          return;
        } else if (response.sent === 0) {
          setResult({ kind: "none", message: response.message || "" });
          return;
        } else {
          setResult({
            kind: "sent",
            sent: typeof response.sent === "number" ? response.sent : null,
            failed: response.failed ?? 0,
          });
          return;
        }
      }

      const response = await push.sendPush.mutateAsync({ target: "self", ...PUSH_SETUP_TEST_MESSAGE });
      // `fellBack` is only worth saying when the new sender was meant to run:
      // without `onSendTest` this route IS the card's normal one.
      const note = fellBack && !!onSendTest;
      if (!response || response.sent === 0) {
        setResult({ kind: "none", message: response?.message || "", fellBack: note });
      } else {
        setResult({ kind: "sent", sent: response.sent, failed: response.failed ?? 0, fellBack: note });
      }
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error && err.message ? err.message : "The test wasn't sent." });
    } finally {
      setSending(false);
    }
  };

  const otherPlatform: PushSetupPlatform = platform === "iphone" ? "other" : "iphone";

  return (
    <SetupCard className={className}>
      <ol className="divide-y" aria-label="Push setup steps">
        {/* ---- 1. Install ------------------------------------------------ */}
        <Step
          n={1}
          id="install"
          done={state.install === "done"}
          title="Install the app"
          tag={state.install === "required" ? "Needed on iPhone" : state.install === "recommended" ? "Recommended" : undefined}
        >
          {state.install === "done" ? (
            <p className="text-[13px] text-muted-foreground">Installed. You're using the app.</p>
          ) : platform === "iphone" ? (
            <IphoneInstallSteps />
          ) : (
            <OtherInstallSteps canPrompt={pwa.canPrompt} onInstall={handleInstall} note={installNote} />
          )}
          {state.install !== "done" && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                aria-expanded={showOther}
                onClick={() => setShowOther((open) => !open)}
              >
                {showOther
                  ? otherPlatform === "iphone"
                    ? "Hide iPhone steps"
                    : "Hide Android and computer steps"
                  : otherPlatform === "iphone"
                    ? "On an iPhone? Show those steps"
                    : "On Android or a computer? Show those steps"}
              </Button>
              {showOther &&
                (otherPlatform === "iphone" ? (
                  <IphoneInstallSteps />
                ) : (
                  <OtherInstallSteps canPrompt={false} onInstall={handleInstall} note={null} />
                ))}
            </div>
          )}
        </Step>

        {/* ---- 2. Allow notifications ------------------------------------ */}
        <Step
          n={2}
          id="allow"
          done={state.allow === "on"}
          title="Allow notifications"
          control={
            state.allow === "loading" ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking this device" />
            ) : state.allow === "off" || state.allow === "on" || state.allow === "blocked" ? (
              <div className="flex items-center gap-2">
                {push.isBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
                <Switch
                  checked={push.isSubscribed}
                  onCheckedChange={handleToggle}
                  disabled={push.isBusy || state.allow === "blocked" || !canEdit}
                  aria-label="Push notifications on this device"
                />
              </div>
            ) : null
          }
        >
          <AllowCopy state={state.allow} platform={platform} canEdit={canEdit} />
          {push.error && state.allow !== "blocked" && (
            <p role="alert" className="text-[13px] text-destructive [overflow-wrap:anywhere]">
              {push.error}
            </p>
          )}
        </Step>

        {/* ---- 3. Test --------------------------------------------------- */}
        <Step n={3} id="test" done={arrived === "yes"} title="Send a test to this device">
          <p className="text-[13px] text-muted-foreground">
            {state.canTest
              ? "Sends a test to your devices that have notifications on, including this one."
              : "Turn on notifications in step 2 first."}
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!state.canTest || !canEdit || sending}
              aria-busy={sending || undefined}
            >
              {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              {sending ? "Sending…" : "Send a test"}
            </Button>
          </div>
          <TestResultView
            result={result}
            arrived={arrived}
            platform={platform}
            onArrived={setArrived}
          />
        </Step>
      </ol>

      <p className="border-t px-5 py-3 text-[13px] leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">How push looks:</span> whether it shows as a banner, on the
        lock screen or with a sound is set on the phone, not here. On iPhone: Settings, then Notifications, then
        this app. On Android: press and hold a notification, then tap the settings icon.
      </p>
    </SetupCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                       */
/* -------------------------------------------------------------------------- */

function SetupCard({ children, className }: { children: ReactNode; className?: string }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-settings-section="push-setup"
      className={cn("rounded-xl border bg-card", className)}
    >
      <div className="px-5 pt-4 pb-1">
        <h2 id={titleId} className={SETTINGS_SECTION_TITLE}>
          {PUSH_SETUP_TITLE}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Alerts on this phone or computer, even when the portal is closed. Do these steps on each device you
          want alerts on.
        </p>
      </div>
      {children}
    </section>
  );
}

function Step({
  n,
  id,
  done,
  title,
  tag,
  control,
  children,
}: {
  n: number;
  id: string;
  done: boolean;
  title: string;
  tag?: string;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li data-step={id} data-done={done || undefined} className="flex gap-3 px-5 py-4">
      <span
        aria-hidden="true"
        className={cn(
          "mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
          done
            ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
            : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="sr-only">{done ? "Done: " : `Step ${n}: `}</span>
            {title}
            {tag && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{tag}</span>
            )}
          </h3>
          {control}
        </div>
        {children}
      </div>
    </li>
  );
}

function SubSteps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-1.5 text-[13px] text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
          >
            {String.fromCharCode(97 + i)}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function IphoneInstallSteps() {
  return (
    <div data-install-steps="iphone" className="space-y-1.5">
      <p className="text-[13px] text-muted-foreground">On iPhone and iPad, push only works in the installed app.</p>
      <SubSteps
        items={[
          <>
            In Safari, tap Share <Share className="inline size-3.5 align-[-2px]" aria-hidden="true" />
          </>,
          <>
            Choose <span className="font-medium text-foreground">Add to Home Screen</span>{" "}
            <PlusSquare className="inline size-3.5 align-[-2px]" aria-hidden="true" />
          </>,
          "Open the app from your Home Screen and come back to this page.",
        ]}
      />
    </div>
  );
}

function OtherInstallSteps({
  canPrompt,
  onInstall,
  note,
}: {
  canPrompt: boolean;
  onInstall: () => void;
  note: string | null;
}) {
  return (
    <div data-install-steps="other" className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        On Android and computers push works in the browser too. Installed, notifications show your company name
        instead of the browser's.
      </p>
      {canPrompt ? (
        <Button type="button" variant="outline" size="sm" onClick={onInstall}>
          <Download data-icon="inline-start" />
          Install
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          If your browser offers it, open its menu and choose{" "}
          <span className="font-medium text-foreground">Install app</span> (on Android it may say Add to Home
          screen).
        </p>
      )}
      {note && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

function AllowCopy({
  state,
  platform,
  canEdit,
}: {
  state: PushAllowState;
  platform: PushSetupPlatform;
  canEdit: boolean;
}) {
  const muted = "text-[13px] text-muted-foreground";
  switch (state) {
    case "loading":
      return <p className={muted}>Checking this device…</p>;
    case "needs-install":
      return (
        <p data-allow-state="needs-install" className={muted}>
          Do step 1 first. Then open the app from your Home Screen and turn this on there.
        </p>
      );
    case "unsupported":
      return (
        <p data-allow-state="unsupported" className={muted}>
          This browser can't get push notifications. Use Chrome or Edge on a computer or Android phone, or Safari on
          iPhone after installing the app.
        </p>
      );
    case "blocked":
      return (
        <div data-allow-state="blocked" role="alert" className="space-y-1 text-[13px]">
          <p className="font-medium text-destructive">Notifications are blocked for this site.</p>
          <p className="text-muted-foreground">
            {platform === "iphone"
              ? "To unblock: open the Settings app, tap Notifications, find this app and turn on Allow Notifications. Then come back here."
              : "To unblock: tap or click the icon to the left of the web address, open the site settings, set Notifications to Allow, then reload this page."}
          </p>
        </div>
      );
    case "on":
      return (
        <p data-allow-state="on" className={muted}>
          On. This device gets push notifications.
        </p>
      );
    case "off":
    default:
      return (
        <p data-allow-state="off" className={muted}>
          {canEdit
            ? "Turn this on, then tap Allow when your browser asks."
            : "View only: you can't turn this on. Ask an admin for edit access."}
        </p>
      );
  }
}

/** One muted line when step 3 had to use the live sender instead of the new one. */
function FallbackNote() {
  return (
    <p data-test-fallback="" className="text-[13px] text-muted-foreground">
      {PUSH_SETUP_FALLBACK_NOTE}
    </p>
  );
}

function TestResultView({
  result,
  arrived,
  platform,
  onArrived,
}: {
  result: TestResult | null;
  arrived: "yes" | "no" | null;
  platform: PushSetupPlatform;
  onArrived: (value: "yes" | "no") => void;
}) {
  if (!result) return null;

  if (result.kind === "error") {
    return (
      <p role="alert" data-test-result="error" className="text-[13px] text-destructive [overflow-wrap:anywhere]">
        Couldn't send the test. {result.message}
      </p>
    );
  }

  if (result.kind === "none") {
    return (
      <div role="status" data-test-result="none" className="space-y-1 text-[13px] text-muted-foreground">
        <p>Nothing was sent: none of your devices have notifications on yet. Finish step 2, then try again.</p>
        {result.fellBack && <FallbackNote />}
      </div>
    );
  }

  const reached =
    result.sent === null
      ? "Sent."
      : `Sent to ${result.sent} of your device${result.sent === 1 ? "" : "s"}${
          result.failed > 0 ? ` (${result.failed} didn't take it)` : ""
        }.`;

  return (
    <div role="status" data-test-result="sent" className="space-y-2 text-[13px]">
      <p className="text-muted-foreground">
        {reached} It should show up within a few seconds.
      </p>
      {result.fellBack && <FallbackNote />}
      {arrived === null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground">Did it show up on this device?</span>
          <Button type="button" variant="outline" size="xs" onClick={() => onArrived("yes")}>
            Yes
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => onArrived("no")}>
            No
          </Button>
        </div>
      )}
      {arrived === "yes" && (
        <p data-arrived="yes" className="font-medium text-foreground">
          Push works on this device.
        </p>
      )}
      {arrived === "no" && (
        <div data-arrived="no" className="space-y-1">
          <p className="font-medium text-foreground">Things to check</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Do Not Disturb or Focus is off.</li>
            {platform === "iphone" && <li>You opened the app from your Home Screen, not from Safari.</li>}
            <li>Notifications for this app are allowed in the phone's settings.</li>
            <li>Turn step 2 off and on again, then send another test.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
