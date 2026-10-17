'use client';

/**
 * Notifications › Setups › Email sender, for the super admin dashboard: the
 * operator portal's Email setup (email-sender-settings-v2.tsx) drawn the same
 * way, at platform scope.
 *
 *   Sender name       the display name; empty = "Drive 247"
 *   Send from         [local part]@drive-247.com; empty = noreply
 *   Replies go to     optional reply-to
 *   Operators see:    the From line, live (settings-model senderAddress)
 *   Team alerts go to who our own alert emails reach (notification_emails)
 *
 * Edits are drafts until the page's Save changes; Reset drops them. The page
 * owns the bar, so this component reports `onDraftChange(dirty, save, reset)`.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type { PlatformEmailSetup } from '@/hooks/use-platform-email-sender';
import { EMAIL_SENDER_DOMAIN } from '@/lib/notifications-v2/types';
import {
  PLATFORM_SENDER_DEFAULT_LOCAL_PART,
  PLATFORM_SENDER_DEFAULT_NAME,
  isValidEmail,
  isValidLocalPart,
  senderAddress,
} from '@/lib/notifications-v2/settings-model';
import { cn } from '@/lib/utils';

const FIELD =
  'h-9 w-full rounded-full border border-transparent bg-muted/70 px-3.5 text-[14px] text-foreground outline-none transition-colors duration-200 ease-out placeholder:text-muted-foreground focus:border-primary/40 focus:bg-background disabled:opacity-60 motion-reduce:transition-none';

export interface SystemEmailSenderProps {
  saved: PlatformEmailSetup;
  loading: boolean;
  loadError: string | null;
  canEdit: boolean;
  onSave: (next: PlatformEmailSetup) => Promise<void>;
  /** Reports whether there is something to save, with the save and reset to call. */
  onDraftChange: (state: { dirty: boolean; save: () => Promise<void>; reset: () => void } | null) => void;
}

export function SystemEmailSender({ saved, loading, loadError, canEdit, onSave, onDraftChange }: SystemEmailSenderProps) {
  const [name, setName] = useState('');
  const [local, setLocal] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const fromSaved = (s: PlatformEmailSetup): void => {
    setName(s.sender.from_name ?? '');
    setLocal(s.sender.from_local_part ?? '');
    setReplyTo(s.sender.reply_to ?? '');
    setRecipients(s.recipients);
    setNewRecipient('');
    setRecipientError(null);
  };
  useEffect(() => {
    fromSaved(saved);
  }, [saved]);

  const localCheck = local.trim() ? isValidLocalPart(local.trim()) : { ok: true, reason: null };
  const replyOk = !replyTo.trim() || isValidEmail(replyTo);
  const dirty =
    name.trim() !== (saved.sender.from_name ?? '') ||
    local.trim() !== (saved.sender.from_local_part ?? '') ||
    replyTo.trim() !== (saved.sender.reply_to ?? '') ||
    recipients.join('\n') !== saved.recipients.join('\n');

  const next: PlatformEmailSetup = {
    sender: { from_name: name, from_local_part: local, reply_to: replyTo },
    recipients,
  };
  const preview = senderAddress(next.sender);

  // The page's bar calls the latest save and reset.
  const latest = useRef({ next, localCheck, replyOk, recipients });
  latest.current = { next, localCheck, replyOk, recipients };
  useEffect(() => {
    if (!canEdit) {
      onDraftChange(null);
      return;
    }
    onDraftChange({
      dirty,
      save: async () => {
        const cur = latest.current;
        if (!cur.localCheck.ok) throw new Error(`Send from: ${cur.localCheck.reason}`);
        if (!cur.replyOk) throw new Error('Replies go to: enter a valid email address, like name@company.com.');
        if (cur.recipients.length === 0) throw new Error('Team alerts need at least one address.');
        await onSave(cur.next);
      },
      reset: () => fromSaved(saved),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, canEdit, saved, onSave, onDraftChange]);
  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  const addRecipient = (): void => {
    const email = newRecipient.trim().toLowerCase();
    if (!email) return;
    if (!isValidEmail(email)) {
      setRecipientError('Enter a valid email address, like name@company.com.');
      return;
    }
    if (recipients.includes(email)) {
      setRecipientError('That address is already on the list.');
      return;
    }
    setRecipients([...recipients, email]);
    setNewRecipient('');
    setRecipientError(null);
  };
  const onRecipientKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRecipient();
    }
  };

  return (
    <section aria-labelledby="system-email-sender-title" data-settings-section="email-sender">
      <div className="pb-2">
        <h2 id="system-email-sender-title" className="text-lg font-semibold text-foreground">
          Email
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Who platform emails come from, and where our team’s alert emails go.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading the email sender…
        </div>
      ) : loadError ? (
        <p role="alert" className="py-4 text-[13px] text-destructive">
          Couldn’t load the email sender. {loadError}
        </p>
      ) : (
        <div className="divide-y divide-border/70">
          <Row label="Sender name" description={`The name in an operator’s inbox. Leave empty to use ${PLATFORM_SENDER_DEFAULT_NAME}.`}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={PLATFORM_SENDER_DEFAULT_NAME}
              maxLength={100}
              disabled={!canEdit}
              aria-label="Sender name"
              className={FIELD}
            />
          </Row>
          <Row
            label="Send from"
            description={`Lowercase letters, numbers, dots, dashes and underscores. Leave empty to use ${PLATFORM_SENDER_DEFAULT_LOCAL_PART}.`}
            issue={localCheck.ok ? null : localCheck.reason}
          >
            <div className="flex items-center gap-2">
              <input
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder={PLATFORM_SENDER_DEFAULT_LOCAL_PART}
                maxLength={64}
                disabled={!canEdit}
                aria-label="Send from"
                aria-invalid={!localCheck.ok || undefined}
                className={cn(FIELD, 'max-w-[160px]', !localCheck.ok && 'border-destructive/50')}
              />
              <span className="shrink-0 text-[14px] text-muted-foreground">@{EMAIL_SENDER_DOMAIN}</span>
            </div>
          </Row>
          <Row
            label="Replies go to"
            description="Optional. If empty, replies go nowhere: operators can’t reply to a no-reply address."
            issue={replyOk ? null : 'Enter a valid email address, like name@company.com.'}
          >
            <input
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="support@drive-247.com"
              disabled={!canEdit}
              aria-label="Replies go to"
              aria-invalid={!replyOk || undefined}
              className={cn(FIELD, !replyOk && 'border-destructive/50')}
            />
          </Row>
          <p className="py-4 text-[13px] text-muted-foreground" data-sender-preview="">
            Operators see: <span className="font-medium text-foreground">{preview.display}</span>
            {preview.replyTo && <span> · replies to {preview.replyTo}</span>}
          </p>
          <Row
            label="Team alerts go to"
            description="Where emails about operators (sign-ups, tickets, go-live requests, contact form) are delivered."
            issue={recipientError}
            align="start"
          >
            <div className="space-y-2">
              <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Alert recipients">
                {recipients.map((email) => (
                  <li
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/[0.08] py-1 pl-3 pr-1 text-[13px] text-foreground"
                  >
                    {email}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove ${email}`}
                        disabled={recipients.length <= 1}
                        title={recipients.length <= 1 ? 'Keep at least one address' : `Remove ${email}`}
                        onClick={() => setRecipients(recipients.filter((r) => r !== email))}
                        className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={newRecipient}
                    onChange={(e) => {
                      setNewRecipient(e.target.value);
                      setRecipientError(null);
                    }}
                    onKeyDown={onRecipientKey}
                    placeholder="Add an address"
                    aria-label="Add an alert recipient"
                    className={FIELD}
                  />
                  <button
                    type="button"
                    onClick={addRecipient}
                    aria-label="Add address"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </Row>
        </div>
      )}
      <p className="mt-4 text-[12px] text-muted-foreground">
        The previews and Send test use this sender. Live platform emails switch over with the rest of sending.
      </p>
    </section>
  );
}

function Row({
  label,
  description,
  issue,
  align = 'center',
  children,
}: {
  label: string;
  description: string;
  issue?: string | null;
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-3 py-4 md:flex-row md:justify-between md:gap-10', align === 'center' ? 'md:items-center' : 'md:items-start')}>
      <div className="min-w-0 md:max-w-[560px]">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
        {issue && (
          <p role="alert" className="mt-1 text-[12px] text-destructive">
            {issue}
          </p>
        )}
      </div>
      <div className="w-full md:w-[272px] md:shrink-0">{children}</div>
    </div>
  );
}
