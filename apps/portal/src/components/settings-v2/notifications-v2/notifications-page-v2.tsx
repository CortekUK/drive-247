"use client";

/**
 * v2 Settings › Notifications (`?tab=notifications`, northwind canary): one
 * page for every email, push and in-app message the platform sends (build-spec
 * D7–D18; transcript §3, "one single page where the operator maintains all of
 * it, organised in sections").
 *
 * Top to bottom:
 *   1. One honest line (D18): what is saved here is kept and used by the
 *      previews and Send test; live sending does not switch over yet. While the
 *      storage SQL is not applied (`tableMissing`) it says instead that saving
 *      turns on later: nothing registers a save that would fail.
 *   2. Channels: Email (sender, reply-to, team alerts; EmailSenderSettingsV2,
 *      which registers its own "email-sender" save), Push on this device
 *      (PushSetupV2), and In-app (the two bells, explained). `?tab=reminders`
 *      and `?tab=push` land on the first two (settings-shell-state
 *      V2_NOTIFICATIONS_SECTIONS).
 *   3. Two direction groups, "Customer → Your team" and "Your team →
 *      Customer", each split into the catalog's categories. Every item is one
 *      row: its name, a tooltip, the direction in the lead's words, a plain
 *      "when · where · who" line, and a switch per channel (a dash where the
 *      notification has no such channel).
 *   4. Opening a row (one at a time) shows NotificationItemPanel under it: a
 *      tab per channel with the editor, the preview and Send test.
 *   5. What's sent today: the live settings that still decide what goes out
 *      until sending switches over (D18): the team email categories, and the
 *      settings page's in-app payment reminders and reminder rules
 *      (`todaySettings`). They were on the Team emails page, which
 *      `?tab=reminders` now opens this page for, and save as they always did.
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
 * WEIGHT. The settings page loads this file on demand; the editor inside a
 * panel is loaded on demand again. Rows are memoised, and only the open item's
 * panel is mounted.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui-v2/badge";
import { Switch } from "@/components/ui-v2/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useTenant } from "@/contexts/TenantContext";
import { useEmailBrandingV2 } from "@/hooks/use-email-branding-v2";
import { useEmailNotificationPrefs } from "@/hooks/use-email-notification-prefs";
import { useEmailSenderV2 } from "@/hooks/use-email-sender-v2";
import { useNotificationSettingsV2 } from "@/hooks/use-notification-settings-v2";
import { useNotificationTestV2 } from "@/hooks/use-notification-test-v2";
import { getNotificationItem } from "@/lib/notifications-v2/catalog";
import { senderAddress, settingKey, type ChannelEdit } from "@/lib/notifications-v2/settings-model";
import { NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationItem } from "@/lib/notifications-v2/types";
import { exampleValues } from "@/lib/notifications-v2/variables";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth-store";
import { useRegisterLeaveSave } from "../business-section-save";
import type { RegisterSectionSave } from "../pricing-money-parts";
import { EmailNotificationSettingsV2 } from "../notification-states-v2";
import { SettingsLoadError, SettingsSectionSkeleton, useWarnOnUnsavedChanges } from "../section-states";
import { SETTINGS_PANEL_FLUSH, SETTINGS_SECTION_TITLE, SettingsRow, SettingsRowAlignProvider, SettingsSection } from "../settings-kit";
import { settingsSectionId } from "../settings-shell-state";
import { EmailSenderSettingsV2 } from "./email-sender-settings-v2";
import { NotificationItemPanel, type NotificationPreviewContext } from "./notification-item-panel";
import {
  CHANNEL_LABELS,
  NOTIFICATIONS_CHANNELS_ANCHOR,
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
  isCustomised,
  isNotSentYet,
  isTeamActionItem,
  itemChannels,
  itemMetaLine,
  notApplicableCopy,
  notSentYetCopy,
  pageDiff,
  pendingItemKeys,
  pushSetupTestRequest,
  pushSetupTestResponse,
  storedEdit,
  type ChannelDrafts,
  type NotificationDirectionGroup,
} from "./notifications-page-model";
import { PUSH_SETUP_TEST_MESSAGE, PushSetupV2 } from "./push-setup-v2";

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
   * `?tab=push`). The settings page scrolls to it too, but gives up after a
   * few frames, and this page arrives in its own chunk: so it scrolls there
   * itself once, when it first renders.
   */
  scrollTarget?: string | null;
  className?: string;
}

/** DOM ids a row's button and its panel share (aria-controls / focus return). */
export const notificationPanelId = (key: string) => `notification-panel-${key}`;
export const notificationToggleId = (key: string) => `notification-toggle-${key}`;

/** A category heading: explicit size, as every v2 heading needs (the theme's h3 default is 24px). */
const CATEGORY_TITLE = "font-heading text-sm font-semibold tracking-tight text-foreground";

type OpenItem = { key: string; channel?: NotificationChannel } | null;

/** One row's switches: true / false, or null where the item has no such channel. */
interface RowState {
  email: boolean | null;
  push: boolean | null;
  in_app: boolean | null;
  edited: boolean;
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
  const [open, setOpen] = useState<OpenItem>(null);

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

  /* ------------------------------- Saving -------------------------------- */

  const save = async () => {
    if (!tenantId) throw new Error("Your account details haven't loaded yet. Try again in a moment.");
    const problem = firstDraftProblem(rows, drafts, tenantId);
    if (problem) {
      setOpen({ key: problem.item.key, channel: problem.channel });
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

  useRegisterLeaveSave(canEdit ? registerSave : undefined, NOTIFICATIONS_SAVE_KEY, dirty && canSave, save, discard);

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
    // The whiteboard (transcript 10:09, 10:58): switching a channel ON opens
    // the box, at THAT channel — the operator has just said they want this
    // message sent, and the next question is what it says. Switching one off
    // leaves whatever is open alone: nothing new is being set up, and closing
    // the editor under the operator's hands would lose their place.
    if (enabled) setOpen({ key, channel });
  }, []);

  const changeChannel = useCallback((item: NotificationItem, channel: NotificationChannel, next: ChannelEdit) => {
    setDrafts((prev) => ({ ...prev, [settingKey(item.key, channel)]: next }));
  }, []);

  /* ------------------------------ Open / close ---------------------------- */

  const toggleOpen = useCallback((key: string) => {
    setOpen((current) => (current?.key === key ? null : { key }));
  }, []);

  const closePanel = useCallback((key: string) => {
    setOpen(null);
    // Focus goes back to the row that opened it, never to the top of the page.
    requestAnimationFrame(() => document.getElementById(notificationToggleId(key))?.focus());
  }, []);

  // A panel opening low on the screen brings its row up, so the editor is in view.
  const openKey = open?.key ?? null;
  useEffect(() => {
    if (!openKey) return;
    const frame = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-notification-item="${openKey}"]`);
      if (!row || typeof window === "undefined") return;
      const top = row.getBoundingClientRect().top;
      if (top < 64 || top > window.innerHeight * 0.6) row.scrollIntoView?.({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [openKey]);

  /* ---------------------------- Row states -------------------------------- */

  const rowStates = useMemo(() => {
    const out = new Map<string, RowState>();
    for (const group of NOTIFICATION_DIRECTION_GROUPS) {
      for (const { items } of categoryGroups(group.direction)) {
        for (const item of items) {
          const state: RowState = { email: null, push: null, in_app: null, edited: false };
          for (const channel of itemChannels(item)) {
            const edit = currentEdit(item, channel, rowsByKey, drafts);
            state[channel] = edit.enabled;
            if (isCustomised(item, channel, edit)) state.edited = true;
          }
          out.set(item.key, state);
        }
      }
    }
    return out;
  }, [rowsByKey, drafts]);

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
      iconUrl: brand.logoUrl ?? null,
    }),
    [brand, examples, sender.name, sender.address, teamRecipient, defaultTestEmail, companyName],
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

  // An old link's section, once, when this page first renders (see `scrollTarget`).
  const initialScrollTarget = useRef(scrollTarget ?? null);
  useEffect(() => {
    const target = initialScrollTarget.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView?.({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ------------------------------- Render --------------------------------- */

  const renderGroup = (group: NotificationDirectionGroup) => (
    <SettingsSection key={group.direction} anchor={group.anchor} title={group.title} description={group.description}>
      <div className="space-y-6" data-notification-direction={group.direction}>
        {categoryGroups(group.direction).map(({ category, items }) => {
          const headingId = `notifications-${group.direction}-${category.id}`;
          return (
            <section key={category.id} aria-labelledby={headingId} data-notification-category={category.id} className="space-y-3">
              <div>
                <h3 id={headingId} className={CATEGORY_TITLE}>
                  {category.label}
                </h3>
                <p className="text-[13px] text-muted-foreground">{category.description}</p>
              </div>
              <div className="rounded-xl border bg-card">
                <div
                  aria-hidden="true"
                  className="hidden items-center justify-end gap-2 border-b px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:flex"
                >
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <span key={channel} className="w-[4.5rem] text-center">
                      {CHANNEL_LABELS[channel]}
                    </span>
                  ))}
                </div>
                <div className="divide-y">
                  {items.map((item) => {
                    const state = rowStates.get(item.key);
                    const isOpen = openKey === item.key;
                    return (
                      <div key={item.key} data-notification-item={item.key} className="scroll-mt-24">
                        <NotificationItemRow
                          item={item}
                          chip={group.chip}
                          emailOn={state?.email ?? null}
                          pushOn={state?.push ?? null}
                          inAppOn={state?.in_app ?? null}
                          edited={!!state?.edited}
                          teamAction={isTeamActionItem(item)}
                          pending={pending.has(item.key)}
                          open={isOpen}
                          canEdit={canEdit}
                          onToggleOpen={toggleOpen}
                          onToggleChannel={toggleChannel}
                        />
                        {isOpen && (
                          <NotificationItemPanel
                            key={`${item.key}:${open?.channel ?? ""}`}
                            id={notificationPanelId(item.key)}
                            item={item}
                            edits={Object.fromEntries(
                              itemChannels(item).map((channel) => [channel, currentEdit(item, channel, rowsByKey, drafts)]),
                            )}
                            initialChannel={open?.channel}
                            onChange={(channel, next) => changeChannel(item, channel, next)}
                            onClose={() => closePanel(item.key)}
                            canEdit={canEdit}
                            canSendTests={canSendTests}
                            sendTestBlockedReason={sendTestBlockedReason}
                            context={context}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </SettingsSection>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-10", className)} data-notifications-page="">
        <div
          role="note"
          data-notifications-notice={storageOff ? "storage-off" : "sending-unchanged"}
          className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {storageOff ? (
            <p>
              <span className="font-medium text-foreground">{COPY.storageOff}</span> {COPY.storageOffDetail}
              {canEdit && dirty && (
                <span className="text-amber-700 dark:text-amber-400" data-notifications-unsavable="">
                  {" "}
                  {COPY.storageOffEdits}
                </span>
              )}
            </p>
          ) : (
            <p>{COPY.notice}</p>
          )}
        </div>

        <SettingsSection anchor={NOTIFICATIONS_CHANNELS_ANCHOR} title={COPY.channelsTitle} description={COPY.channelsDescription}>
          {/* space-y-8, not the 4 these three panels had as cards: with no
              border between them, 16px put a panel's TITLE as close to the row
              above it as two rows of the same panel are to each other. */}
          <div className="space-y-8">
            <div id={settingsSectionId(NOTIFICATIONS_EMAIL_ANCHOR)} className="scroll-mt-24">
              <EmailSenderSettingsV2 canEdit={canEdit} registerSave={registerSave} />
            </div>
            <div id={settingsSectionId(NOTIFICATIONS_PUSH_ANCHOR)} className="scroll-mt-24">
              <PushSetupV2 canEdit={canEdit} onSendTest={sendPushSetupTest} />
            </div>
            <InAppExplainer />
          </div>
        </SettingsSection>

        {!loaded ? (
          <SettingsSectionSkeleton variant="table" rows={6} columns={4} header label={COPY.loading} surface="settings" />
        ) : readFailed ? (
          <SettingsLoadError
            thing={COPY.loadThing}
            error={settings.error}
            onRetry={() => settings.refetch()}
            retrying={settings.isFetching}
          />
        ) : (
          <>
            {settings.error && (
              <SettingsLoadError
                variant="inline"
                thing={COPY.loadThing}
                error={settings.error}
                onRetry={() => settings.refetch()}
                retrying={settings.isFetching}
              />
            )}
            {NOTIFICATION_DIRECTION_GROUPS.map(renderGroup)}
          </>
        )}

        {/* D18: until sending switches over, the switches above change nothing
            live. These still do, so they stay reachable here (they were on the
            Team emails page, which `?tab=reminders` now opens this page for). */}
        <SettingsSection anchor={NOTIFICATIONS_TODAY_ANCHOR} title={COPY.todayTitle} description={COPY.todayDescription}>
          {/* One step tighter than the page's own gap between sections
              (space-y-10), as the direction groups are: what is inside a
              section must not be spaced like the sections themselves. */}
          <div className="space-y-6">
            <EmailNotificationSettingsV2 canEdit={canEdit} parts="categories" />
            {todaySettings}
          </div>
        </SettingsSection>
      </div>
    </TooltipProvider>
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
        {/* The kit's panel-title recipe, not a copy of it: the Email card and
            Push on this device beside it use the same constant. */}
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

/* -------------------------------------------------------------------------- */
/* One notification's row                                                      */
/* -------------------------------------------------------------------------- */

interface NotificationItemRowProps {
  item: NotificationItem;
  chip: string;
  emailOn: boolean | null;
  pushOn: boolean | null;
  inAppOn: boolean | null;
  edited: boolean;
  /** A heads-up about your team's own action (TEAM_ACTION_ITEM_KEYS). */
  teamAction: boolean;
  pending: boolean;
  open: boolean;
  canEdit: boolean;
  onToggleOpen: (key: string) => void;
  onToggleChannel: (key: string, channel: NotificationChannel, enabled: boolean) => void;
}

/** Memoised on primitives: typing in one panel re-renders the page, not forty rows. */
const NotificationItemRow = memo(function NotificationItemRow({
  item,
  chip,
  emailOn,
  pushOn,
  inAppOn,
  edited,
  teamAction,
  pending,
  open,
  canEdit,
  onToggleOpen,
  onToggleChannel,
}: NotificationItemRowProps) {
  const values: Record<NotificationChannel, boolean | null> = { email: emailOn, push: pushOn, in_app: inAppOn };
  return (
    <div className="flex flex-col gap-3 px-5 py-3.5 md:flex-row md:items-center md:gap-6">
      {/* The name is the button; its ::after stretches the click target over
          the whole text block, and the info button sits above that layer. */}
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            id={notificationToggleId(item.key)}
            aria-expanded={open}
            aria-controls={open ? notificationPanelId(item.key) : undefined}
            onClick={() => onToggleOpen(item.key)}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
            />
            <span className="[overflow-wrap:anywhere]">{item.name}</span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${item.name}`}
                className="relative z-10 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {item.tooltip}
            </TooltipContent>
          </Tooltip>
          {/* Every pill on a row is the kit's Badge, so the direction chip,
              Team action and Edited share one box: hand-rolled 11px pills sat
              ~5px shorter than the Badge beside them. Colour and weight, not
              geometry, tell them apart. */}
          <Badge variant="outline" data-direction-chip="" className="font-normal text-muted-foreground">
            {chip}
          </Badge>
          {teamAction && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Hover shows why; a screen reader reads it inline. */}
                <Badge variant="secondary" data-team-action="" className="relative z-10 font-normal text-muted-foreground">
                  {COPY.teamAction}
                  <span className="sr-only">. {COPY.teamActionTooltip}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {COPY.teamActionTooltip}
              </TooltipContent>
            </Tooltip>
          )}
          {edited && (
            <Badge variant="secondary" data-edited-badge="">
              {COPY.edited}
            </Badge>
          )}
          {pending && (
            <span data-unsaved-marker="" className="text-xs text-amber-700 dark:text-amber-400">
              {COPY.unsaved}
            </span>
          )}
        </div>
        <p className="mt-0.5 pl-[22px] text-[13px] leading-snug text-muted-foreground">{itemMetaLine(item)}</p>
      </div>

      {/* The three switches, at the end of the row and in one column per
          channel (the header above the card names them). Cells are aligned to
          the TOP, not centred: a cell carrying the "Not sent yet" marker is
          taller than a bare one, and centring pushed its switch ~6px above the
          switches beside it, so no two rows read as a column. */}
      <div
        data-channel-cells=""
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pl-[22px] md:items-start md:gap-2 md:pl-0"
      >
        {NOTIFICATION_CHANNELS.map((channel) => (
          <ChannelCell
            key={channel}
            item={item}
            channel={channel}
            value={values[channel]}
            canEdit={canEdit}
            onToggleChannel={onToggleChannel}
          />
        ))}
      </div>
    </div>
  );
});

function ChannelCell({
  item,
  channel,
  value,
  canEdit,
  onToggleChannel,
}: {
  item: NotificationItem;
  channel: NotificationChannel;
  value: boolean | null;
  canEdit: boolean;
  onToggleChannel: (key: string, channel: NotificationChannel, enabled: boolean) => void;
}) {
  const label = CHANNEL_LABELS[channel];
  return (
    <div
      className="flex items-center gap-1.5 md:w-[4.5rem] md:flex-col md:items-center md:justify-start md:gap-0.5"
      data-channel-cell={channel}
    >
      <span aria-hidden="true" className="text-xs text-muted-foreground md:hidden">
        {label}
      </span>
      {value === null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={`${label}: not available for ${item.name}`}
              data-channel-na=""
              className="inline-flex h-4 w-7 items-center justify-center text-sm text-muted-foreground"
            >
              —
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {notApplicableCopy(item, channel)}
          </TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Switch
            size="sm"
            checked={value}
            disabled={!canEdit}
            aria-label={`${label} for ${item.name}`}
            onCheckedChange={(checked) => onToggleChannel(item.key, channel, checked)}
          />
          {/* D18 on the row: this channel has no sender yet, so the switch is
              saved but changes nothing live. Small and muted — one marker, not
              a banner. The full sentence is `title` (hover) and sr-only (screen
              readers) rather than a Radix tooltip: this fires on most cells of
              most rows, and ~60 more tooltip instances is real weight on a page
              that already mounts one per item and one per dash. */}
          {isNotSentYet(item, channel) && (
            <span
              data-channel-not-sent={channel}
              title={notSentYetCopy(channel)}
              className="whitespace-nowrap text-[11px] leading-none text-muted-foreground"
            >
              {COPY.notSentYet}
              <span className="sr-only">. {notSentYetCopy(channel)}</span>
            </span>
          )}
        </>
      )}
    </div>
  );
}
