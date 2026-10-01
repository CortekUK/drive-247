"use client";

/**
 * v2 Settings › Notifications (`?tab=notifications`, northwind canary): one
 * page for every email, push and in-app message the platform sends (build-spec
 * D7–D18; transcript §3, "one single page where the operator maintains all of
 * it, organised in sections").
 *
 * LAYOUT (Oct 1 2026, Ghulam): a FULL-SCREEN view, 100vw × 100vh, like the
 * agreement template editor — portalled to <body> over the whole app.
 *   No top bar. ← Settings sits at the top of the left pane, and the view's
 *   own Reset / Save floats over the preview only while there is something
 *   to save (the view covers the settings page's sticky bar; saves are still
 *   forwarded to that page so its leave guard asks first).
 *   Left    notifications-rail.tsx: search, Your team | Customers, the
 *           categories and their notifications, Setups at the bottom. It only
 *           chooses (notifications-selection-store).
 *   Middle  the PREVIEW: tabs App message | Email, that message's switches
 *           (Phone push and Bell, or Email), the "today" line and Send test,
 *           then two whole phones or Gmail. App message is ONE title +
 *           message that feeds both phone push and the bell.
 *   Right   Trax, who writes the wording (trax-notification-chat.tsx →
 *           trax-notification-editor); "Manual" swaps in the plain fields.
 *   Setups shows the Channels setup and What's sent today (D18).
 *   `?tab=reminders` / `?tab=push` open on Setups.
 *
 * STATE. Stored rows come from useNotificationSettingsV2. Edits are page state
 * (`ChannelDrafts`), laid over the stored values; the page's ONE save bar saves
 * them under "notifications" (registered only while there is something to
 * write), then clears the drafts it wrote. Reset (the bar's) drops them.
 *
 * PERMISSIONS. `canEdit` is canEditSettings('notifications'). A view-only user
 * sees everything and can open every panel and preview, but every switch,
 * field and Send test is off. The page is in V2_PAGES_GATING_OWN_CONTROLS, so
 * the settings page's disabled fieldset never locks the previews' own toggles.
 *
 * WEIGHT. The settings page loads this file on demand; the email editor is
 * loaded on demand again. Only the chosen notification is mounted.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useGuardedRouter } from "@/lib/leave-guard";
import { ArrowLeft, Loader2, Moon, Save, Sun, X } from "lucide-react";
import { TooltipProvider } from "@/components/ui-v2/tooltip";
import { useTenant } from "@/contexts/TenantContext";
import { useEmailBrandingV2 } from "@/hooks/use-email-branding-v2";
import { useEmailNotificationPrefs } from "@/hooks/use-email-notification-prefs";
import { useEmailSenderV2 } from "@/hooks/use-email-sender-v2";
import { useNotificationSettingsV2 } from "@/hooks/use-notification-settings-v2";
import { useNotificationTestV2 } from "@/hooks/use-notification-test-v2";
import { getNotificationItem } from "@/lib/notifications-v2/catalog";
import { senderAddress, settingKey, type ChannelEdit } from "@/lib/notifications-v2/settings-model";
import type { NotificationChannel, NotificationDirection, NotificationItem } from "@/lib/notifications-v2/types";
import { exampleValues, fillVariables } from "@/lib/notifications-v2/variables";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth-store";
import { useRegisterLeaveSave } from "../business-section-save";
import type { RegisterSectionSave } from "../pricing-money-parts";
import { EmailNotificationSettingsV2 } from "../notification-states-v2";
import { SettingsLoadError, SettingsSectionSkeleton, useWarnOnUnsavedChanges } from "../section-states";
import {
  SETTINGS_PANEL_FLUSH,
  SETTINGS_SECTION_TITLE,
  SettingsRow,
  SettingsRowAlignProvider,
  SettingsSection,
  SettingsStickySaveBar,
} from "../settings-kit";
import { settingsSectionId } from "../settings-shell-state";
import { EmailSenderSettingsV2 } from "./email-sender-settings-v2";
import { NotificationChannelView, type NotificationPreviewContext } from "./notification-item-panel";
import {
  GMAIL_PREVIEW_VIEWS,
  GmailViewContext,
  PreviewSwitch,
  type GmailPreviewView,
  type PreviewSwitchOption,
} from "./email-preview-gmail";
import { NOTIFICATIONS_SETUP, useNotificationsSelection } from "./notifications-selection-store";
import { NotificationsList } from "./notifications-rail";
import { AndroidLockScreenPhone, LockScreenPhone, type PhoneEdit } from "./phone-previews";
import { emailBodyFromPreview, unfillVariables } from "./inline-edit";
import { TraxNotificationChat } from "./trax-notification-chat";
import {
  CHANNEL_LABELS,
  NOTIFICATIONS_EMAIL_ANCHOR,
  NOTIFICATIONS_PAGE_COPY as COPY,
  NOTIFICATIONS_PUSH_ANCHOR,
  NOTIFICATIONS_SAVE_KEY,
  NOTIFICATIONS_TODAY_ANCHOR,
  NOTIFICATION_DIRECTION_GROUPS,
  categoryGroups,
  channelSpec,
  currentEdit,
  diffIsEmpty,
  draftProblemMessage,
  firstDraftProblem,
  indexRows,
  isNotSentYet,
  itemChannels,
  notApplicableCopy,
  notSentYetCopy,
  pageDiff,
  pendingItemKeys,
  pushSetupTestRequest,
  pushSetupTestResponse,
  storedEdit,
  type ChannelDrafts,
} from "./notifications-page-model";
import { PUSH_SETUP_TEST_MESSAGE, PushSetupV2 } from "./push-setup-v2";
import { PushInstallGuide } from "./push-install-guide";

export interface NotificationsPageV2Props {
  /** canEditSettings('notifications'): false shows everything read-only. */
  canEdit: boolean;
  /** The settings page's save-bar registry (`registerV2SectionSave`). */
  registerSave?: RegisterSectionSave;
  /**
   * The settings page's own live controls for "What's sent today" (the in-app
   * payment reminders and the reminder rules, which read the page's org
   * settings), shown under the team email categories. Omitted: nothing.
   */
  todaySettings?: ReactNode;
  /**
   * The section an old link points at (`settings-notifications-push` for
   * `?tab=push`). A setup's anchor opens the rail's Setups view on first render.
   */
  scrollTarget?: string | null;
  className?: string;
}

export function NotificationsPageV2({ canEdit, registerSave, todaySettings, scrollTarget, className }: NotificationsPageV2Props) {
  const { tenant } = useTenant();
  const { appUser, user } = useAuth();
  const settings = useNotificationSettingsV2();
  const { sendTest } = useNotificationTestV2();
  const branding = useEmailBrandingV2();
  const senderQuery = useEmailSenderV2();
  const prefsQuery = useEmailNotificationPrefs();

  const tenantId = tenant?.id ?? null;
  const [drafts, setDrafts] = useState<ChannelDrafts>({});

  const rows = settings.rows;
  const rowsByKey = useMemo(() => indexRows(rows), [rows]);
  const rowsRef = useRef(rowsByKey);
  rowsRef.current = rowsByKey;

  const diff = useMemo(() => pageDiff(rows, drafts, tenantId), [rows, drafts, tenantId]);
  const dirty = !diffIsEmpty(diff);
  const pending = useMemo(() => pendingItemKeys(diff), [diff]);

  // Nothing is shown as a setting until the real rows are in: defaults painted
  // over a slow or failed read look exactly like the tenant's configuration.
  const loaded = !!tenant && !settings.isLoading;
  const readFailed = loaded && !!settings.error && rows.length === 0;
  const storageOff = settings.tableMissing === true;
  const canSave = canEdit && loaded && !readFailed && !storageOff;

  /* ---------------------- The header's Save and Reset --------------------- */

  // This view covers the settings page, including its sticky save bar, so it
  // carries its own Save. Every save registered from here (the notifications
  // drafts, the email sender under Setups) is recorded locally AND forwarded to
  // the settings page, whose leave guard still asks before an unsaved exit.
  const [localSaves, setLocalSaves] = useState<Record<string, { save: () => Promise<unknown>; discard?: () => void }>>({});
  const registerLocal = useCallback<RegisterSectionSave>(
    (key, saveFn, discardFn) => {
      registerSave?.(key, saveFn, discardFn);
      setLocalSaves((prev) => {
        if (!saveFn) {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: { save: saveFn, discard: discardFn } };
      });
    },
    [registerSave],
  );
  const anyDirty = Object.keys(localSaves).length > 0;
  const [headerSaving, setHeaderSaving] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  // The kit's save bar takes an error object; one per message, so it does not re-fire.
  const headerErrorObject = useMemo(() => (headerError ? new Error(headerError) : null), [headerError]);
  const saveAll = async () => {
    setHeaderSaving(true);
    setHeaderError(null);
    try {
      for (const entry of Object.values(localSaves)) await entry.save();
    } catch (e) {
      setHeaderError(e instanceof Error && e.message ? e.message : "Try again in a moment.");
    } finally {
      setHeaderSaving(false);
    }
  };
  const resetAll = () => {
    setHeaderError(null);
    for (const entry of Object.values(localSaves)) entry.discard?.();
  };

  // Esc goes back to Settings, through the leave guard (Save / Don't save when
  // there are edits). Not while a menu, popover or dialog of ours is open:
  // Radix closes those on the same key.
  const router = useGuardedRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[data-state="open"][role="menu"], [data-state="open"][role="dialog"], [data-radix-popper-content-wrapper]')) return;
      router.push("/settings");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // Full screen: the page behind must not scroll under the view.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /* ------------------------------- Saving -------------------------------- */

  const save = async () => {
    if (!tenantId) throw new Error("Your account details haven't loaded yet. Try again in a moment.");
    const problem = firstDraftProblem(rows, drafts, tenantId);
    if (problem) {
      select(problem.item.key, problem.item.direction);
      throw new Error(draftProblemMessage(problem));
    }
    const written = drafts;
    const toWrite = pageDiff(rows, written, tenantId);
    if (!diffIsEmpty(toWrite)) await settings.saveRows(toWrite);
    // Drop only the drafts this save wrote; anything typed while it ran stays.
    setDrafts((current) => {
      const next: Record<string, ChannelEdit> = { ...current };
      for (const [key, edit] of Object.entries(written)) if (next[key] === edit) delete next[key];
      return next;
    });
  };
  const discard = () => setDrafts({});

  useRegisterLeaveSave(canEdit ? registerLocal : undefined, NOTIFICATIONS_SAVE_KEY, dirty && canSave, save, discard);

  // While notifications storage is off nothing can be saved, so no save is
  // registered and the page's leave dialog — which is fed by the registered
  // sections — has nothing to warn about. Edits are still allowed (they drive
  // the previews), so at least closing or reloading the tab asks first instead
  // of dropping them without a word. In-app navigation is still silent: the
  // page says so in the notice above, and a page that cannot save cannot
  // honestly offer the leave dialog's Save.
  useWarnOnUnsavedChanges(dirty && !canSave);

  /* ------------------------------- Editing ------------------------------- */

  const toggleChannel = useCallback((key: string, channel: NotificationChannel, enabled: boolean) => {
    const item = getNotificationItem(key);
    if (!item || !channelSpec(item, channel)) return;
    const k = settingKey(key, channel);
    setDrafts((prev) => ({ ...prev, [k]: { ...(prev[k] ?? storedEdit(item, channel, rowsRef.current)), enabled } }));
  }, []);

  const changeChannel = useCallback((item: NotificationItem, channel: NotificationChannel, next: ChannelEdit) => {
    setDrafts((prev) => ({ ...prev, [settingKey(item.key, channel)]: next }));
  }, []);

  /* ------------------------------ Selection ------------------------------ */

  // The rail (the sidebar, notifications-rail.tsx) chooses; this page shows it.
  const selected = useNotificationsSelection((st) => st.selected);
  const select = useNotificationsSelection((st) => st.select);
  const setPendingKeys = useNotificationsSelection((st) => st.setPending);
  const resetSelection = useNotificationsSelection((st) => st.reset);

  const selectedItem = selected && selected !== NOTIFICATIONS_SETUP ? getNotificationItem(selected) ?? null : null;
  const showSetup = selected === NOTIFICATIONS_SETUP;
  const setupSection = useNotificationsSelection((st) => st.setupSection);
  const openSetup = useNotificationsSelection((st) => st.openSetup);

  // First visit: an old link to a setup (`?tab=push` / `?tab=reminders`) opens
  // Setups; anything else opens the first notification. Cleared on the way out
  // so the next visit starts fresh.
  useEffect(() => {
    const current = useNotificationsSelection.getState().selected;
    if (current === NOTIFICATIONS_SETUP || (current && getNotificationItem(current))) return;
    const target = scrollTarget ?? "";
    if (target.includes(NOTIFICATIONS_PUSH_ANCHOR)) {
      openSetup("push");
      return;
    }
    if (target.includes(NOTIFICATIONS_EMAIL_ANCHOR)) {
      openSetup("email");
      return;
    }
    const first = categoryGroups("customer_to_team")[0]?.items[0];
    if (first) select(first.key, first.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => resetSelection(), [resetSelection]);

  // The rail marks notifications carrying an unsaved edit.
  useEffect(() => {
    setPendingKeys([...pending].sort());
  }, [pending, setPendingKeys]);

  /* --------------------------- Preview context ---------------------------- */

  const brand = branding.brand;
  const slug = branding.slug ?? tenant?.slug ?? null;
  const companyName = branding.companyName ?? tenant?.company_name ?? "";
  const examples = useMemo(
    () => exampleValues(brand, { currencyCode: tenant?.currency_code ?? null, slug }),
    [brand, tenant?.currency_code, slug],
  );
  const sender = senderAddress(storageOff ? null : senderQuery.sender, { company_name: companyName, slug });
  const prefs = prefsQuery.prefs;
  const teamRecipient = prefs?.recipientEmail?.trim() || prefs?.contactEmail?.trim() || "";
  const defaultTestEmail = appUser?.email ?? user?.email ?? null;
  const context = useMemo<NotificationPreviewContext>(
    () => ({
      brand,
      examples,
      fromName: sender.name,
      fromAddress: sender.address,
      teamRecipient,
      defaultTestEmail,
      appName: companyName || "Your company",
      // A phone shows the app's SQUARE icon beside a push, never the wide logo.
      iconUrl: branding.iconUrl ?? brand.logoUrl ?? null,
    }),
    [brand, examples, sender.name, sender.address, teamRecipient, defaultTestEmail, companyName, branding.iconUrl],
  );

  // The test function refuses ops users (notification-test-v2 FULL_ACCESS_ROLES
  // + managers with editor on Notifications), so the button says so up front.
  const canSendTests = canEdit && appUser?.role !== "ops";
  const sendTestBlockedReason = !canEdit ? COPY.noTestForViewer : canSendTests ? null : COPY.noTestForRole;

  // "Push on this device" tests through notification-test-v2 as well, so the
  // test shows the Open in app button (send-push can't add one).
  // A role the function refuses is told so without a round trip.
  const sendPushSetupTest = useCallback(async () => {
    if (!canSendTests) {
      const reason = sendTestBlockedReason ?? COPY.noTestForRole;
      return { success: false, error: reason, message: reason };
    }
    return pushSetupTestResponse(await sendTest(pushSetupTestRequest(PUSH_SETUP_TEST_MESSAGE)));
  }, [canSendTests, sendTestBlockedReason, sendTest]);


  /* ------------------------------- Render --------------------------------- */

  /* D18: until sending switches over, the switches on each notification change
     nothing live. These still do, so they stay reachable under Setups. */
  const todaySection = (
    <SettingsSection anchor={NOTIFICATIONS_TODAY_ANCHOR} title={COPY.todayTitle} description={COPY.todayDescription}>
      <div className="space-y-6">
        <EmailNotificationSettingsV2 canEdit={canEdit} parts="categories" />
        {todaySettings}
      </div>
    </SettingsSection>
  );

  const renderItem = (item: NotificationItem) => (
    <NotificationWorkspace
      key={item.key}
      item={item}
      edits={Object.fromEntries(
        itemChannels(item).map((channel) => [channel, currentEdit(item, channel, rowsByKey, drafts)]),
      ) as Partial<Record<NotificationChannel, ChannelEdit>>}
      canEdit={canEdit}
      canSendTests={canSendTests}
      sendTestBlockedReason={sendTestBlockedReason}
      context={context}
      onToggle={toggleChannel}
      onChange={changeChannel}
      saveBar={canEdit ? { dirty: anyDirty, saving: headerSaving, error: headerError, onSave: () => void saveAll(), onCancel: resetAll } : null}
    />
  );

  const title = selectedItem ? selectedItem.name : showSetup ? "Setups" : "Notifications";

  const overlay = (
    <TooltipProvider delayDuration={200}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Notifications: ${title}`}
        // bg-app-gradient: the app's own wash (v2-theme.css), so this view
        // sits on the same ground as every other screen. The solid base is an
        // inline style ON PURPOSE: tailwind-merge treats `bg-background` and
        // `bg-app-gradient` as the same group and keeps only one, which is how
        // the wash went missing (see (dashboard)/layout.tsx on the same trap).
        className={cn("bg-app-gradient fixed inset-0 z-40 flex h-dvh w-screen flex-col text-foreground", className)}
        style={{ backgroundColor: "hsl(var(--background))" }}
        data-notifications-page=""
      >
        <div className="flex min-h-0 flex-1">
          {/* Left: every notification, and Setups. No Back link or top bar
              (Ghulam, Oct 1 2026): Esc leaves; Save floats over the preview
              only while there is something to save. */}
          <div className="hidden w-[272px] shrink-0 flex-col md:flex">
            <NotificationsList className="min-h-0 flex-1" />
          </div>

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {storageOff && (
              <p role="note" data-notifications-notice="storage-off" className="border-b px-6 py-2 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{COPY.storageOff}</span> {COPY.storageOffDetail}
                {canEdit && dirty && (
                  <span className="text-amber-700 dark:text-amber-400" data-notifications-unsavable="">
                    {" "}
                    {COPY.storageOffEdits}
                  </span>
                )}
              </p>
            )}
            {/* Phones: the list is hidden, so Back and the choice live here. */}
            <div className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
              <Link href="/settings" aria-label="Back to settings" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Link>
              <div className="min-w-0 flex-1">
                <MobilePicker selected={selected} onSelect={select} />
              </div>
            </div>

            {showSetup ? (
              // A column, so a short setup still puts the save bar at the bottom.
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                {/* One setup at a time, chosen from the Setups menu in the list. All
                    four stay mounted so an unsaved sender edit survives a switch. */}
                <div
                  // End to end, with a hairline between every row (Ghulam, Oct 1
                  // 2026), scoped here: the email sender's rows and the push
                  // setup's steps. Shared settings components are untouched.
                  className={cn(
                    // pt-3: level with the search box at the top of the list.
                    "w-full flex-1 px-8 pb-6 pt-3",
                    "[&_ol[aria-label='Push_setup_steps']>li+li]:border-t [&_ol[aria-label='Push_setup_steps']>li+li]:border-border/70",
                  )}
                >
                  <div className={cn(setupSection !== "email" && "hidden")} id={settingsSectionId(NOTIFICATIONS_EMAIL_ANCHOR)}>
                    <EmailSenderSettingsV2 canEdit={canEdit} registerSave={registerLocal} />
                  </div>
                  <div className={cn(setupSection !== "push" && "hidden")} id={settingsSectionId(NOTIFICATIONS_PUSH_ANCHOR)}>
                    <PushSetupV2 canEdit={canEdit} onSendTest={sendPushSetupTest} />
                    {/* How to install the portal and allow push, per device, with pictures. */}
                    <PushInstallGuide
                      // No gap when it is the first thing (push setup renders nothing).
                      className="mt-10 first:mt-0"
                      portalHost={`${slug ?? tenant?.slug ?? "your-company"}.portal.drive-247.com`}
                      appName={companyName || "Your company"}
                      iconUrl={context.iconUrl}
                    />
                  </div>
                </div>
                {/* Bottom of the setup: Back to Settings on the left, the settings
                    pages' own save bar (settings-kit) on the right, both floating
                    at the foot of the view (Ghulam, Oct 1 2026). */}
                <div className="pointer-events-none sticky bottom-4 z-30 flex items-end justify-between gap-3 px-8 pb-1 pt-2">
                  <Link
                    href="/settings"
                    className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-[13px] font-medium text-foreground shadow-lg transition-colors duration-200 ease-out hover:bg-muted motion-reduce:transition-none"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back to settings
                  </Link>
                  {canEdit && (
                    <SettingsStickySaveBar
                      className="static pt-0"
                      dirty={anyDirty}
                      saving={headerSaving}
                      error={headerErrorObject}
                      onSave={() => void saveAll()}
                      onReset={resetAll}
                    />
                  )}
                </div>
              </div>
            ) : !loaded ? (
              <div className="p-6">
                <SettingsSectionSkeleton variant="form" rows={6} label={COPY.loading} surface="settings" />
              </div>
            ) : readFailed ? (
              <div className="p-6">
                <SettingsLoadError
                  thing={COPY.loadThing}
                  error={settings.error}
                  onRetry={() => settings.refetch()}
                  retrying={settings.isFetching}
                />
              </div>
            ) : (
              <>
                {settings.error && (
                  <div className="px-6 pt-4">
                    <SettingsLoadError
                      variant="inline"
                      thing={COPY.loadThing}
                      error={settings.error}
                      onRetry={() => settings.refetch()}
                      retrying={settings.isFetching}
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
                  {selectedItem ? renderItem(selectedItem) : null}
                </div>
              </>
            )}
            {/* Save floats over the preview, only while there is something
                to save (or it is saving, or it failed). */}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );

  // Portalled to <body>: a fixed layer inside the settings column would be
  // trapped by any transformed ancestor, and must sit over the app's chrome.
  return portalTarget ? createPortal(overlay, portalTarget) : null;
}

/* -------------------------------------------------------------------------- */
/* One notification: the preview in the main view, Trax on the right            */
/* -------------------------------------------------------------------------- */

type MessageKind = "app" | "email";

/**
 * Oct 1 2026 (Ghulam's screenshot): the PREVIEW is the main view, and the right
 * rail is Trax, who does the writing. "Edit manually" in the rail swaps Trax
 * for the plain fields; Trax is the default.
 *
 * Two messages, picked by the tabs over the preview:
 *   App message  ONE title + message for both phone push and the bell (they
 *                carry the same words and differ only in where they land).
 *                Push is the source when the item has it — its limits are the
 *                stricter — and every edit is mirrored into the bell's
 *                template. Each keeps its own switch.
 *   Email        subject + body.
 */
function NotificationWorkspace({
  item,
  edits,
  canEdit,
  canSendTests,
  sendTestBlockedReason,
  context,
  onToggle,
  onChange,
  saveBar,
}: {
  item: NotificationItem;
  edits: Partial<Record<NotificationChannel, ChannelEdit>>;
  canEdit: boolean;
  canSendTests: boolean;
  sendTestBlockedReason: string | null;
  context: NotificationPreviewContext;
  onToggle: (key: string, channel: NotificationChannel, enabled: boolean) => void;
  onChange: (item: NotificationItem, channel: NotificationChannel, next: ChannelEdit) => void;
  /** The view's Save and Cancel, shown at the top of the Trax panel; null for view-only users. */
  saveBar: { dirty: boolean; saving: boolean; error: string | null; onSave: () => void; onCancel: () => void } | null;
}) {
  const appChannels = itemChannels(item).filter((c): c is "push" | "in_app" => c !== "email");
  const appSource = appChannels[0] ?? null;
  const appEdit = appSource ? edits[appSource] ?? null : null;
  const appWording = appEdit ? (appEdit.template as { title: string; body: string }) : null;
  const emailEdit = edits.email ?? null;

  // Picked in the left list, nested under this notification (notifications-rail).
  const picked = useNotificationsSelection((st) => st.message);
  const message: MessageKind = picked === "email" ? (emailEdit ? "email" : "app") : appSource ? "app" : "email";
  // The Gmail preview's Desktop / Phone switch, drawn in the top row.
  // Light or dark, for the email and both phones.
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("light");

  const shared = { item, canEdit, canSendTests, sendTestBlockedReason, context };

  const changeApp = (next: ChannelEdit) => {
    if (!appSource) return;
    onChange(item, appSource, next);
    const t = next.template as { title: string; body: string };
    for (const other of appChannels) {
      if (other === appSource) continue;
      onChange(item, other, { ...edits[other]!, template: { title: t.title, body: t.body } });
    }
  };
  const changeEmail = (next: ChannelEdit) => onChange(item, "email", next);

  // The message on screen: its channel views, its switches, its Trax wording.
  const active =
    message === "app" && appSource && appEdit
      ? {
          channel: appSource as NotificationChannel,
          edit: appEdit,
          change: changeApp,
          /* ONE switch for the App message (Ghulam, Oct 1 2026): on means
             it goes out as a push AND lands in the bell. The bell is the
             safety net for anyone without push turned on. It reads "on"
             when any of them is on, and turning it sets them all. */
          switches: [
            {
              channel: appSource as NotificationChannel,
              also: appChannels.filter((c) => c !== appSource) as NotificationChannel[],
              label: "App message",
              enabled: appChannels.some((c) => edits[c]!.enabled),
            },
          ],
        }
      : emailEdit
        ? {
            channel: "email" as NotificationChannel,
            edit: emailEdit,
            change: changeEmail,
            switches: [{ channel: "email" as NotificationChannel, also: [] as NotificationChannel[], label: "Email", enabled: emailEdit.enabled }],
          }
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-notification-item={item.key}>
        {/* MAIN: which message, its switches and Send test, then the preview. */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-notification-main="" aria-label={`${item.name}: preview`}>
          {/* No top row (Ghulam, Oct 1 2026): its switches and Send test live in
              the row under the preview. The left list shows which message is open. */}
          <h2 className="sr-only">{message === "app" ? "App message" : "Email"}</h2>

          {active ? (
            <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-2 pt-1.5">
              {/* Always whole on screen: the preview shrinks to fit, never scrolls. */}
              {message === "app" && appWording ? (
                <FitToBox grow>
                  <AppMessagePhones
                    item={item}
                    wording={appWording}
                    edit={
                      canEdit && appEdit
                        ? {
                            onTitle: (text) =>
                              changeApp({ ...appEdit, template: { title: unfillVariables(text, item.variables, context.examples), body: appWording.body } }),
                            onBody: (text) =>
                              changeApp({ ...appEdit, template: { title: appWording.title, body: unfillVariables(text, item.variables, context.examples) } }),
                          }
                        : undefined
                    }
                    context={context}
                    dark={previewTheme === "dark"}
                  />
                </FitToBox>
              ) : (
                <EmailPair
                  theme={previewTheme}
                  onEditSubject={
                    canEdit && emailEdit
                      ? (text) => {
                          const t = emailEdit.template as { subject: string; body: string };
                          changeEmail({ ...emailEdit, template: { ...t, subject: unfillVariables(text, item.variables, context.examples) } });
                        }
                      : undefined
                  }
                  onEditBody={
                    canEdit && emailEdit
                      ? (cellHtml) => {
                          const t = emailEdit.template as { subject: string; body: string };
                          const body = emailBodyFromPreview(cellHtml, item.variables, context.examples);
                          if (body && body !== t.body) changeEmail({ ...emailEdit, template: { ...t, body } });
                        }
                      : undefined
                  }
                  render={() => (
                    <NotificationChannelView slot="preview" channel="email" edit={emailEdit!} onChange={changeEmail} {...shared} />
                  )}
                />
              )}
              {/* The preview's own controls, under it where its caption was. */}
              <div className="flex shrink-0 flex-wrap items-center gap-3 px-1.5 pt-2" data-preview-controls="">
                {/* Order (Ghulam, Oct 1 2026): On | Off, Light / Dark, Send test. */}
                {/* On | Off in words, beside Send test (Ghulam, Oct 1 2026). One per
                    message; App message's turns its push and its bell together. */}
                {active.switches.map((s) => (
                  <div key={s.channel} className="flex items-center gap-2" data-channel-switch={s.channel}>
                    <PreviewSwitch
                      label={`${s.label} for ${item.name}`}
                      value={s.enabled ? "on" : "off"}
                      options={ON_OFF_OPTIONS}
                      className="p-[3px] [&>button]:h-6 [&>button]:px-3"
                      onChange={(v) => {
                        if (!canEdit) return;
                        const checked = v === "on";
                        onToggle(item.key, s.channel, checked);
                        for (const other of s.also) onToggle(item.key, other, checked);
                      }}
                    />
                    {[s.channel, ...s.also].every((c) => isNotSentYet(item, c)) && (
                      <span title={notSentYetCopy(s.channel)} className="text-[11px] text-muted-foreground" data-channel-not-sent={s.channel}>
                        {COPY.notSentYet}
                      </span>
                    )}
                  </div>
                ))}
                <PreviewSwitch iconOnly className="p-[3px]" label="Preview theme" value={previewTheme} options={THEME_OPTIONS} onChange={setPreviewTheme} />
                {/* Send test sits with the preview's own controls (Ghulam, Oct 1 2026). */}
                <NotificationChannelView slot="test" channel={active.channel} edit={active.edit} onChange={active.change} {...shared} />
                <div className="ml-auto flex flex-wrap items-center gap-4 pr-3">
                  {saveBar?.error && (
                    <span role="alert" className="max-w-[220px] truncate text-xs text-destructive" title={saveBar.error}>
                      Not saved. {saveBar.error}
                    </span>
                  )}
                  {/* Cancel | Save as one grouped control, icons only, split by a
                      hairline (Ghulam, Oct 1 2026). Both wait for an edit. */}
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
                        aria-label={saveBar.saving ? "Saving" : "Save changes"}
                        title={saveBar.saving ? "Saving…" : "Save changes"}
                        onClick={saveBar.onSave}
                        disabled={!saveBar.dirty || saveBar.saving}
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
            <p className="px-6 py-5 text-[13px] text-muted-foreground">{notApplicableCopy(item, "email")}</p>
          )}
        </section>

        {/* RIGHT RAIL: Trax only (Ghulam, Oct 1 2026). Trax handles the
            variables; anyone who wants to change a word types straight into
            the preview instead, so there is no Manual tab and no field of
            {{variables}} for an operator to get wrong. */}
        <aside
          aria-label={`${item.name}: Trax`}
          className="flex h-[70vh] min-h-0 min-w-0 flex-col border-t lg:h-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-t-0"
          data-notification-rail=""
        >
          {/* Both Trax conversations stay mounted, so switching message tabs
              keeps each one's history. */}
          {appSource && appEdit && appWording && (
            <TraxNotificationChat
              kind="app"
              view={{ preview: "the app message as a push notification on an iPhone lock screen and an Android lock screen, side by side", theme: previewTheme, company: context.appName }}
              item={item}
              canEdit={canEdit}
              wording={appWording}
              onApply={(next) => changeApp({ ...appEdit, template: { title: next.title ?? "", body: next.body } })}
              className={cn("flex-1", message !== "app" && "hidden")}
            />
          )}
          {emailEdit && (
            <TraxNotificationChat
              kind="email"
              view={{ preview: "the email in Gmail, desktop and phone side by side", theme: previewTheme, company: context.appName }}
              item={item}
              canEdit={canEdit}
              wording={emailEdit.template as { subject: string; body: string }}
              onApply={(next) => changeEmail({ ...emailEdit, template: { subject: next.subject ?? "", body: next.body } })}
              className={cn("flex-1", message !== "email" && "hidden")}
            />
          )}

        </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Fit to the box: the whole preview on screen at once                         */
/* -------------------------------------------------------------------------- */

const ON_OFF_OPTIONS: readonly PreviewSwitchOption<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const THEME_OPTIONS: readonly PreviewSwitchOption<"light" | "dark">[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * Scales its content down (never up) so all of it fits the space it is given,
 * width and height. The content is laid out at full width first, so a preview
 * that already fits its width (Gmail's FitToWidth) only shrinks further when it
 * is too tall. `offsetHeight` ignores the transform, so the measure is stable.
 */
function FitToBox({
  children,
  onMeasure,
  grow = false,
}: {
  children: ReactNode;
  /**
   * Also scale UP (to 1.8×) and centre in both directions, for content that is
   * smaller than its box (the App message phones). Laid out at its own width.
   */
  grow?: boolean;
  /** Every measure: the content's height at full width, and the room it has. */
  onMeasure?: (contentHeight: number, boxHeight: number) => void;
}) {
  const measureRef = useRef(onMeasure);
  measureRef.current = onMeasure;
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return;
    const fit = () => {
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
      measureRef.current?.(h, room);
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
        className={cn("absolute left-1/2 top-0 origin-top", grow ? "w-max" : "w-full")}
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
 * Both Gmails at the box's full height, side by side, with no space left over
 * (Ghulam, Oct 1 2026). Each is laid out at its natural width and scaled:
 *   phone    to the box's height, so it takes the width that needs (at most
 *            40% of the box);
 *   desktop  to the same height, and laid out wider (`widen`) until that
 *            scaled width is exactly what the phone leaves. The email inside
 *            keeps its real width, so only Gmail's own grey grows.
 * `offsetHeight` ignores transforms, so the measures are the natural sizes.
 */
function EmailPair({
  theme,
  render,
  onEditSubject,
  onEditBody,
}: {
  theme: "light" | "dark";
  render: () => ReactNode;
  onEditSubject?: (text: string) => void;
  onEditBody?: (cellHtml: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ W: 0, H: 0, hd: 0, hp: 0 });

  useEffect(() => {
    const els = [box.current, desk.current, phone.current];
    if (els.some((e) => !e) || typeof ResizeObserver === "undefined") return;
    const read = () =>
      setM((prev) => {
        const next = {
          W: box.current!.clientWidth,
          H: box.current!.clientHeight,
          hd: desk.current!.offsetHeight,
          hp: phone.current!.offsetHeight,
        };
        return prev.W === next.W && prev.H === next.H && prev.hd === next.hd && prev.hp === next.hp ? prev : next;
      });
    const observer = new ResizeObserver(read);
    for (const el of els) observer.observe(el!);
    read();
    return () => observer.disconnect();
  }, []);

  const PW = GMAIL_PREVIEW_VIEWS.phone.mockupWidth;
  const DW = GMAIL_PREVIEW_VIEWS.desktop.mockupWidth;
  const ready = m.W > 0 && m.H > 0 && m.hd > 0 && m.hp > 0;
  const sp = ready ? Math.min(m.H / m.hp, (m.W * 0.4) / PW) : 0;
  const wp = PW * sp;
  const wd = Math.max(0, m.W - PAIR_GAP - wp);
  // Desktop always takes the FULL height, and its laid-out width follows from
  // that: wd / scale. Solved each render (not stepped toward), so its bottom
  // stays level with the phone's. When that width is under Gmail's usual
  // desktop width the window is laid out narrower (down to MIN_WIDEN, a narrow
  // desktop window); the email inside reflows as it does in the phone view.
  const MIN_WIDEN = 0.65;
  const sdByHeight = ready ? m.H / m.hd : 0;
  const widen = sdByHeight > 0 ? Math.min(6, Math.max(MIN_WIDEN, wd / sdByHeight / DW)) : 1;
  const sd = !ready ? 0 : Math.min(sdByHeight, wd / (DW * widen));

  const desktopView = useMemo(
    () => ({ view: "desktop" as GmailPreviewView, theme, widen, onEditSubject, onEditBody }),
    [theme, widen, onEditSubject, onEditBody],
  );
  const phoneView = useMemo(
    () => ({ view: "phone" as GmailPreviewView, theme, onEditSubject, onEditBody }),
    [theme, onEditSubject, onEditBody],
  );

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" data-email-previews="">
      <div
        ref={desk}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: DW * widen, transform: `scale(${sd})`, visibility: ready ? "visible" : "hidden" }}
      >
        <GmailViewContext.Provider value={desktopView}>{render()}</GmailViewContext.Provider>
      </div>
      <div
        ref={phone}
        className="absolute right-0 top-0 origin-top-right"
        style={{ width: PW, transform: `scale(${sp})`, visibility: ready ? "visible" : "hidden" }}
      >
        <GmailViewContext.Provider value={phoneView}>{render()}</GmailViewContext.Provider>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The App message on two whole phones                                         */
/* -------------------------------------------------------------------------- */

function AppMessagePhones({
  item,
  wording,
  context,
  dark = false,
  edit,
}: {
  item: NotificationItem;
  wording: { title: string; body: string };
  /** Edit in place on the phones; absent for view-only users. */
  edit?: PhoneEdit;
  context: NotificationPreviewContext;
  dark?: boolean;
}) {
  const title = fillVariables(wording.title, context.examples);
  const body = fillVariables(wording.body, context.examples);
  // iPhone and Android, both showing the push (Ghulam, Oct 1 2026). The same
  // words land in the bell too; push and bell are one App message now.
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-center gap-6">
        <LockScreenPhone title={title} body={body} appName={context.appName} iconUrl={context.iconUrl} dark={dark} edit={edit} />
        <AndroidLockScreenPhone title={title} body={body} appName={context.appName} iconUrl={context.iconUrl} dark={dark} edit={edit} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phones: the rail's choice as a select                                       */
/* -------------------------------------------------------------------------- */

function MobilePicker({ selected, onSelect }: { selected: string | null; onSelect: (key: string, side?: NotificationDirection) => void }) {
  return (
    <label className="block md:hidden">
      <span className="sr-only">Choose a notification</span>
      <select
        value={selected ?? ""}
        onChange={(e) => {
          const item = getNotificationItem(e.target.value);
          onSelect(e.target.value, item?.direction);
        }}
        className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
      >
        <option value={NOTIFICATIONS_SETUP}>Setups</option>
        {NOTIFICATION_DIRECTION_GROUPS.map((group) =>
          categoryGroups(group.direction).map(({ category, items }) => (
            <optgroup key={`${group.direction}-${category.id}`} label={`${group.title} · ${category.label}`}>
              {items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          )),
        )}
      </select>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* In-app: nothing to set up, just where the two bells are                     */
/* -------------------------------------------------------------------------- */

function InAppExplainer() {
  return (
    // Not built from `SettingsPanel`, but it must read as one: the same
    // flush surface and the same title block, so its two rows line up with
    // the email sender's above it (settings-kit.tsx).
    <section data-settings-section="in-app" className={SETTINGS_PANEL_FLUSH} aria-labelledby="notifications-in-app-title">
      <div className="pb-2">
        <h2 id="notifications-in-app-title" className={SETTINGS_SECTION_TITLE}>
          {COPY.inAppTitle}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{COPY.inAppDescription}</p>
      </div>
      <SettingsRowAlignProvider align="end">
        <div data-settings-rows="">
          <SettingsRow label="Your team" description={COPY.inAppTeam} />
          <SettingsRow label="Customers" description={COPY.inAppCustomer} />
        </div>
      </SettingsRowAlignProvider>
    </section>
  );
}
