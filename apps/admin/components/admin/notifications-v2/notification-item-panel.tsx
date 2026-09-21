'use client';

/**
 * Notifications v2, SYSTEM set: the panel that opens under a notification's row.
 *
 * The admin twin of the portal's `notification-item-panel.tsx`, drawn on this
 * app's own UI kit. One tab per channel the item offers (the tab says whether
 * it is on), and inside each tab the lead's whiteboard box: the template on the
 * LEFT, its preview on the RIGHT, Send test at the TOP RIGHT.
 *
 *   Email   Subject + the markdown-light body editor → EmailPreview around the
 *           EXACT document the test send delivers: the body filled with example
 *           values, then sanitised, styled inline and wrapped in the shared
 *           layout by `renderNotificationEmailHtml` — the same file
 *           notification-test-v2 runs on the server.
 *   Push    Title + message with the length hints, the four display options the
 *           web can ask for → PushPreview on push-display's device profiles.
 *   In-app  Title + message → InAppPreview of the bell this direction reaches.
 *
 * The panel owns no saved state: every edit goes up through `onChange` into the
 * page's draft, and the page's one save bar writes it. Only the open item's
 * panel is mounted, and Radix unmounts the tabs that are not selected.
 */

import { Component, useEffect, useId, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { renderNotificationEmailHtml } from '@/lib/notifications-v2/email-layout';
import { pushLengthWarnings } from '@/lib/notifications-v2/push-display';
import {
  EMAIL_SUBJECT_MAX,
  IN_APP_BODY_MAX,
  IN_APP_TITLE_MAX,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  normalisePushOptions,
  validateTemplate,
  type ChannelEdit,
  type TemplateField,
  type TemplateValidation,
} from '@/lib/notifications-v2/settings-model';
import {
  extractVariables,
  fillVariables,
  getSystemVariable,
  type SystemNotificationVariable,
} from '@/lib/notifications-v2/variables';
import type { SystemNotificationItem } from '@/lib/notifications-v2/catalog';
import type {
  EmailBrand,
  EmailTemplate,
  InAppTemplate,
  NotificationChannel,
  PushDisplayOptions,
  PushTemplate,
} from '@/lib/notifications-v2/types';
import { cn } from '@/lib/utils';
import { BodyEditor } from './body-editor';
import { EmailPreview } from './email-preview';
import { InAppPreview } from './inapp-preview';
import { PushPreview } from './push-preview';
import { SendTestBox, type SendTestDraft } from './send-test-box';
import { VariableTextField } from './variable-text-field';
import {
  CHANNEL_LABELS,
  PUSH_OPTION_COPY,
  SYSTEM_NOTIFICATIONS_COPY as COPY,
  TODAY_COPY,
  channelSpec,
  isDefaultContent,
  itemChannels,
  resetEdit,
} from './system-notifications-model';

/* -------------------------------------------------------------------------- */
/* What the previews and tests need from the page                              */
/* -------------------------------------------------------------------------- */

export interface SystemPreviewContext {
  /** Drive247's own brand — a platform email is from us, never from a tenant. */
  brand: EmailBrand;
  /** Every variable's example value. */
  examples: Record<string, string>;
  /** Who platform email comes from. */
  fromName: string;
  fromAddress: string;
  /** The signed-in super admin's email: Send test's recipient until they change it. */
  defaultTestEmail: string | null;
  /** The name a phone shows for the app sending the push. */
  appName: string;
  iconUrl: string | null;
}

export interface NotificationItemPanelProps {
  item: SystemNotificationItem;
  /** The panel's DOM id; the row button's `aria-controls`. */
  id: string;
  /** What each channel shows now (the page's draft over what is stored). */
  edits: Partial<Record<NotificationChannel, ChannelEdit>>;
  onChange: (channel: NotificationChannel, next: ChannelEdit) => void;
  onClose: () => void;
  canEdit: boolean;
  /** False for anyone the test function would refuse. */
  canSendTests: boolean;
  sendTestBlockedReason?: string | null;
  context: SystemPreviewContext;
  /** The tab to open on; the first channel otherwise. */
  initialChannel?: NotificationChannel;
  className?: string;
}

/** Waits for typing to pause before a new value reaches the email iframe, which reloads on every change. */
function useSettledValue<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

export function NotificationItemPanel({
  item,
  id,
  edits,
  onChange,
  onClose,
  canEdit,
  canSendTests,
  sendTestBlockedReason,
  context,
  initialChannel,
  className,
}: NotificationItemPanelProps) {
  const channels = itemChannels(item);
  const [tab, setTab] = useState<NotificationChannel>(
    initialChannel && channels.includes(initialChannel) ? initialChannel : (channels[0] ?? 'email'),
  );
  const variables = useMemo(
    () =>
      item.variables
        .map((key) => getSystemVariable(key))
        .filter((v): v is SystemNotificationVariable => !!v),
    [item],
  );

  const shared = { item, variables, canEdit, canSendTests, sendTestBlockedReason, context };

  return (
    <div
      id={id}
      role="region"
      aria-label={`${item.name}: messages and previews`}
      data-notification-panel={item.key}
      className={cn('border-t border-border bg-muted/30 px-4 pb-5 pt-4 md:px-5', className)}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationChannel)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label={`Channels for ${item.name}`}>
            {channels.map((channel) => {
              const on = edits[channel]?.enabled === true;
              return (
                <TabsTrigger key={channel} value={channel} data-channel-tab={channel} className="gap-1.5">
                  {CHANNEL_LABELS[channel]}
                  <span
                    data-channel-state={on ? 'on' : 'off'}
                    className={cn('text-xs font-normal', on ? 'text-success' : 'text-muted-foreground')}
                  >
                    {on ? 'On' : 'Off'}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} data-panel-close="">
            <X aria-hidden="true" className="size-3.5" />
            {COPY.close}
          </Button>
        </div>

        {channels.map((channel) => {
          const edit = edits[channel];
          if (!edit) return null;
          const change = (next: ChannelEdit): void => onChange(channel, next);
          return (
            <TabsContent key={channel} value={channel} className="mt-0" data-channel-panel={channel}>
              <PanelBoundary>
                {channel === 'email' ? (
                  <EmailChannel {...shared} edit={edit} onChange={change} />
                ) : channel === 'push' ? (
                  <PushChannel {...shared} edit={edit} onChange={change} />
                ) : (
                  <InAppChannel {...shared} edit={edit} onChange={change} />
                )}
              </PanelBoundary>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared parts                                                                */
/* -------------------------------------------------------------------------- */

interface ChannelProps {
  item: SystemNotificationItem;
  variables: SystemNotificationVariable[];
  edit: ChannelEdit;
  onChange: (next: ChannelEdit) => void;
  canEdit: boolean;
  canSendTests: boolean;
  sendTestBlockedReason?: string | null;
  context: SystemPreviewContext;
}

const COLUMN_CAPTION = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

/**
 * The lead's whiteboard box: the editable template on the LEFT, its preview on
 * the RIGHT, Send test at the TOP RIGHT. `today` opens it ("Today: sent every
 * time."), so the first row reads "what happens today" on the left and "try it"
 * on the right. Stacked below xl.
 */
function ChannelLayout({
  today,
  test,
  fields,
  preview,
  fill = false,
}: {
  today: ReactNode;
  test: ReactNode;
  fields: ReactNode;
  preview: ReactNode;
  /** The template column grows to the preview's height (email only: it ends in an editor that can take the space). */
  fill?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">{today}</div>
        <div className="flex min-w-0 shrink-0 justify-end" data-channel-test="">
          {test}
        </div>
      </div>
      <div className={cn('grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]', !fill && 'items-start')}>
        <div className={cn('min-w-0', fill ? 'flex flex-col gap-4' : 'space-y-4')} data-channel-fields="">
          <p className={COLUMN_CAPTION}>{COPY.templateColumn}</p>
          {fields}
        </div>
        <div className="min-w-0 space-y-3" data-channel-preview="">
          <p className={COLUMN_CAPTION}>{COPY.previewColumn}</p>
          {preview}
        </div>
      </div>
    </div>
  );
}

/** "Today: sent every time." plus the catalog's caveat for this channel. */
function TodayLine({ item, channel }: { item: SystemNotificationItem; channel: NotificationChannel }) {
  const spec = channelSpec(item, channel);
  if (!spec) return null;
  return (
    <p className="text-[13px] leading-snug text-muted-foreground" data-today={spec.today}>
      {TODAY_COPY[spec.today]}
      {spec.note ? ` ${spec.note}` : ''}
    </p>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
      {children}
    </label>
  );
}

/** The template's problems for one field, under it. */
function FieldIssues({
  id,
  validation,
  field,
}: {
  id: string;
  validation: TemplateValidation;
  field: TemplateField;
}) {
  const messages = validation.issues.filter((i) => i.field === field).map((i) => i.message);
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="space-y-0.5 text-xs text-destructive" data-field-issues={field}>
      {messages.map((m) => (
        <p key={m} className="[overflow-wrap:anywhere]">
          {m}
        </p>
      ))}
    </div>
  );
}

/**
 * What every `{{placeholder}}` in this message became — the chips that stand in
 * for the rich editor's inline variable pills. They sit under the preview
 * because that is where the question is asked: "the preview says Coastline Car
 * Rentals; which variable put it there?"
 */
function VariableChips({
  text,
  allowed,
  examples,
}: {
  /** Every field of the template, joined. */
  text: string;
  allowed: readonly string[];
  examples: Record<string, string>;
}) {
  const used = extractVariables(text);
  if (used.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-variable-chips="">
      {used.map((key) => {
        const known = allowed.includes(key);
        return (
          <li
            key={key}
            data-variable-chip={key}
            data-variable-known={known ? 'yes' : 'no'}
            title={known ? `{{${key}}} → ${examples[key] ?? ''}` : `{{${key}}} isn’t a variable this notification can use.`}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              known ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive',
            )}
          >
            <span className="font-mono">{`{{${key}}}`}</span>
            {known && examples[key] ? <span className="ml-1 text-foreground">{examples[key]}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The variables this notification offers, with an example each. */
function VariablesHelp({
  variables,
  examples,
}: {
  variables: SystemNotificationVariable[];
  examples: Record<string, string>;
}) {
  if (variables.length === 0) return null;
  return (
    <details className="group rounded-xl border border-border bg-card px-4 py-3" data-variables-help="">
      <summary className="cursor-pointer text-[13px] font-medium text-foreground">
        Variables you can use ({variables.length})
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        {variables.map((v) => (
          <div key={v.key} className="contents">
            <dt>
              <code className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{`{{${v.key}}}`}</code>
            </dt>
            <dd className="text-muted-foreground [overflow-wrap:anywhere]">
              {v.label}. Example: <span className="text-foreground">{examples[v.key] ?? v.example}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ResetButton({
  disabled,
  onClick,
  channel,
}: {
  disabled: boolean;
  onClick: () => void;
  channel: NotificationChannel;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-reset-channel={channel}
      title={disabled ? 'Already the default wording' : undefined}
    >
      <RotateCcw aria-hidden="true" className="size-3.5" />
      {COPY.reset}
    </Button>
  );
}

/** Send test is off for non-super-admins and while the template has a problem. */
function testGate(props: ChannelProps, validation: TemplateValidation): { canSend: boolean; reason: string | null } {
  if (!props.canSendTests) {
    return { canSend: false, reason: props.sendTestBlockedReason ?? COPY.noTestForViewer };
  }
  if (!validation.ok) return { canSend: false, reason: COPY.fixToTest };
  return { canSend: true, reason: null };
}

/** A test push opens this page: it cannot point at a real operator's record. */
const TEST_PUSH_URL = '/admin/notifications';

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The document the test send delivers. The filled body goes in RAW, exactly as
 * the edge function passes it: `renderNotificationEmailHtml` sanitises AND
 * inlines it itself, and doing either here first would make the preview a
 * different document (the first inline pass turns `<a data-email-button>` into
 * a styled table, which the layout's own sanitise then unwraps — so the preview
 * would show a plain link where the real email has a button).
 */
export function buildEmailPreviewHtml(
  body: string,
  examples: Record<string, string>,
  brand: EmailBrand,
): string {
  return renderNotificationEmailHtml({ bodyHtml: fillVariables(body ?? '', examples, { html: true }), brand });
}

function EmailChannel(props: ChannelProps) {
  const { item, variables, edit, onChange, canEdit, context } = props;
  const ids = useId();
  const template = edit.template as EmailTemplate;
  const validation = validateTemplate('email', template, item.variables);
  const settledBody = useSettledValue(template.body);
  const html = useMemo(
    () => buildEmailPreviewHtml(settledBody, context.examples, context.brand),
    [settledBody, context.examples, context.brand],
  );
  const subject = fillVariables(template.subject, context.examples);
  // Who the example email is addressed to. There is no variable for our own
  // inbox (the real recipients are admin_settings.notification_emails, which
  // this page does not own), so a message TO us is shown as going to the signed-in
  // super admin, and anything else to the operator's contact address.
  const toAddress =
    item.direction === 'admin_to_super_admin'
      ? (context.defaultTestEmail ?? 'the Drive247 notification address')
      : (context.examples.tenant_contact_email ?? '');
  const gate = testGate(props, validation);

  const setTemplate = (patch: Partial<EmailTemplate>): void =>
    onChange({ ...edit, template: { ...template, ...patch } });

  const buildRequest = (): SendTestDraft => {
    const check = validateTemplate('email', template, item.variables);
    if (!check.ok) throw new Error(check.messages[0]);
    return {
      channel: 'email',
      notificationKey: item.key,
      subject: fillVariables(template.subject, context.examples),
      bodyHtml: fillVariables(template.body, context.examples, { html: true }),
    };
  };

  return (
    <ChannelLayout
      today={<TodayLine item={item} channel="email" />}
      test={
        <SendTestBox
          channel="email"
          notificationKey={item.key}
          buildRequest={buildRequest}
          defaultEmail={context.defaultTestEmail}
          canSend={gate.canSend}
          disabledReason={gate.reason}
        />
      }
      fields={
        <>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-subject`}>{COPY.subject}</FieldLabel>
            <VariableTextField
              id={`${ids}-subject`}
              value={template.subject}
              onChange={(value) => setTemplate({ subject: value })}
              variables={variables}
              maxLength={EMAIL_SUBJECT_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === 'subject')}
              describedBy={`${ids}-subject-issues`}
            />
            <FieldIssues id={`${ids}-subject-issues`} validation={validation} field="subject" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
            <p className="text-[13px] font-medium text-foreground">{COPY.message}</p>
            <BodyEditor
              value={template.body}
              onChange={(body) => setTemplate({ body })}
              variables={variables}
              readOnly={!canEdit}
              ariaLabel={`Email message for ${item.name}`}
              invalid={validation.issues.some((i) => i.field === 'body')}
              describedBy={`${ids}-body-issues`}
              className="min-h-0 flex-1"
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <ResetButton
                channel="email"
                disabled={isDefaultContent(item, 'email', edit)}
                onClick={() => onChange(resetEdit(item, 'email', edit))}
              />
            </div>
          )}
          <VariablesHelp variables={variables} examples={context.examples} />
        </>
      }
      fill
      preview={
        <>
          <EmailPreview
            subject={subject}
            html={html}
            fromName={context.fromName}
            fromAddress={context.fromAddress}
            toAddress={toAddress}
          />
          <VariableChips
            text={`${template.subject}\n${template.body}`}
            allowed={item.variables}
            examples={context.examples}
          />
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

function PushChannel(props: ChannelProps) {
  const { item, variables, edit, onChange, canEdit, context } = props;
  const ids = useId();
  const template = edit.template as PushTemplate;
  const options = normalisePushOptions(edit.pushOptions);
  const validation = validateTemplate('push', template, item.variables);
  const title = fillVariables(template.title, context.examples);
  const body = fillVariables(template.body, context.examples);
  const hints = pushLengthWarnings({ title, body });
  const gate = testGate(props, validation);

  const setTemplate = (patch: Partial<PushTemplate>): void =>
    onChange({ ...edit, template: { ...template, ...patch } });
  const setOption = (key: keyof PushDisplayOptions, value: boolean): void =>
    onChange({ ...edit, pushOptions: { ...options, [key]: value } });

  const buildRequest = (): SendTestDraft => {
    const check = validateTemplate('push', template, item.variables);
    if (!check.ok) throw new Error(check.messages[0]);
    return {
      channel: 'push',
      notificationKey: item.key,
      title: fillVariables(template.title, context.examples),
      body: fillVariables(template.body, context.examples),
      url: TEST_PUSH_URL,
      pushOptions: options,
    };
  };

  return (
    <ChannelLayout
      today={<TodayLine item={item} channel="push" />}
      test={
        <SendTestBox
          channel="push"
          notificationKey={item.key}
          buildRequest={buildRequest}
          canSend={gate.canSend}
          disabledReason={gate.reason}
        />
      }
      fields={
        <>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-title`}>{COPY.title}</FieldLabel>
            <VariableTextField
              id={`${ids}-title`}
              value={template.title}
              onChange={(value) => setTemplate({ title: value })}
              variables={variables}
              maxLength={PUSH_TITLE_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === 'title')}
              describedBy={`${ids}-title-issues`}
            />
            <FieldIssues id={`${ids}-title-issues`} validation={validation} field="title" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-body`}>{COPY.message}</FieldLabel>
            <VariableTextField
              id={`${ids}-body`}
              multiline
              rows={3}
              value={template.body}
              onChange={(value) => setTemplate({ body: value })}
              variables={variables}
              maxLength={PUSH_BODY_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === 'body')}
              describedBy={`${ids}-body-issues`}
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          {hints.length > 0 && (
            <ul className="space-y-1 text-xs text-warning" data-push-hints="">
              {hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}

          <fieldset className="rounded-xl border border-border bg-card" data-push-options="">
            <legend className="sr-only">{COPY.displayOptions}</legend>
            <p className="px-4 pt-3 text-[13px] font-medium text-foreground" aria-hidden="true">
              {COPY.displayOptions}
            </p>
            <div className="divide-y divide-border">
              {PUSH_OPTION_COPY.map((option) => {
                const optionId = `${ids}-${option.key}`;
                return (
                  <div key={option.key} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <div className="min-w-0">
                      <label htmlFor={optionId} className="text-[13px] text-foreground">
                        {option.label}
                      </label>
                      <p id={`${optionId}-help`} className="text-xs text-muted-foreground">
                        {option.description}
                        {option.note && (
                          <>
                            {' '}
                            <span data-push-option-note={option.key} className="italic">
                              {option.note}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <Switch
                      id={optionId}
                      className="mt-0.5 h-5 w-9"
                      checked={options[option.key]}
                      disabled={!canEdit}
                      aria-describedby={`${optionId}-help`}
                      aria-label={option.label}
                      onCheckedChange={(value) => setOption(option.key, value)}
                    />
                  </div>
                );
              })}
            </div>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{COPY.pushPhoneNote}</p>
          </fieldset>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <ResetButton
                channel="push"
                disabled={isDefaultContent(item, 'push', edit)}
                onClick={() => onChange(resetEdit(item, 'push', edit))}
              />
            </div>
          )}
          <VariablesHelp variables={variables} examples={context.examples} />
        </>
      }
      preview={
        <>
          <PushPreview
            title={title}
            body={body}
            appName={context.appName}
            iconUrl={context.iconUrl}
            options={options}
          />
          <VariableChips
            text={`${template.title}\n${template.body}`}
            allowed={item.variables}
            examples={context.examples}
          />
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* In-app                                                                      */
/* -------------------------------------------------------------------------- */

function InAppChannel(props: ChannelProps) {
  const { item, variables, edit, onChange, canEdit, context } = props;
  const ids = useId();
  const template = edit.template as InAppTemplate;
  const validation = validateTemplate('in_app', template, item.variables);
  const setTemplate = (patch: Partial<InAppTemplate>): void =>
    onChange({ ...edit, template: { ...template, ...patch } });

  return (
    <ChannelLayout
      today={<TodayLine item={item} channel="in_app" />}
      // In-app has no test send; the reason stands where Send test does on the
      // other two tabs, so it is read where the button is looked for.
      test={
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-inapp-no-test="">
          {COPY.inAppNoTest}
        </p>
      }
      fields={
        <>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-title`}>{COPY.title}</FieldLabel>
            <VariableTextField
              id={`${ids}-title`}
              value={template.title}
              onChange={(value) => setTemplate({ title: value })}
              variables={variables}
              maxLength={IN_APP_TITLE_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === 'title')}
              describedBy={`${ids}-title-issues`}
            />
            <FieldIssues id={`${ids}-title-issues`} validation={validation} field="title" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-body`}>{COPY.message}</FieldLabel>
            <VariableTextField
              id={`${ids}-body`}
              multiline
              rows={3}
              value={template.body}
              onChange={(value) => setTemplate({ body: value })}
              variables={variables}
              maxLength={IN_APP_BODY_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === 'body')}
              describedBy={`${ids}-body-issues`}
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <ResetButton
                channel="in_app"
                disabled={isDefaultContent(item, 'in_app', edit)}
                onClick={() => onChange(resetEdit(item, 'in_app', edit))}
              />
            </div>
          )}
          <VariablesHelp variables={variables} examples={context.examples} />
        </>
      }
      preview={
        <>
          <InAppPreview
            title={fillVariables(template.title, context.examples)}
            body={fillVariables(template.body, context.examples)}
            direction={item.direction}
            link={item.link ? fillVariables(item.link, context.examples) : null}
          />
          <VariableChips
            text={`${template.title}\n${template.body}`}
            allowed={item.variables}
            examples={context.examples}
          />
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* A broken editor or preview never takes the page down                        */
/* -------------------------------------------------------------------------- */

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[notifications-v2] panel failed to render', error, info?.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          This part of the page couldn’t load. Close it and open it again. Nothing you saved is affected.
        </p>
      );
    }
    return this.props.children;
  }
}

export default NotificationItemPanel;
