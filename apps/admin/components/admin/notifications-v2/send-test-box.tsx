'use client';

/**
 * Notifications v2, SYSTEM set: Send test.
 *
 * The admin twin of the portal's `send-test-box.tsx`. A "Send test" button;
 * pressing it opens a box right underneath (inline, never a dialog):
 *   email  the recipient, pre-filled with the signed-in super admin's address
 *          and editable, then Send and Cancel. Enter sends, Escape closes.
 *   push   one line saying where it goes (this super admin's own devices,
 *          enrolled under Settings → Platform push), then Send and Cancel.
 *
 * The send goes through `usePlatformNotificationTest`, which always resolves
 * with a showable `message` and never throws. `buildRequest` may throw an Error
 * carrying a plain sentence (the template has a problem): that sentence is
 * shown and nothing is sent.
 *
 * Unlike the portal's, this one sends at PLATFORM scope: the From is
 * "Drive 247 <noreply@drive-247.com>", the mail carries our branding rather
 * than any operator's, and no tenant is resolved at all.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlatformNotificationTest } from '@/hooks/use-platform-notification-test';
import { isValidEmail } from '@/lib/notifications-v2/settings-model';
import type { NotificationTestRequest, NotificationTestResponse } from '@/lib/notifications-v2/types';
import { cn } from '@/lib/utils';

type EmailTestRequest = Extract<NotificationTestRequest, { channel: 'email' }>;
type PushTestRequest = Extract<NotificationTestRequest, { channel: 'push' }>;

/** What the panel builds: the request without the recipient (this box adds it). */
export type SendTestDraft = Omit<EmailTestRequest, 'to'> | PushTestRequest;

export type SendTestChannel = 'email' | 'push';

export const SEND_TEST_COPY = {
  button: 'Send test',
  send: 'Send',
  sending: 'Sending…',
  cancel: 'Cancel',
  emailLabel: 'Send the test to',
  emailHint: 'The subject starts with [Test]. Variables show example values.',
  pushHint: 'Goes to your own devices, the ones you turned on under Settings → Platform push.',
  emailMissing: 'Add an email address to send the test to.',
  emailInvalid: 'Enter a valid email address, like name@company.com.',
  failedFallback: 'The test wasn’t sent. Try again in a moment.',
  noDevices:
    'Nothing was sent: none of your devices have platform notifications turned on. Turn them on under Settings → Platform push.',
} as const;

export type SendTestResult =
  | { kind: 'sent'; message: string }
  | { kind: 'none'; message: string }
  | { kind: 'error'; message: string };

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message.trim()
    ? err.message.trim()
    : typeof err === 'string' && err.trim()
      ? err.trim()
      : SEND_TEST_COPY.failedFallback;

/** How a reply reads in the box. The server's own sentence wins whenever it sent one. */
export function sendTestResult(
  response: NotificationTestResponse | null | undefined,
  channel: SendTestChannel,
  to?: string,
): SendTestResult {
  if (!response) return { kind: 'error', message: SEND_TEST_COPY.failedFallback };
  const message = typeof response.message === 'string' ? response.message.trim() : '';
  const error = typeof response.error === 'string' ? response.error.trim() : '';

  const nothingReached =
    channel === 'push' && (response.code === 'no_devices' || (response.success && response.sent === 0));
  if (nothingReached) return { kind: 'none', message: message || error || SEND_TEST_COPY.noDevices };

  if (response.success !== true || error) {
    return { kind: 'error', message: error || message || SEND_TEST_COPY.failedFallback };
  }

  if (message) return { kind: 'sent', message };
  if (channel === 'email') return { kind: 'sent', message: to ? `Sent to ${to}.` : 'Sent.' };
  const sent = typeof response.sent === 'number' ? response.sent : null;
  if (sent === null) return { kind: 'sent', message: 'Sent.' };
  const failed =
    typeof response.failed === 'number' && response.failed > 0 ? ` ${response.failed} didn’t take it.` : '';
  return { kind: 'sent', message: `Sent to ${sent} of your device${sent === 1 ? '' : 's'}.${failed}` };
}

/** The request the edge function gets: the panel's draft, plus the recipient. */
export function buildTestRequest(
  draft: SendTestDraft,
  channel: SendTestChannel,
  notificationKey: string,
  to: string,
): NotificationTestRequest {
  const key = notificationKey || draft.notificationKey;
  if (channel === 'email') {
    const d = draft as Partial<EmailTestRequest>;
    return { channel: 'email', notificationKey: key, to, subject: d.subject ?? '', bodyHtml: d.bodyHtml ?? '' };
  }
  const d = draft as Partial<PushTestRequest>;
  const request: PushTestRequest = { channel: 'push', notificationKey: key, title: d.title ?? '', body: d.body ?? '' };
  if (d.url) request.url = d.url;
  if (d.pushOptions) request.pushOptions = d.pushOptions;
  return request;
}

export interface SendTestBoxProps {
  channel: SendTestChannel;
  notificationKey: string;
  /** The message to test, already filled with example values. May throw a plain Error. */
  buildRequest: () => SendTestDraft;
  /** The signed-in super admin's email: the recipient until they change it. */
  defaultEmail?: string | null;
  /** False while a test cannot go (not a super admin, or a template problem). */
  canSend?: boolean;
  /** Why it cannot, shown beside the button. */
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
  const { sendTest, isSending } = usePlatformNotificationTest();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail ?? '');
  const [result, setResult] = useState<SendTestResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  // The signed-in admin's address arrives after the first render.
  useEffect(() => {
    if (defaultEmail && !to) setTo(defaultEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fills an empty field
  }, [defaultEmail]);

  useEffect(() => {
    if (open && channel === 'email') inputRef.current?.focus();
  }, [open, channel]);

  const send = async (): Promise<void> => {
    if (channel === 'email') {
      const recipient = to.trim();
      if (!recipient) {
        setResult({ kind: 'error', message: SEND_TEST_COPY.emailMissing });
        return;
      }
      if (!isValidEmail(recipient)) {
        setResult({ kind: 'error', message: SEND_TEST_COPY.emailInvalid });
        return;
      }
    }
    let request: NotificationTestRequest;
    try {
      request = buildTestRequest(buildRequest(), channel, notificationKey, to.trim());
    } catch (err) {
      setResult({ kind: 'error', message: errorMessage(err) });
      return;
    }
    try {
      const response = await sendTest(request);
      setResult(sendTestResult(response, channel, to.trim()));
    } catch (err) {
      // The hook never throws, but a caller must not be left with no answer.
      setResult({ kind: 'error', message: errorMessage(err) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void send();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>
        {!canSend && disabledReason && (
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-test-blocked="">
            {disabledReason}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canSend}
          data-send-test={channel}
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
        >
          <Send aria-hidden="true" className="size-3.5" />
          {SEND_TEST_COPY.button}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn('w-full max-w-sm space-y-2 rounded-xl border border-border bg-card p-3', className)}
      data-send-test-box={channel}
    >
      {channel === 'email' ? (
        <div className="space-y-1">
          <label htmlFor={`${ids}-to`} className="block text-xs font-medium text-foreground">
            {SEND_TEST_COPY.emailLabel}
          </label>
          <Input
            ref={inputRef}
            id={`${ids}-to`}
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="you@drive-247.com"
            aria-describedby={`${ids}-hint`}
            className="h-8 text-sm"
          />
          <p id={`${ids}-hint`} className="text-[11px] text-muted-foreground">
            {SEND_TEST_COPY.emailHint}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">{SEND_TEST_COPY.pushHint}</p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={isSending} onClick={() => void send()} data-send-test-confirm="">
          {isSending ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
          {isSending ? SEND_TEST_COPY.sending : SEND_TEST_COPY.send}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isSending} onClick={() => setOpen(false)}>
          {SEND_TEST_COPY.cancel}
        </Button>
      </div>

      <p
        role="status"
        aria-live="polite"
        data-send-test-result={result?.kind ?? ''}
        className={cn(
          'min-h-4 text-xs [overflow-wrap:anywhere]',
          result?.kind === 'sent' && 'text-success',
          result?.kind === 'none' && 'text-warning',
          result?.kind === 'error' && 'text-destructive',
        )}
      >
        {result?.message ?? ''}
      </p>
    </div>
  );
}

export default SendTestBox;
