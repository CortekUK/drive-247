'use client';

/**
 * Notifications v2, SYSTEM set: the super admin dashboard's own Notifications
 * page (`/admin/notifications`).
 *
 * LAYOUT (Oct 17 2026, Ghulam: "exactly like" the operator portal's
 * Settings › Notifications on northwind). A FULL-SCREEN view, 100vw × 100vh,
 * portalled to <body> over the dashboard's own chrome:
 *   Left    system-notifications-rail.tsx: Back, search, Setups, the three
 *           directions (Operators | Us | Everyone), the categories and their
 *           notifications, with the open one's App message / Email nested.
 *           It only chooses (system-notifications-selection-store).
 *   Middle  the PREVIEW: App message on an iPhone and an Android lock screen,
 *           or the Email in Gmail on desktop and phone. Type straight into the
 *           preview to change a word. Under it: On | Off, Light / Dark,
 *           Send test, and Cancel | Save.
 *   Right   Trax, who writes the wording (trax-notification-chat.tsx →
 *           trax-notification-editor).
 *   Setups  the platform's email sender (saved on admin_settings) and the
 *           push checklist with its install guide, as the portal's.
 * The three broadcast items are written on their own screens, so they show a
 * link there instead of a preview. Esc goes back to the dashboard.
 *
 * STATE. Stored rows come from `usePlatformNotificationSettings`. Edits are
 * page state (`ChannelDrafts`) laid over the stored values; Save writes them
 * all, then drops only the drafts it wrote.
 *
 * PERMISSIONS. Super admins only. The protected layout already confines a
 * sales-agent account to /admin/sales, and the table's RLS and
 * notification-test-v2 both re-check `is_super_admin` server side — so this
 * page's own check makes the page read-only rather than pretending an edit
 * will stick.
 *
 * SENDING. As in the portal, what is saved here drives the previews and Send
 * test; live messages still go out as they do today until sending switches over.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowUpRight, Loader2, Moon, RotateCcw, Save, Sun, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { usePlatformEmailSender } from '@/hooks/use-platform-email-sender';
import { usePlatformNotificationSettings } from '@/hooks/use-platform-notification-settings';
import {
  getSystemNotificationItem,
  type SystemNotificationItem,
} from '@/lib/notifications-v2/catalog';
import { PLATFORM_EMAIL_BRAND, senderAddress, settingKey, type ChannelEdit } from '@/lib/notifications-v2/settings-model';
import type { NotificationChannel } from '@/lib/notifications-v2/types';
import { fillVariables, systemExampleValues } from '@/lib/notifications-v2/variables';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import {
  EmailPreviewGmail,
  GMAIL_PREVIEW_VIEWS,
  GmailViewContext,
  PreviewSwitch,
  type GmailPreviewView,
  type PreviewSwitchOption,
} from './email-preview-gmail';
import { emailBodyFromPreview, unfillVariables } from './inline-edit';
import { buildEmailPreviewHtml, type SystemPreviewContext } from './notification-item-panel';
import { AndroidLockScreenPhone, LockScreenPhone, type PhoneEdit } from './phone-previews';
import { PushInstallGuide } from './push-install-guide';
import { SendTestBox, type SendTestDraft } from './send-test-box';
import { SystemEmailSender } from './system-email-sender';
import { SystemPushSetup } from './system-push-setup';
import {
  SYSTEM_NOTIFICATIONS_COPY as COPY,
  categoryGroups,
  channelSpec,
  currentEdit,
  diffIsEmpty,
  draftProblemMessage,
  firstDraftProblem,
  indexRows,
  isNotSentYet,
  itemChannels,
  notSentYetCopy,
  pageDiff,
  pendingItemKeys,
  storedEdit,
  type ChannelDrafts,
} from './system-notifications-model';
import { SystemNotificationsList } from './system-notifications-rail';
import {
  SYSTEM_NOTIFICATIONS_SETUP,
  useSystemNotificationsSelection,
} from './system-notifications-selection-store';
import { TraxNotificationChat } from './trax-notification-chat';
import { confirmDialog } from '@/components/ui/confirm';

/** Where Esc and Back go. */
const EXIT_HREF = '/admin/dashboard';

/** Drive247's square app icon, shown beside a push on the phones. */
const APP_ICON_URL = '/icons/icon-192.png';

/** The test push opens this page. */
const TEST_PUSH_URL = '/admin/notifications';

export interface SystemNotificationsPageProps {
  className?: string;
}

export function SystemNotificationsPage({ className }: SystemNotificationsPageProps) {
  const { user } = useAuthStore();
  const settings = usePlatformNotificationSettings();
  const router = useRouter();

  const [drafts, setDrafts] = useState<ChannelDrafts>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = settings.rows;
  const rowsByKey = useMemo(() => indexRows(rows), [rows]);
  const rowsRef = useRef(rowsByKey);
  rowsRef.current = rowsByKey;

  const diff = useMemo(() => pageDiff(rows, drafts), [rows, drafts]);
  const dirty = !diffIsEmpty(diff);
  const pending = useMemo(() => pendingItemKeys(diff), [diff]);

  const isSuperAdmin = user?.is_super_admin === true;
  const loaded = !settings.isLoading;
  const readFailed = loaded && !!settings.error && rows.length === 0;
  const storageOff = settings.tableMissing === true;
  const canEdit = isSuperAdmin;
  const canSave = canEdit && loaded && !readFailed && !storageOff;

  /* ------------------------------ Selection ------------------------------ */

  const selected = useSystemNotificationsSelection((st) => st.selected);
  const select = useSystemNotificationsSelection((st) => st.select);
  const setPendingKeys = useSystemNotificationsSelection((st) => st.setPending);
  const resetSelection = useSystemNotificationsSelection((st) => st.reset);
  const setupSection = useSystemNotificationsSelection((st) => st.setupSection);

  const selectedItem =
    selected && selected !== SYSTEM_NOTIFICATIONS_SETUP ? (getSystemNotificationItem(selected) ?? null) : null;
  const showSetup = selected === SYSTEM_NOTIFICATIONS_SETUP;

  // Phones only (below md): which of list and detail fills the screen.
  const [phonePane, setPhonePane] = useState<'list' | 'detail'>('list');
  const message = useSystemNotificationsSelection((st) => st.message);
  const setMessage = useSystemNotificationsSelection((st) => st.setMessage);
  const openSetup = useSystemNotificationsSelection((st) => st.openSetup);
  const phoneMessages = useMemo<PreviewSwitchOption<'app' | 'email'>[]>(() => {
    if (!selectedItem || selectedItem.managedElsewhere) return [];
    const out: PreviewSwitchOption<'app' | 'email'>[] = [];
    if (selectedItem.channels.push || selectedItem.channels.in_app) out.push({ value: 'app', label: 'App' });
    if (selectedItem.channels.email) out.push({ value: 'email', label: 'Email' });
    return out;
  }, [selectedItem]);
  const phoneMessage = phoneMessages.some((m) => m.value === message) ? message : (phoneMessages[0]?.value ?? 'app');

  // First visit opens the first notification; cleared on the way out so the
  // next visit starts fresh.
  useEffect(() => {
    const current = useSystemNotificationsSelection.getState().selected;
    if (current === SYSTEM_NOTIFICATIONS_SETUP || (current && getSystemNotificationItem(current))) return;
    const first = categoryGroups('super_admin_to_admin')[0]?.items[0];
    if (first) select(first.key, first.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => resetSelection(), [resetSelection]);

  // The list marks notifications carrying an unsaved edit.
  useEffect(() => {
    setPendingKeys([...pending].sort());
  }, [pending, setPendingKeys]);

  /* ------------------------------- Saving -------------------------------- */

  const save = useCallback(async (): Promise<void> => {
    const problem = firstDraftProblem(rows, drafts);
    if (problem) {
      // Open the message that has to be fixed, so the sentence points somewhere.
      select(problem.item.key, problem.item.direction, problem.channel === 'email' ? 'email' : 'app');
      setSaveError(draftProblemMessage(problem));
      return;
    }
    const written = drafts;
    const toWrite = pageDiff(rows, written);
    if (diffIsEmpty(toWrite)) return;
    setSaveError(null);
    try {
      await settings.saveRows(toWrite);
      // Drop only the drafts this save wrote; anything typed while it ran stays.
      setDrafts((current) => {
        const next: Record<string, ChannelEdit> = { ...current };
        for (const [key, edit] of Object.entries(written)) if (next[key] === edit) delete next[key];
        return next;
      });
      toast.success(COPY.savedToast);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Couldn’t save. Try again in a moment.';
      setSaveError(message);
      toast.error(message);
    }
  }, [drafts, rows, settings, select]);

  const discard = useCallback((): void => {
    setDrafts({});
    setSaveError(null);
  }, []);

  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ------------------------------ Leaving -------------------------------- */

  const leave = useCallback(async (): Promise<void> => {
    if (
      dirty &&
      !(await confirmDialog({ title: 'Leave without saving?', description: 'You have unsaved changes.', confirmLabel: 'Leave', destructive: true }))
    )
      return;
    router.push(EXIT_HREF);
  }, [dirty, router]);

  // Esc leaves. Not while a menu, popover or dialog of ours is open: Radix
  // closes those on the same key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (
        document.querySelector(
          '[data-state="open"][role="menu"], [data-state="open"][role="dialog"], [data-radix-popper-content-wrapper]',
        )
      )
        return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      void leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave]);

  // Full screen: the page behind must not scroll under the view.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /* ------------------------------- Editing ------------------------------- */

  const toggleChannel = useCallback((key: string, channel: NotificationChannel, enabled: boolean) => {
    const item = getSystemNotificationItem(key);
    if (!item || item.managedElsewhere || !channelSpec(item, channel)) return;
    const k = settingKey(key, channel);
    setDrafts((prev) => ({
      ...prev,
      [k]: { ...(prev[k] ?? storedEdit(item, channel, rowsRef.current)), enabled },
    }));
  }, []);

  const changeChannel = useCallback((item: SystemNotificationItem, channel: NotificationChannel, next: ChannelEdit) => {
    setDrafts((prev) => ({ ...prev, [settingKey(item.key, channel)]: next }));
  }, []);

  /* --------------------------- Preview context ---------------------------- */

  const emailSetup = usePlatformEmailSender();
  const examples = useMemo(() => systemExampleValues(), []);
  const sender = useMemo(() => senderAddress(emailSetup.saved.sender), [emailSetup.saved.sender]);
  const context = useMemo<SystemPreviewContext>(
    () => ({
      brand: PLATFORM_EMAIL_BRAND,
      examples,
      fromName: sender.name,
      fromAddress: sender.address,
      defaultTestEmail: user?.email ?? null,
      appName: PLATFORM_EMAIL_BRAND.companyName,
      iconUrl: APP_ICON_URL,
    }),
    [examples, sender.name, sender.address, user?.email],
  );

  const sendTestBlockedReason = canEdit ? null : COPY.noTestForViewer;

  /* ------------------------- The email sender's save ------------------------ */

  const [senderDraft, setSenderDraft] = useState<{ dirty: boolean; save: () => Promise<void>; reset: () => void } | null>(
    null,
  );
  const [senderSaving, setSenderSaving] = useState(false);
  const [senderError, setSenderError] = useState<string | null>(null);
  const onSenderDraft = useCallback((state: { dirty: boolean; save: () => Promise<void>; reset: () => void } | null) => {
    setSenderDraft(state);
  }, []);
  const saveSender = async (): Promise<void> => {
    if (!senderDraft) return;
    setSenderSaving(true);
    setSenderError(null);
    try {
      await senderDraft.save();
      toast.success('Email sender saved.');
    } catch (err) {
      setSenderError(err instanceof Error && err.message ? err.message : 'Couldn’t save. Try again in a moment.');
    } finally {
      setSenderSaving(false);
    }
  };

  /* ------------------------------- Render --------------------------------- */

  const saveBar = canEdit
    ? { dirty, saving: settings.isSaving, canSave, error: saveError, onSave: () => void save(), onCancel: discard }
    : null;

  const title = selectedItem ? selectedItem.name : showSetup ? 'Setups' : COPY.pageTitle;

  const notices: ReactNode = (
    <>
      {!isSuperAdmin && (
        <p role="note" data-permission-note="" className="flex items-center gap-2 border-b px-6 py-2 text-[12px] text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">{COPY.noAccessTitle}.</span> {COPY.noAccessBody}
          </span>
        </p>
      )}
      {storageOff && (
        <p role="note" data-notifications-notice="storage-off" className="border-b px-6 py-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">{COPY.storageOff}</span> {COPY.storageOffDetail}
          {canEdit && dirty && (
            <span className="text-warning" data-notifications-unsavable="">
              {' '}
              {COPY.storageOffEdits}
            </span>
          )}
        </p>
      )}
    </>
  );

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Notifications: ${title}`}
      // The app's own wash, on a solid base set inline (tailwind-merge would
      // keep only one of `bg-background` and `bg-app-gradient`).
      className={cn('bg-app-gradient fixed inset-0 z-50 flex h-dvh w-screen flex-col text-foreground', className)}
      style={{ backgroundColor: 'hsl(var(--background))' }}
      data-system-notifications-page=""
    >
      <div className="flex min-h-0 flex-1">
        {/* Left: every notification, and Setups. */}
        {/* Phones: list → detail. The list fills the screen until a
            notification (or Setups) is tapped, then the detail takes over
            with a Back to the list. At md and up both are always shown. */}
        <div
          className={cn('w-full shrink-0 flex-col md:flex md:w-[272px]', phonePane === 'list' ? 'flex' : 'hidden')}
          onClickCapture={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-rail-item], [data-rail-message], [aria-haspopup="menu"], [role="menuitem"]')) {
              setPhonePane('detail');
            }
          }}
        >
          <SystemNotificationsList className="min-h-0 flex-1" />
        </div>

        <main
          className={cn(
            'relative min-h-0 min-w-0 flex-1 flex-col md:flex',
            phonePane === 'detail' ? 'flex' : 'hidden',
          )}
        >
          {notices}
          {/* Phones: Back to the list, the open notification's name, and its
              App message | Email (or the two setups) — the choices the list
              nests under the open row on wider screens. */}
          <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden" data-phone-detail-bar="">
            <button
              type="button"
              onClick={() => setPhonePane('list')}
              aria-label="Back to the list"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{title}</p>
            {showSetup ? (
              <PreviewSwitch
                label="Setup"
                value={setupSection}
                options={SETUP_OPTIONS}
                onChange={openSetup}
                className="shrink-0 p-[3px] [&>button]:h-7 [&>button]:px-2.5"
              />
            ) : phoneMessages.length > 1 ? (
              <PreviewSwitch
                label="Message"
                value={phoneMessage}
                options={phoneMessages}
                onChange={setMessage}
                className="shrink-0 p-[3px] [&>button]:h-7 [&>button]:px-2.5"
              />
            ) : null}
          </div>

          {showSetup ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
              {/* pt-3: level with the search box at the top of the list. */}
              <div className="w-full flex-1 px-8 pb-6 pt-3 max-md:px-4">
                <div className={cn(setupSection !== 'email' && 'hidden')}>
                  <SystemEmailSender
                    saved={emailSetup.saved}
                    loading={emailSetup.loading}
                    loadError={emailSetup.error}
                    canEdit={canEdit}
                    onSave={emailSetup.save}
                    onDraftChange={onSenderDraft}
                  />
                </div>
                <div className={cn(setupSection !== 'push' && 'hidden')}>
                  <SystemPushSetup canEdit={canEdit} />
                  {/* How to install the dashboard and allow push, per device, with pictures. */}
                  <PushInstallGuide
                    className="mt-10"
                    portalHost="admin.drive-247.com"
                    appName="Drive247 Admin"
                    iconUrl={APP_ICON_URL}
                  />
                </div>
              </div>
              {/* Bottom of the setup: Back on the left, Reset | Save changes on
                  the right, both floating at the foot of the view. */}
              <div className="pointer-events-none sticky bottom-4 z-30 flex items-end justify-between gap-3 px-8 pb-1 pt-2 max-md:px-4">
                {/* Phones leave through the list's own Back instead. */}
                <button
                  type="button"
                  onClick={leave}
                  className="pointer-events-auto inline-flex h-11 max-md:hidden items-center gap-1.5 rounded-full border bg-card px-4 text-[13px] font-medium text-foreground shadow-lg transition-colors duration-200 ease-out hover:bg-muted motion-reduce:transition-none"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Back to dashboard
                </button>
                {canEdit && setupSection === 'email' && (
                  <div className="pointer-events-auto flex min-w-0 items-center gap-3 max-md:ml-auto">
                    {senderError && (
                      <span role="alert" className="max-w-[320px] truncate rounded-full bg-card max-md:max-w-[150px] px-3 py-1 text-xs text-destructive shadow-sm" title={senderError}>
                        Not saved. {senderError}
                      </span>
                    )}
                    <div className="flex h-11 items-center gap-1 rounded-full border bg-card p-1 shadow-lg" data-save-bar="">
                      <button
                        type="button"
                        onClick={() => {
                          setSenderError(null);
                          senderDraft?.reset();
                        }}
                        disabled={!senderDraft?.dirty || senderSaving}
                        className="h-9 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSender()}
                        disabled={!senderDraft?.dirty || senderSaving}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-50"
                      >
                        {senderSaving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                        {senderSaving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : !loaded ? (
            <div role="status" aria-label={COPY.loading} className="space-y-3 p-6" data-notifications-loading="">
              <Skeleton className="h-6 w-56" />
              <div className="flex gap-6">
                <Skeleton className="h-[480px] flex-1 rounded-3xl" />
                <Skeleton className="hidden h-[480px] w-[400px] rounded-3xl lg:block" />
              </div>
            </div>
          ) : readFailed ? (
            <div className="p-6">
              <div
                role="alert"
                data-notifications-load-error=""
                className="max-w-xl space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
              >
                <p className="text-sm text-foreground">
                  Couldn’t load {COPY.loadThing}. {settings.error?.message}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => void settings.refresh()}>
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  {COPY.retry}
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
              {selectedItem ? (
                selectedItem.managedElsewhere ? (
                  <ManagedElsewhereView item={selectedItem} />
                ) : (
                  <NotificationWorkspace
                    key={selectedItem.key}
                    item={selectedItem}
                    edits={
                      Object.fromEntries(
                        itemChannels(selectedItem).map((channel) => [
                          channel,
                          currentEdit(selectedItem, channel, rowsByKey, drafts),
                        ]),
                      ) as Partial<Record<NotificationChannel, ChannelEdit>>
                    }
                    canEdit={canEdit}
                    sendTestBlockedReason={sendTestBlockedReason}
                    context={context}
                    onToggle={toggleChannel}
                    onChange={changeChannel}
                    saveBar={saveBar}
                  />
                )
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );

  // Portalled to <body>: a fixed layer inside the dashboard's column would be
  // trapped by any transformed ancestor, and must sit over the dashboard chrome.
  return portalTarget ? createPortal(overlay, portalTarget) : null;
}

/* -------------------------------------------------------------------------- */
/* One notification: the preview in the main view, Trax on the right            */
/* -------------------------------------------------------------------------- */

type MessageKind = 'app' | 'email';

interface SaveBarState {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Two messages, picked in the left list under the open notification:
 *   App message  ONE title + message for both phone push and the bell. Push is
 *                the source when the item has it (its limits are the stricter),
 *                and every edit is mirrored into the bell's template. One
 *                switch turns them on or off together.
 *   Email        subject + body.
 */
function NotificationWorkspace({
  item,
  edits,
  canEdit,
  sendTestBlockedReason,
  context,
  onToggle,
  onChange,
  saveBar,
}: {
  item: SystemNotificationItem;
  edits: Partial<Record<NotificationChannel, ChannelEdit>>;
  canEdit: boolean;
  sendTestBlockedReason: string | null;
  context: SystemPreviewContext;
  onToggle: (key: string, channel: NotificationChannel, enabled: boolean) => void;
  onChange: (item: SystemNotificationItem, channel: NotificationChannel, next: ChannelEdit) => void;
  saveBar: SaveBarState | null;
}) {
  const appChannels = itemChannels(item).filter((c): c is 'push' | 'in_app' => c !== 'email');
  const appSource = appChannels[0] ?? null;
  const appEdit = appSource ? (edits[appSource] ?? null) : null;
  const appWording = appEdit ? (appEdit.template as { title: string; body: string }) : null;
  const emailEdit = edits.email ?? null;
  const emailWording = emailEdit ? (emailEdit.template as { subject: string; body: string }) : null;

  const picked = useSystemNotificationsSelection((st) => st.message);
  const message: MessageKind = picked === 'email' ? (emailEdit ? 'email' : 'app') : appSource ? 'app' : 'email';
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');

  const changeApp = (next: ChannelEdit): void => {
    if (!appSource) return;
    onChange(item, appSource, next);
    const t = next.template as { title: string; body: string };
    for (const other of appChannels) {
      if (other === appSource) continue;
      const current = edits[other];
      if (current) onChange(item, other, { ...current, template: { title: t.title, body: t.body } });
    }
  };
  const changeEmail = (next: ChannelEdit): void => onChange(item, 'email', next);

  // The message on screen and its one switch. App message's reads "on" when
  // any of its channels is on, and turning it sets them all.
  const active =
    message === 'app' && appSource && appEdit
      ? {
          channel: appSource as NotificationChannel,
          also: appChannels.filter((c) => c !== appSource) as NotificationChannel[],
          label: 'App message',
          enabled: appChannels.some((c) => edits[c]?.enabled === true),
        }
      : emailEdit
        ? { channel: 'email' as NotificationChannel, also: [] as NotificationChannel[], label: 'Email', enabled: emailEdit.enabled }
        : null;

  // Send test: email to an address; push to this super admin's own devices.
  // An app message with no push lands only in the bell, which has no test.
  const testChannel: 'email' | 'push' | null =
    message === 'email' ? 'email' : appChannels.includes('push') ? 'push' : null;
  const buildTest = (): SendTestDraft => {
    if (testChannel === 'email' && emailWording) {
      return {
        channel: 'email',
        notificationKey: item.key,
        subject: fillVariables(emailWording.subject, context.examples),
        bodyHtml: fillVariables(emailWording.body, context.examples, { html: true }),
      };
    }
    const pushEdit = edits.push;
    const t = (pushEdit?.template ?? { title: '', body: '' }) as { title: string; body: string };
    return {
      channel: 'push',
      notificationKey: item.key,
      title: fillVariables(t.title, context.examples),
      body: fillVariables(t.body, context.examples),
      url: TEST_PUSH_URL,
      pushOptions: pushEdit?.pushOptions ?? undefined,
    };
  };

  const phoneEdit: PhoneEdit | undefined =
    canEdit && appEdit && appWording
      ? {
          onTitle: (text) =>
            changeApp({
              ...appEdit,
              template: { title: unfillVariables(text, item.variables, context.examples), body: appWording.body },
            }),
          onBody: (text) =>
            changeApp({
              ...appEdit,
              template: { title: appWording.title, body: unfillVariables(text, item.variables, context.examples) },
            }),
        }
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col max-md:h-auto lg:flex-row" data-notification-item={item.key}>
      {/* MAIN: the preview, then its switch, theme, Send test and Save. */}
      {/* Phones: the preview gets the screen under the bar (the column scrolls
          on to Trax below), rather than what is left beside a 70vh chat. */}
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col max-md:h-[calc(100dvh-57px)] max-md:flex-none"
        data-notification-main="" aria-label={`${item.name}: preview`}>
        <h2 className="sr-only">{message === 'app' ? 'App message' : 'Email'}</h2>

        {active ? (
          <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-2 pt-1.5">
            {/* Always whole on screen: the preview shrinks to fit, never scrolls. */}
            {message === 'app' && appWording ? (
              <FitToBox grow>
                <div className="flex flex-wrap justify-center gap-6">
                  <LockScreenPhone
                    title={fillVariables(appWording.title, context.examples)}
                    body={fillVariables(appWording.body, context.examples)}
                    appName={context.appName}
                    iconUrl={context.iconUrl}
                    dark={previewTheme === 'dark'}
                    edit={phoneEdit}
                  />
                  <AndroidLockScreenPhone
                    title={fillVariables(appWording.title, context.examples)}
                    body={fillVariables(appWording.body, context.examples)}
                    appName={context.appName}
                    iconUrl={context.iconUrl}
                    dark={previewTheme === 'dark'}
                    edit={phoneEdit}
                  />
                </div>
              </FitToBox>
            ) : emailEdit && emailWording ? (
              <EmailPair
                theme={previewTheme}
                onEditSubject={
                  canEdit
                    ? (text) =>
                        changeEmail({
                          ...emailEdit,
                          template: { ...emailWording, subject: unfillVariables(text, item.variables, context.examples) },
                        })
                    : undefined
                }
                onEditBody={
                  canEdit
                    ? (cellHtml) => {
                        const body = emailBodyFromPreview(cellHtml, item.variables, context.examples);
                        if (body && body !== emailWording.body) changeEmail({ ...emailEdit, template: { ...emailWording, body } });
                      }
                    : undefined
                }
                render={() => <EmailPreviewForItem item={item} wording={emailWording} context={context} />}
              />
            ) : null}

            {/* The preview's own controls: On | Off, Light / Dark, Send test, then Cancel | Save. */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 px-1.5 pt-2" data-preview-controls="">
              <div className="flex items-center gap-2" data-channel-switch={active.channel}>
                <PreviewSwitch
                  label={`${active.label} for ${item.name}`}
                  value={active.enabled ? 'on' : 'off'}
                  options={ON_OFF_OPTIONS}
                  className="p-[3px] [&>button]:h-6 [&>button]:px-3"
                  onChange={(v) => {
                    if (!canEdit) return;
                    const checked = v === 'on';
                    onToggle(item.key, active.channel, checked);
                    for (const other of active.also) onToggle(item.key, other, checked);
                  }}
                />
                {[active.channel, ...active.also].every((c) => isNotSentYet(item, c)) && (
                  <span title={notSentYetCopy(active.channel)} className="text-[11px] text-muted-foreground" data-channel-not-sent={active.channel}>
                    {COPY.notSentYet}
                  </span>
                )}
              </div>
              <PreviewSwitch
                iconOnly
                className="p-[3px]"
                label="Preview theme"
                value={previewTheme}
                options={THEME_OPTIONS}
                onChange={setPreviewTheme}
              />
              {testChannel ? (
                <SendTestBox
                  key={`${item.key}:${testChannel}`}
                  compact
                  channel={testChannel}
                  notificationKey={item.key}
                  buildRequest={buildTest}
                  defaultEmail={context.defaultTestEmail}
                  canSend={canEdit}
                  disabledReason={sendTestBlockedReason}
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">{COPY.inAppNoTest}</span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-4 pr-3">
                {saveBar?.error && (
                  <span role="alert" className="max-w-[260px] truncate text-xs text-destructive" title={saveBar.error}>
                    Not saved. {saveBar.error}
                  </span>
                )}
                {/* Cancel | Save as one grouped control, icons only, split by a
                    hairline. Both wait for an edit. */}
                {saveBar && (
                  <div
                    role="group"
                    aria-label="Save or cancel changes"
                    data-notification-save-bar=""
                    className="inline-flex h-8 items-center rounded-full border bg-background/60 p-[3px]"
                  >
                    <button
                      type="button"
                      aria-label="Cancel changes"
                      title="Cancel changes"
                      onClick={saveBar.onCancel}
                      disabled={!saveBar.dirty || saveBar.saving}
                      className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
                    >
                      <X className="size-3.5" strokeWidth={3} aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
                    <button
                      type="button"
                      aria-label={saveBar.saving ? 'Saving' : 'Save changes'}
                      title={saveBar.saving ? 'Saving…' : saveBar.canSave ? 'Save changes' : COPY.storageOff}
                      onClick={saveBar.onSave}
                      disabled={!saveBar.dirty || saveBar.saving || !saveBar.canSave}
                      className="flex size-6 items-center justify-center rounded-full text-primary transition-colors duration-200 ease-out hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    >
                      {saveBar.saving ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="px-6 py-5 text-[13px] text-muted-foreground">{item.name} has no message to edit here.</p>
        )}
      </section>

      {/* RIGHT RAIL: Trax only. Both conversations stay mounted, so switching
          between App message and Email keeps each one's history. */}
      <aside
        aria-label={`${item.name}: Trax`}
        className="flex h-[70vh] min-h-0 min-w-0 flex-col border-t lg:h-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-t-0"
        data-notification-rail=""
      >
        {appSource && appEdit && appWording && (
          <TraxNotificationChat
            kind="app"
            view={{
              preview: 'the app message as a push notification on an iPhone lock screen and an Android lock screen, side by side',
              theme: previewTheme,
              company: context.appName,
            }}
            item={item}
            canEdit={canEdit}
            wording={appWording}
            onApply={(next) => changeApp({ ...appEdit, template: { title: next.title ?? '', body: next.body } })}
            className={cn('flex-1', message !== 'app' && 'hidden')}
          />
        )}
        {emailEdit && emailWording && (
          <TraxNotificationChat
            kind="email"
            view={{ preview: 'the email in Gmail, desktop and phone side by side', theme: previewTheme, company: context.appName }}
            item={item}
            canEdit={canEdit}
            wording={emailWording}
            onApply={(next) => changeEmail({ ...emailEdit, template: { subject: next.subject ?? '', body: next.body } })}
            className={cn('flex-1', message !== 'email' && 'hidden')}
          />
        )}
      </aside>
    </div>
  );
}

/** The email in Gmail, filled with example values. Rendered once per Gmail (desktop, phone). */
function EmailPreviewForItem({
  item,
  wording,
  context,
}: {
  item: SystemNotificationItem;
  wording: { subject: string; body: string };
  context: SystemPreviewContext;
}) {
  const settledBody = useSettledValue(wording.body);
  const html = useMemo(
    () => buildEmailPreviewHtml(settledBody, context.examples, context.brand),
    [settledBody, context.examples, context.brand],
  );
  // A message TO us is shown going to the signed-in super admin; anything else
  // to the operator's contact address.
  const toAddress =
    item.direction === 'admin_to_super_admin'
      ? (context.defaultTestEmail ?? 'the Drive247 notification address')
      : (context.examples.tenant_contact_email ?? '');
  return (
    <EmailPreviewGmail
      subject={fillVariables(wording.subject, context.examples)}
      html={html}
      fromName={context.fromName}
      fromAddress={context.fromAddress}
      toAddress={toAddress}
    />
  );
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
/* Fit to the box: the whole preview on screen at once                         */
/* -------------------------------------------------------------------------- */

const ON_OFF_OPTIONS: readonly PreviewSwitchOption<'on' | 'off'>[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/** Phones: the two setups, which the Setups card's hover menu offers on wider screens. */
const SETUP_OPTIONS: readonly PreviewSwitchOption<'email' | 'push'>[] = [
  { value: 'email', label: 'Sender' },
  { value: 'push', label: 'Push' },
];

const THEME_OPTIONS: readonly PreviewSwitchOption<'light' | 'dark'>[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

/**
 * Scales its content to fit the space it is given, width and height. With
 * `grow` it also scales UP (to 1.8×) and centres, for content smaller than its
 * box (the phones). `offsetHeight` ignores the transform, so the measure is stable.
 */
function FitToBox({ children, grow = false }: { children: ReactNode; grow?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === 'undefined') return;
    const fit = (): void => {
      const h = i.offsetHeight;
      const room = o.clientHeight;
      let next = h > 0 && room > 0 ? Math.min(1, room / h) : 1;
      if (grow && h > 0 && room > 0) {
        const w = i.offsetWidth;
        const roomW = o.clientWidth;
        next = Math.min(1.8, room / h, w > 0 && roomW > 0 ? roomW / w : 1.8);
      }
      setScale(next);
      setTop(grow && h > 0 ? Math.max(0, (room - h * next) / 2) : 0);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(o);
    observer.observe(i);
    fit();
    return () => observer.disconnect();
  }, [grow]);
  return (
    <div ref={outer} className="relative min-h-0 flex-1 overflow-hidden" data-fit-to-box="">
      <div
        ref={inner}
        className={cn('absolute left-1/2 top-0 origin-top', grow ? 'w-max' : 'w-full')}
        style={{ transform: `translateY(${top}px) translateX(-50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Email: desktop and phone Gmail, together filling the preview box            */
/* -------------------------------------------------------------------------- */

const PAIR_GAP = 4;

/**
 * Both Gmails at the box's full height, side by side, with no space left over:
 *   phone    scaled to the box's height (at most 40% of the box's width);
 *   desktop  scaled to the same height, and laid out wider (`widen`) until that
 *            scaled width is exactly what the phone leaves.
 */
function EmailPair({
  theme,
  render,
  onEditSubject,
  onEditBody,
}: {
  theme: 'light' | 'dark';
  render: () => ReactNode;
  onEditSubject?: (text: string) => void;
  onEditBody?: (cellHtml: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ W: 0, H: 0, hd: 0, hp: 0, phoneOnly: false });

  useEffect(() => {
    const b = box.current;
    const d = desk.current;
    const p = phone.current;
    if (!b || !d || !p || typeof ResizeObserver === 'undefined') return;
    const read = (): void =>
      setM((prev) => {
        // On a phone screen (below md) two Gmails side by side would each be
        // unreadably small, so only the phone one shows, at the box's width.
        const next = {
          W: b.clientWidth,
          H: b.clientHeight,
          hd: d.offsetHeight,
          hp: p.offsetHeight,
          phoneOnly: window.innerWidth < 768,
        };
        return prev.W === next.W &&
          prev.H === next.H &&
          prev.hd === next.hd &&
          prev.hp === next.hp &&
          prev.phoneOnly === next.phoneOnly
          ? prev
          : next;
      });
    const observer = new ResizeObserver(read);
    for (const el of [b, d, p]) observer.observe(el);
    read();
    return () => observer.disconnect();
  }, []);

  const PW = GMAIL_PREVIEW_VIEWS.phone.mockupWidth;
  const DW = GMAIL_PREVIEW_VIEWS.desktop.mockupWidth;
  const ready = m.W > 0 && m.H > 0 && m.hd > 0 && m.hp > 0;
  const sp = ready ? Math.min(m.H / m.hp, (m.W * (m.phoneOnly ? 1 : 0.4)) / PW) : 0;
  const wp = PW * sp;
  const wd = Math.max(0, m.W - PAIR_GAP - wp);
  const MIN_WIDEN = 0.65;
  const sdByHeight = ready ? m.H / m.hd : 0;
  const widen = sdByHeight > 0 ? Math.min(6, Math.max(MIN_WIDEN, wd / sdByHeight / DW)) : 1;
  const sd = !ready ? 0 : Math.min(sdByHeight, wd / (DW * widen));

  const desktopView = useMemo(
    () => ({ view: 'desktop' as GmailPreviewView, theme, widen, onEditSubject, onEditBody }),
    [theme, widen, onEditSubject, onEditBody],
  );
  const phoneView = useMemo(
    () => ({ view: 'phone' as GmailPreviewView, theme, onEditSubject, onEditBody }),
    [theme, onEditSubject, onEditBody],
  );

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-email-previews="">
      <div
        ref={desk}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: DW * widen, transform: `scale(${sd})`, visibility: ready && !m.phoneOnly ? 'visible' : 'hidden' }}
      >
        <GmailViewContext.Provider value={desktopView}>{render()}</GmailViewContext.Provider>
      </div>
      <div
        ref={phone}
        className={cn('absolute top-0', m.phoneOnly ? 'left-1/2 origin-top' : 'right-0 origin-top-right')}
        style={{ width: PW, transform: m.phoneOnly ? `translateX(-50%) scale(${sp})` : `scale(${sp})`, visibility: ready ? 'visible' : 'hidden' }}
      >
        <GmailViewContext.Provider value={phoneView}>{render()}</GmailViewContext.Provider>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The broadcast items: written on their own screens                           */
/* -------------------------------------------------------------------------- */

function ManagedElsewhereView({ item }: { item: SystemNotificationItem }) {
  const managed = item.managedElsewhere;
  if (!managed) return null;
  return (
    <div className="flex h-full items-center justify-center p-8" data-managed-elsewhere={managed.href}>
      <div className="max-w-md space-y-3 text-center">
        <h2 className="text-lg font-semibold text-foreground">{item.name}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{item.tooltip}</p>
        <p className="text-[13px] text-muted-foreground">
          {COPY.managedElsewhereLead} It lives on <span className="text-foreground">{managed.screen}</span>.
        </p>
        <Button asChild size="sm" className="rounded-full">
          <Link href={managed.href}>
            {COPY.managedElsewhereAction} {managed.screen}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default SystemNotificationsPage;
