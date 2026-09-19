"use client";

/**
 * Notifications v2: the large panel that opens under a notification's row
 * (build-spec D10; transcript §3.8–3.9 and 18:46: "every notification has
 * three options, email, push and in-app, each with its own edit view and its
 * own preview").
 *
 * One tab per channel the item offers (the tab says whether it is on). Each
 * tab: the fields on the left, the preview on the right, and under the fields
 * Reset to default, the template's problems (validateTemplate), the variables
 * with their examples, and Send test (email and push; in-app has none).
 *
 *   Email   Subject + the Notion-like body editor (loaded with next/dynamic, so
 *           Tiptap is not in the page's first bundle) → EmailPreviewGmail around
 *           the EXACT document the test send delivers: the body filled with
 *           example values, sanitised, styled inline and wrapped in the shared
 *           layout (email-layout.ts, the same file notification-test-v2 runs).
 *   Push    Title + message with the length hints, the four display options
 *           the web can ask for → PushPreviewPhone on push-display's profiles.
 *   In-app  Title + message → InAppPreview (your team's bell, or the
 *           customer's).
 *
 * The panel owns no saved state: every edit goes up through `onChange` into
 * the page's draft, and the page's one save bar saves it. Only the open item's
 * panel is ever mounted, and only the selected tab (Radix unmounts the rest).
 *
 * v2 only: rendered by notifications-page-v2.tsx.
 */

import dynamic from "next/dynamic";
import { Component, useEffect, useId, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Switch } from "@/components/ui-v2/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { fillVariables, getVariable } from "@/lib/notifications-v2/variables";
import { inlineEmailStyles, renderNotificationEmailHtml, sanitizeEmailBodyHtml } from "@/lib/notifications-v2/email-layout";
import { PUSH_DEVICE_PROFILES, pushLengthWarnings } from "@/lib/notifications-v2/push-display";
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
} from "@/lib/notifications-v2/settings-model";
import type {
  EmailBrand,
  EmailTemplate,
  InAppTemplate,
  NotificationChannel,
  NotificationItem,
  NotificationVariable,
  PushDisplayOptions,
  PushTemplate,
} from "@/lib/notifications-v2/types";
import { cn } from "@/lib/utils";
import { EmailPreviewGmail } from "./email-preview-gmail";
import { InAppPreview } from "./inapp-preview";
import { PushPreviewPhone } from "./push-preview-phone";
import { SendTestBox, type SendTestDraft } from "./send-test-box";
import { VariableTextInput } from "./variable-text-input";
import {
  CHANNEL_LABELS,
  NOTIFICATIONS_PAGE_COPY as COPY,
  PUSH_OPTION_COPY,
  TODAY_COPY,
  channelSpec,
  isDefaultContent,
  itemChannels,
  resetEdit,
} from "./notifications-page-model";

/* -------------------------------------------------------------------------- */
/* The editor, loaded on demand                                                */
/* -------------------------------------------------------------------------- */

function EditorSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the editor"
      data-editor-loading=""
      className="min-h-[258px] space-y-3 rounded-xl border bg-card px-4 py-4"
    >
      <Skeleton className="h-3.5 w-2/3 rounded-full" />
      <Skeleton className="h-3.5 w-1/2 rounded-full" />
      <Skeleton className="h-3.5 w-3/5 rounded-full" />
    </div>
  );
}

/** Tiptap stays out of the settings page's first load: it arrives when an email tab opens. */
const NotificationTemplateEditor = dynamic(() => import("./template-editor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

/* -------------------------------------------------------------------------- */
/* What the previews and tests need from the page                              */
/* -------------------------------------------------------------------------- */

export interface NotificationPreviewContext {
  brand: EmailBrand;
  /** Every variable's example, in the tenant's currency and on its own sites. */
  examples: Record<string, string>;
  /** Who emails come from (settings-model senderAddress over the saved sender). */
  fromName: string;
  fromAddress: string;
  /** Where team emails go (the team alerts address, else the contact email). */
  teamRecipient: string;
  /** The signed-in operator's email: Send test's recipient until they change it. */
  defaultTestEmail: string | null;
  /** The name a phone shows for the app. */
  appName: string;
  iconUrl: string | null;
}

export interface NotificationItemPanelProps {
  item: NotificationItem;
  /** The panel's DOM id, the row button's `aria-controls`. */
  id: string;
  /** What each channel shows now (the page's draft over what is stored). */
  edits: Partial<Record<NotificationChannel, ChannelEdit>>;
  onChange: (channel: NotificationChannel, next: ChannelEdit) => void;
  onClose: () => void;
  canEdit: boolean;
  /** False for view-only users and roles the test function refuses. */
  canSendTests: boolean;
  /** Why Send test is off when `canSendTests` is false. */
  sendTestBlockedReason?: string | null;
  context: NotificationPreviewContext;
  /** The tab to open on (a Save blocked by this channel's template); the first channel otherwise. */
  initialChannel?: NotificationChannel;
  className?: string;
}

/** Waits for typing to pause before a new value goes to a costly preview (the email iframe reloads on every change). */
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
    initialChannel && channels.includes(initialChannel) ? initialChannel : channels[0] ?? "email",
  );
  const variables = useMemo(
    () => item.variables.map((key) => getVariable(key)).filter((v): v is NotificationVariable => !!v),
    [item],
  );

  const shared = { item, variables, canEdit, canSendTests, sendTestBlockedReason, context };

  return (
    <div
      id={id}
      role="region"
      aria-label={`${item.name}: messages and previews`}
      data-notification-panel={item.key}
      className={cn("border-t bg-muted/20 px-4 pb-5 pt-4 md:px-5", className)}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationChannel)} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label={`Channels for ${item.name}`}>
            {channels.map((channel) => {
              const on = edits[channel]?.enabled === true;
              return (
                <TabsTrigger key={channel} value={channel} data-channel-tab={channel} className="gap-1.5 px-3">
                  {CHANNEL_LABELS[channel]}
                  <span
                    data-channel-state={on ? "on" : "off"}
                    className={cn(
                      "text-xs font-normal",
                      on ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    {on ? "On" : "Off"}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} data-panel-close="">
            <X data-icon="inline-start" aria-hidden="true" />
            {COPY.close}
          </Button>
        </div>

        {channels.map((channel) => {
          const edit = edits[channel];
          if (!edit) return null;
          const change = (next: ChannelEdit) => onChange(channel, next);
          return (
            <TabsContent key={channel} value={channel} className="mt-0" data-channel-panel={channel}>
              <PanelBoundary>
                {channel === "email" ? (
                  <EmailChannel {...shared} edit={edit} onChange={change} />
                ) : channel === "push" ? (
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
  item: NotificationItem;
  variables: NotificationVariable[];
  edit: ChannelEdit;
  onChange: (next: ChannelEdit) => void;
  canEdit: boolean;
  canSendTests: boolean;
  sendTestBlockedReason?: string | null;
  context: NotificationPreviewContext;
}

/** Fields on the left, the preview on the right; stacked below xl. */
function ChannelLayout({ fields, preview }: { fields: ReactNode; preview: ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-4">{fields}</div>
      <div className="min-w-0" data-channel-preview="">
        {preview}
      </div>
    </div>
  );
}

/** "Today: sent every time." plus the catalog's caveat for this channel. */
function TodayLine({ item, channel }: { item: NotificationItem; channel: NotificationChannel }) {
  const spec = channelSpec(item, channel);
  if (!spec) return null;
  return (
    <p className="text-xs text-muted-foreground" data-today={spec.today}>
      {TODAY_COPY[spec.today]}
      {spec.note ? ` ${spec.note}` : ""}
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
function FieldIssues({ id, validation, field }: { id: string; validation: TemplateValidation; field: TemplateField }) {
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

function VariablesHelp({ variables, examples }: { variables: NotificationVariable[]; examples: Record<string, string> }) {
  if (variables.length === 0) return null;
  return (
    <details className="group rounded-xl bg-muted/40 px-4 py-3" data-variables-help="">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Variables you can use ({variables.length})
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        {variables.map((v) => (
          <div key={v.key} className="contents">
            <dt>
              <code className="rounded-full bg-background px-2 py-0.5 font-mono text-xs text-foreground">{`{{${v.key}}}`}</code>
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

function ResetButton({ disabled, onClick, channel }: { disabled: boolean; onClick: () => void; channel: NotificationChannel }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-reset-channel={channel}
      title={disabled ? "Already the default wording" : undefined}
    >
      <RotateCcw data-icon="inline-start" aria-hidden="true" />
      {COPY.reset}
    </Button>
  );
}

/** Send test is off for view-only users, for roles the test refuses, and while the template has a problem. */
function testGate(props: ChannelProps, validation: TemplateValidation): { canSend: boolean; reason: string | null } {
  if (!props.canSendTests) return { canSend: false, reason: props.sendTestBlockedReason ?? COPY.noTestForViewer };
  if (!validation.ok) return { canSend: false, reason: COPY.fixToTest };
  return { canSend: true, reason: null };
}

/** Test pushes open this page: a test can't point at a real rental or a customer's site. */
const TEST_PUSH_URL = "/settings?tab=notifications";

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The document the test send delivers (notification-test-v2 renders the same
 * body through the same layout with the tenant's branding), so the preview is
 * what lands in the inbox.
 */
export function buildEmailPreviewHtml(body: string, examples: Record<string, string>, brand: EmailBrand): string {
  const filled = fillVariables(body ?? "", examples, { html: true });
  return renderNotificationEmailHtml({ bodyHtml: inlineEmailStyles(sanitizeEmailBodyHtml(filled), brand), brand });
}

function EmailChannel(props: ChannelProps) {
  const { item, variables, edit, onChange, canEdit, context } = props;
  const ids = useId();
  const template = edit.template as EmailTemplate;
  const validation = validateTemplate("email", template, item.variables);
  const settledBody = useSettledValue(template.body);
  const html = useMemo(
    () => buildEmailPreviewHtml(settledBody, context.examples, context.brand),
    [settledBody, context.examples, context.brand],
  );
  const subject = fillVariables(template.subject, context.examples);
  const toAddress = item.direction === "team_to_customer" ? context.examples.customer_email ?? "" : context.teamRecipient;
  const gate = testGate(props, validation);

  const setTemplate = (patch: Partial<EmailTemplate>) => onChange({ ...edit, template: { ...template, ...patch } });

  const buildRequest = (): SendTestDraft => {
    const check = validateTemplate("email", template, item.variables);
    if (!check.ok) throw new Error(check.messages[0]);
    return {
      channel: "email",
      notificationKey: item.key,
      subject: fillVariables(template.subject, context.examples),
      bodyHtml: fillVariables(template.body, context.examples, { html: true }),
    };
  };

  return (
    <ChannelLayout
      fields={
        <>
          <TodayLine item={item} channel="email" />
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-subject`}>{COPY.subject}</FieldLabel>
            <VariableTextInput
              id={`${ids}-subject`}
              value={template.subject}
              onChange={(subject) => setTemplate({ subject })}
              variables={variables}
              maxLength={EMAIL_SUBJECT_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === "subject")}
              describedBy={`${ids}-subject-issues`}
            />
            <FieldIssues id={`${ids}-subject-issues`} validation={validation} field="subject" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-foreground" id={`${ids}-body-label`}>
              {COPY.message}
            </p>
            <NotificationTemplateEditor
              value={template.body}
              onChange={(body) => setTemplate({ body })}
              variables={variables}
              readOnly={!canEdit}
              ariaLabel={`Email message for ${item.name}`}
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <ResetButton
                channel="email"
                disabled={isDefaultContent(item, "email", edit)}
                onClick={() => onChange(resetEdit(item, "email", edit))}
              />
            )}
          </div>
          <VariablesHelp variables={variables} examples={context.examples} />
          <SendTestBox
            channel="email"
            notificationKey={item.key}
            buildRequest={buildRequest}
            defaultEmail={context.defaultTestEmail}
            canSend={gate.canSend}
            disabledReason={gate.reason}
          />
        </>
      }
      preview={
        <EmailPreviewGmail
          subject={subject}
          html={html}
          fromName={context.fromName}
          fromAddress={context.fromAddress}
          toAddress={toAddress}
        />
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
  const validation = validateTemplate("push", template, item.variables);
  const title = fillVariables(template.title, context.examples);
  const body = fillVariables(template.body, context.examples);
  const hints = pushLengthWarnings({ title, body });
  const gate = testGate(props, validation);

  const setTemplate = (patch: Partial<PushTemplate>) => onChange({ ...edit, template: { ...template, ...patch } });
  const setOption = (key: keyof PushDisplayOptions, value: boolean) =>
    onChange({ ...edit, pushOptions: { ...options, [key]: value } });

  const buildRequest = (): SendTestDraft => {
    const check = validateTemplate("push", template, item.variables);
    if (!check.ok) throw new Error(check.messages[0]);
    return {
      channel: "push",
      notificationKey: item.key,
      title: fillVariables(template.title, context.examples),
      body: fillVariables(template.body, context.examples),
      url: TEST_PUSH_URL,
      pushOptions: options,
    };
  };

  return (
    <ChannelLayout
      fields={
        <>
          <TodayLine item={item} channel="push" />
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-title`}>{COPY.title}</FieldLabel>
            <VariableTextInput
              id={`${ids}-title`}
              value={template.title}
              onChange={(value) => setTemplate({ title: value })}
              variables={variables}
              maxLength={PUSH_TITLE_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === "title")}
              describedBy={`${ids}-title-issues`}
            />
            <FieldIssues id={`${ids}-title-issues`} validation={validation} field="title" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-body`}>{COPY.message}</FieldLabel>
            <VariableTextInput
              id={`${ids}-body`}
              multiline
              rows={3}
              value={template.body}
              onChange={(value) => setTemplate({ body: value })}
              variables={variables}
              maxLength={PUSH_BODY_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === "body")}
              describedBy={`${ids}-body-issues`}
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          {hints.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400" data-push-hints="">
              {hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}

          <fieldset className="rounded-xl border bg-card" data-push-options="">
            <legend className="sr-only">{COPY.displayOptions}</legend>
            <p className="px-4 pt-3 text-[13px] font-medium text-foreground" aria-hidden="true">
              {COPY.displayOptions}
            </p>
            <div className="divide-y">
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
                      </p>
                    </div>
                    <Switch
                      id={optionId}
                      size="sm"
                      className="mt-0.5"
                      checked={options[option.key]}
                      disabled={!canEdit}
                      aria-describedby={`${optionId}-help`}
                      onCheckedChange={(value) => setOption(option.key, value)}
                    />
                  </div>
                );
              })}
            </div>
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{COPY.pushPhoneNote}</p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <ResetButton
                channel="push"
                disabled={isDefaultContent(item, "push", edit)}
                onClick={() => onChange(resetEdit(item, "push", edit))}
              />
            )}
          </div>
          <VariablesHelp variables={variables} examples={context.examples} />
          <SendTestBox
            channel="push"
            notificationKey={item.key}
            buildRequest={buildRequest}
            canSend={gate.canSend}
            disabledReason={gate.reason}
          />
        </>
      }
      preview={
        <PushPreviewPhone
          title={title}
          body={body}
          appName={context.appName}
          iconUrl={context.iconUrl}
          options={options}
          profiles={PUSH_DEVICE_PROFILES}
        />
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
  const validation = validateTemplate("in_app", template, item.variables);
  const setTemplate = (patch: Partial<InAppTemplate>) => onChange({ ...edit, template: { ...template, ...patch } });
  const audience = item.direction === "team_to_customer" ? "customer" : "team";

  return (
    <ChannelLayout
      fields={
        <>
          <TodayLine item={item} channel="in_app" />
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-title`}>{COPY.title}</FieldLabel>
            <VariableTextInput
              id={`${ids}-title`}
              value={template.title}
              onChange={(value) => setTemplate({ title: value })}
              variables={variables}
              maxLength={IN_APP_TITLE_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === "title")}
              describedBy={`${ids}-title-issues`}
            />
            <FieldIssues id={`${ids}-title-issues`} validation={validation} field="title" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${ids}-body`}>{COPY.message}</FieldLabel>
            <VariableTextInput
              id={`${ids}-body`}
              multiline
              rows={3}
              value={template.body}
              onChange={(value) => setTemplate({ body: value })}
              variables={variables}
              maxLength={IN_APP_BODY_MAX}
              readOnly={!canEdit}
              invalid={validation.issues.some((i) => i.field === "body")}
              describedBy={`${ids}-body-issues`}
            />
            <FieldIssues id={`${ids}-body-issues`} validation={validation} field="body" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <ResetButton
                channel="in_app"
                disabled={isDefaultContent(item, "in_app", edit)}
                onClick={() => onChange(resetEdit(item, "in_app", edit))}
              />
            )}
          </div>
          <VariablesHelp variables={variables} examples={context.examples} />
          <p className="text-xs text-muted-foreground" data-inapp-no-test="">
            {COPY.inAppNoTest}
          </p>
        </>
      }
      preview={
        <InAppPreview
          title={fillVariables(template.title, context.examples)}
          body={fillVariables(template.body, context.examples)}
          audience={audience}
          companyName={context.brand.companyName}
          link={item.link ? fillVariables(item.link, context.examples) : null}
          accentColor={audience === "customer" ? context.brand.accentColor ?? null : null}
        />
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* A broken editor or preview never takes the settings page down               */
/* -------------------------------------------------------------------------- */

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[notifications-v2] panel failed to render", error, info?.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          This part of the page couldn&apos;t load. Close it and open it again. Nothing you saved is affected.
        </p>
      );
    }
    return this.props.children;
  }
}
