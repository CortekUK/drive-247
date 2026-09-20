"use client";

/**
 * Notifications v2: Send test (transcript §3.8 at 12:02, "a Send test button;
 * a box opens underneath with the operator's email filled in by default; they
 * can change it; we send it", and §3.9 at 13:35, a test push to themselves).
 *
 * A "Send test" button; pressing it opens a box right underneath (inline, not
 * a dialog):
 *   email  the recipient, pre-filled with the signed-in operator's email and
 *          editable, then Send and Cancel. Enter sends, Escape closes.
 *   push   one line saying where it goes (the operator's own devices that are
 *          turned on in "Push on this device"), then Send and Cancel.
 * The result shows in the box, in a polite live region: green when it went,
 * amber when nothing could be delivered (no device turned on), red with the
 * server's own sentence when it failed.
 *
 * The page builds the message (`buildRequest`, filled with example values);
 * this box adds the recipient and calls `useNotificationTestV2().sendTest`,
 * which always resolves with an operator-facing `message` (it never throws;
 * a throw is still caught here, just in case). `buildRequest` may throw an
 * Error with a plain sentence (e.g. the template has a problem): that sentence
 * is shown and nothing is sent.
 *
 * v2 only: rendered inside the v2 Notifications page's item panel.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { useNotificationTestV2 } from "@/hooks/use-notification-test-v2";
import type { NotificationTestRequest, NotificationTestResponse } from "@/lib/notifications-v2/types";
import { isValidEmail } from "@/lib/notifications-v2/settings-model";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types and copy                                                              */
/* -------------------------------------------------------------------------- */

type EmailTestRequest = Extract<NotificationTestRequest, { channel: "email" }>;
type PushTestRequest = Extract<NotificationTestRequest, { channel: "push" }>;

/** What the page builds: the test request without the recipient (this box adds it). */
export type SendTestDraft = Omit<EmailTestRequest, "to"> | PushTestRequest;

export type SendTestChannel = "email" | "push";

export const SEND_TEST_COPY = {
  button: "Send test",
  send: "Send",
  sending: "Sending…",
  cancel: "Cancel",
  close: "Close",
  emailLabel: "Send the test to",
  emailHint: "The subject starts with [Test]. Variables show example values.",
  pushHint: "Sends to the devices you turned on in Push on this device.",
  emailMissing: "Add an email address to send the test to.",
  emailInvalid: "Enter a valid email address, like name@company.com.",
  failedLead: "Couldn't send the test.",
  failedFallback: "The test wasn't sent. Try again in a moment.",
  noDevices: "Nothing was sent: none of your devices have notifications turned on. Turn them on in Push on this device.",
} as const;

export type SendTestResult =
  | { kind: "sent"; message: string }
  | { kind: "none"; message: string }
  | { kind: "error"; message: string };

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message.trim()
    ? err.message.trim()
    : typeof err === "string" && err.trim()
      ? err.trim()
      : SEND_TEST_COPY.failedFallback;

/** How a reply reads in the box. The server's own sentence wins whenever it sent one. */
export function sendTestResult(
  response: NotificationTestResponse | null | undefined,
  channel: SendTestChannel,
  to?: string,
): SendTestResult {
  if (!response) return { kind: "error", message: SEND_TEST_COPY.failedFallback };
  const message = typeof response.message === "string" ? response.message.trim() : "";
  const error = typeof response.error === "string" ? response.error.trim() : "";

  const nothingReached = channel === "push" && (response.code === "no_devices" || (response.success && response.sent === 0));
  if (nothingReached) return { kind: "none", message: message || error || SEND_TEST_COPY.noDevices };

  if (response.success !== true || error) {
    return { kind: "error", message: error || message || SEND_TEST_COPY.failedFallback };
  }

  if (message) return { kind: "sent", message };
  if (channel === "email") return { kind: "sent", message: to ? `Sent to ${to}.` : "Sent." };
  const sent = typeof response.sent === "number" ? response.sent : null;
  if (sent === null) return { kind: "sent", message: "Sent." };
  const failed = typeof response.failed === "number" && response.failed > 0 ? ` ${response.failed} didn't take it.` : "";
  return { kind: "sent", message: `Sent to ${sent} of your device${sent === 1 ? "" : "s"}.${failed}` };
}

/** The request the edge function gets: the page's draft, this box's channel and key, and the recipient. */
export function buildTestRequest(
  draft: SendTestDraft,
  channel: SendTestChannel,
  notificationKey: string,
  to: string,
): NotificationTestRequest {
  const key = notificationKey || draft.notificationKey;
  if (channel === "email") {
    const d = draft as Partial<EmailTestRequest>;
    return { channel: "email", notificationKey: key, to, subject: d.subject ?? "", bodyHtml: d.bodyHtml ?? "" };
  }
  const d = draft as Partial<PushTestRequest>;
  const request: PushTestRequest = { channel: "push", notificationKey: key, title: d.title ?? "", body: d.body ?? "" };
  if (d.url) request.url = d.url;
  if (d.pushOptions) request.pushOptions = d.pushOptions;
  return request;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface SendTestBoxProps {
  channel: SendTestChannel;
  notificationKey: string;
  /** The message to test, already filled with example values. May throw an Error with a plain sentence. */
  buildRequest: () => SendTestDraft;
  /** The signed-in operator's email: the recipient until they change it. */
  defaultEmail?: string | null;
  /** False while a test can't go (view only, a template problem, push not set up). */
  canSend?: boolean;
  /** Why it can't, shown beside the button. */
  disabledReason?: string | null;
  className?: string;
}

export function SendTestBox({
  channel,
  notificationKey,
  buildRequest,
  defaultEmail,
  canSend = true,
  disabledReason,
  className,
}: SendTestBoxProps) {
  const { sendTest } = useNotificationTestV2();

  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail ?? "");
  const [toEdited, setToEdited] = useState(false);
  const [toError, setToError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendTestResult | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  // Bumped on close and unmount, so a reply that lands afterwards is dropped.
  const run = useRef(0);

  const id = useId();
  const boxId = `${id}-box`;
  const inputId = `${id}-to`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const reasonId = `${id}-reason`;

  // Follow the signed-in email (it can arrive after the first render) until
  // the operator types their own.
  useEffect(() => {
    if (!toEdited) setTo(defaultEmail ?? "");
  }, [defaultEmail, toEdited]);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    if (channel === "email") inputRef.current?.focus();
    else sendRef.current?.focus();
  }, [open, channel]);

  const blocked = !canSend;
  const reason = blocked && disabledReason ? disabledReason : null;

  const openBox = () => {
    setResult(null);
    setToError(null);
    setOpen(true);
  };

  const close = () => {
    if (busy) return;
    run.current += 1;
    setOpen(false);
    setResult(null);
    setToError(null);
    triggerRef.current?.focus();
  };

  const send = async () => {
    if (busy || blocked) return;
    let recipient = "";
    if (channel === "email") {
      recipient = to.trim();
      const problem = !recipient ? SEND_TEST_COPY.emailMissing : isValidEmail(recipient) ? null : SEND_TEST_COPY.emailInvalid;
      if (problem) {
        setToError(problem);
        setResult(null);
        inputRef.current?.focus();
        return;
      }
    }
    setToError(null);

    let request: NotificationTestRequest;
    try {
      request = buildTestRequest(buildRequest(), channel, notificationKey, recipient);
    } catch (err) {
      setResult({ kind: "error", message: errorMessage(err) });
      return;
    }

    const mine = ++run.current;
    setBusy(true);
    setResult(null);
    try {
      const response = await sendTest(request);
      if (run.current !== mine) return;
      setResult(sendTestResult(response, channel, recipient));
    } catch (err) {
      if (run.current !== mine) return;
      setResult({ kind: "error", message: errorMessage(err) });
    } finally {
      if (run.current === mine) setBusy(false);
    }
  };

  const onBoxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div data-send-test={channel} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (open ? close() : openBox())}
          disabled={(blocked && !open) || busy}
          aria-expanded={open}
          aria-controls={open ? boxId : undefined}
          aria-describedby={reason ? reasonId : undefined}
        >
          <Send data-icon="inline-start" />
          {SEND_TEST_COPY.button}
        </Button>
        {reason && (
          <p id={reasonId} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {reason}
          </p>
        )}
      </div>

      {open && (
        <div
          id={boxId}
          role="group"
          aria-label={channel === "email" ? "Send a test email" : "Send a test push"}
          onKeyDown={onBoxKeyDown}
          className="space-y-3 rounded-xl border bg-card p-4"
        >
          {channel === "email" ? (
            <div className="space-y-1.5">
              <label htmlFor={inputId} className="block text-[13px] font-medium text-foreground">
                {SEND_TEST_COPY.emailLabel}
              </label>
              <Input
                ref={inputRef}
                id={inputId}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={to}
                placeholder="name@company.com"
                onChange={(e) => {
                  setTo(e.target.value);
                  setToEdited(true);
                  setToError(null);
                }}
                onKeyDown={onInputKeyDown}
                disabled={busy}
                aria-invalid={toError ? true : undefined}
                aria-describedby={toError ? errorId : hintId}
                className="max-w-sm"
              />
              {toError ? (
                <p id={errorId} role="alert" className="text-xs text-destructive">
                  {toError}
                </p>
              ) : (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {SEND_TEST_COPY.emailHint}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{SEND_TEST_COPY.pushHint}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={sendRef}
              type="button"
              size="sm"
              onClick={() => void send()}
              disabled={busy || blocked}
              aria-busy={busy || undefined}
              className="min-w-[88px]"
            >
              {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {busy ? SEND_TEST_COPY.sending : SEND_TEST_COPY.send}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>
              {result ? SEND_TEST_COPY.close : SEND_TEST_COPY.cancel}
            </Button>
          </div>

          <div role="status" aria-live="polite" data-send-test-result={result?.kind ?? ""}>
            {result && (
              <p
                className={cn(
                  "text-[13px] [overflow-wrap:anywhere]",
                  result.kind === "sent" && "text-emerald-600 dark:text-emerald-400",
                  result.kind === "none" && "text-amber-700 dark:text-amber-400",
                  result.kind === "error" && "text-destructive",
                )}
              >
                {result.kind === "error" ? `${SEND_TEST_COPY.failedLead} ${result.message}` : result.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
