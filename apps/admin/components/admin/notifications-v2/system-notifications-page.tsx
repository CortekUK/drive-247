'use client';

/**
 * Notifications v2, SYSTEM set: the super admin dashboard's own Notifications
 * page (`/admin/notifications`).
 *
 * The second set the team lead asked for (transcript 07:30–08:30 and 16:39:
 * "exactly the same thing we'll build for ourselves in the super admin
 * dashboard… you have to build that too"). The operator portal already has the
 * first set, customer ↔ the rental company; this is the platform boundary:
 *
 *   Drive247 → Operators     we do something, the operator is told
 *   Operators → Drive247     an operator does something, we are told
 *   Drive247 → Everyone      a broadcast to operators and their renters
 *
 * The shape mirrors apps/portal/src/components/settings-v2/notifications-v2/
 * notifications-page-v2.tsx — direction groups, then categories, then one row
 * per notification with a tooltip, a plain "when · where · who" line and a
 * switch per channel; clicking a row opens ONE inline panel with a tab per
 * channel, the template on the left, its preview on the right and Send test at
 * the top right. It is drawn on THIS app's UI kit (components/ui/*), not the
 * portal's ui-v2, and reads this app's own catalog and hooks.
 *
 * STATE. Stored rows come from `usePlatformNotificationSettings`. Edits are
 * page state (`ChannelDrafts`) laid over the stored values; one Save bar writes
 * the whole page and then drops only the drafts it wrote.
 *
 * PERMISSIONS. Super admins only. The protected layout already confines a
 * sales-agent account to /admin/sales, and the table's RLS and
 * notification-test-v2 both re-check `is_super_admin` server side — so this
 * page's own check is the third line, not the only one: it makes the page
 * read-only rather than pretending an edit will stick.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronRight,
  Database,
  ExternalLink,
  Info,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePlatformNotificationSettings } from '@/hooks/use-platform-notification-settings';
import { getSystemNotificationItem, type SystemNotificationItem } from '@/lib/notifications-v2/catalog';
import {
  PLATFORM_EMAIL_BRAND,
  senderAddress,
  settingKey,
  type ChannelEdit,
} from '@/lib/notifications-v2/settings-model';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '@/lib/notifications-v2/types';
import { systemExampleValues } from '@/lib/notifications-v2/variables';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { NotificationItemPanel, type SystemPreviewContext } from './notification-item-panel';
import {
  CHANNEL_LABELS,
  SYSTEM_DIRECTION_GROUPS,
  SYSTEM_NOTIFICATIONS_COPY as COPY,
  categoryGroups,
  channelSpec,
  currentEdit,
  diffIsEmpty,
  draftProblemMessage,
  firstDraftProblem,
  indexRows,
  isCustomised,
  isNotSentYet,
  itemChannels,
  itemMetaLine,
  notApplicableCopy,
  notSentYetCopy,
  pageDiff,
  pendingItemKeys,
  storedEdit,
  type ChannelDrafts,
  type SystemNotificationDirectionGroup,
} from './system-notifications-model';

/** DOM ids a row's button and its panel share (aria-controls / focus return). */
export const notificationPanelId = (key: string): string => `system-notification-panel-${key}`;
export const notificationToggleId = (key: string): string => `system-notification-toggle-${key}`;

type OpenItem = { key: string; channel?: NotificationChannel } | null;

/** One row's switches: true / false, or null where the item has no such channel. */
interface RowState {
  email: boolean | null;
  push: boolean | null;
  in_app: boolean | null;
  edited: boolean;
}

export interface SystemNotificationsPageProps {
  className?: string;
}

export function SystemNotificationsPage({ className }: SystemNotificationsPageProps) {
  const { user } = useAuthStore();
  const settings = usePlatformNotificationSettings();

  const [drafts, setDrafts] = useState<ChannelDrafts>({});
  const [open, setOpen] = useState<OpenItem>(null);
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

  /* ------------------------------- Saving -------------------------------- */

  const save = useCallback(async (): Promise<void> => {
    const problem = firstDraftProblem(rows, drafts);
    if (problem) {
      // Open the tab that has to be fixed, so the sentence points somewhere.
      setOpen({ key: problem.item.key, channel: problem.channel });
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
  }, [drafts, rows, settings]);

  const discard = useCallback((): void => {
    setDrafts({});
    setSaveError(null);
  }, []);

  /**
   * Nothing warns on in-app navigation (Next has no blocker we use here), but
   * closing or reloading the tab with unsaved edits asks first.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ------------------------------- Editing ------------------------------- */

  const toggleChannel = useCallback(
    (key: string, channel: NotificationChannel, enabled: boolean) => {
      const item = getSystemNotificationItem(key);
      if (!item || item.managedElsewhere || !channelSpec(item, channel)) return;
      const k = settingKey(key, channel);
      setDrafts((prev) => ({
        ...prev,
        [k]: { ...(prev[k] ?? storedEdit(item, channel, rowsRef.current)), enabled },
      }));
      // The lead's whiteboard (transcript 10:09, 10:58): switching a channel ON
      // opens the box AT that channel — the next question is what it says.
      // Switching one off leaves whatever is open alone.
      if (enabled) setOpen({ key, channel });
    },
    [],
  );

  const changeChannel = useCallback(
    (item: SystemNotificationItem, channel: NotificationChannel, next: ChannelEdit) => {
      setDrafts((prev) => ({ ...prev, [settingKey(item.key, channel)]: next }));
    },
    [],
  );

  /* ---------------------------- Open / close ------------------------------ */

  const toggleOpen = useCallback((key: string) => {
    setOpen((current) => (current?.key === key ? null : { key }));
  }, []);

  const closePanel = useCallback((key: string) => {
    setOpen(null);
    // Focus goes back to the row that opened it, never to the top of the page.
    requestAnimationFrame(() => document.getElementById(notificationToggleId(key))?.focus());
  }, []);

  const openKey = open?.key ?? null;

  /* ---------------------------- Row states -------------------------------- */

  const rowStates = useMemo(() => {
    const out = new Map<string, RowState>();
    for (const group of SYSTEM_DIRECTION_GROUPS) {
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

  const examples = useMemo(() => systemExampleValues(), []);
  const sender = useMemo(() => senderAddress(null), []);
  const context = useMemo<SystemPreviewContext>(
    () => ({
      brand: PLATFORM_EMAIL_BRAND,
      examples,
      fromName: sender.name,
      fromAddress: sender.address,
      defaultTestEmail: user?.email ?? null,
      appName: PLATFORM_EMAIL_BRAND.companyName,
      iconUrl: null,
    }),
    [examples, sender.name, sender.address, user?.email],
  );

  const sendTestBlockedReason = canEdit ? null : COPY.noTestForViewer;

  /* ------------------------------- Render --------------------------------- */

  const renderGroup = (group: SystemNotificationDirectionGroup) => (
    <section
      key={group.direction}
      id={group.anchor}
      aria-labelledby={`${group.anchor}-title`}
      data-notification-direction={group.direction}
      className="scroll-mt-24 space-y-4"
    >
      <div>
        <h2 id={`${group.anchor}-title`} className="text-lg font-semibold text-foreground">
          {group.title}
        </h2>
        <p className="text-sm text-muted-foreground">{group.description}</p>
      </div>

      <div className="space-y-6">
        {categoryGroups(group.direction).map(({ category, items }) => {
          const headingId = `${group.anchor}-${category.id}`;
          return (
            <section
              key={category.id}
              aria-labelledby={headingId}
              data-notification-category={category.id}
              className="space-y-2.5"
            >
              <div>
                <h3 id={headingId} className="text-sm font-semibold text-foreground">
                  {category.label}
                </h3>
                <p className="text-[13px] text-muted-foreground">{category.description}</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div
                  aria-hidden="true"
                  className="hidden items-center justify-end gap-2 border-b border-border px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:flex"
                >
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <span key={channel} className="w-[4.5rem] text-center">
                      {CHANNEL_LABELS[channel]}
                    </span>
                  ))}
                </div>
                <div className="divide-y divide-border">
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
                          pending={pending.has(item.key)}
                          open={isOpen}
                          canEdit={canEdit}
                          onToggleOpen={toggleOpen}
                          onToggleChannel={toggleChannel}
                        />
                        {isOpen &&
                          (item.managedElsewhere ? (
                            <ManagedElsewherePanel item={item} id={notificationPanelId(item.key)} />
                          ) : (
                            <NotificationItemPanel
                              key={`${item.key}:${open?.channel ?? ''}`}
                              id={notificationPanelId(item.key)}
                              item={item}
                              edits={Object.fromEntries(
                                itemChannels(item).map((channel) => [
                                  channel,
                                  currentEdit(item, channel, rowsByKey, drafts),
                                ]),
                              )}
                              initialChannel={open?.channel}
                              onChange={(channel, next) => changeChannel(item, channel, next)}
                              onClose={() => closePanel(item.key)}
                              canEdit={canEdit}
                              canSendTests={canEdit}
                              sendTestBlockedReason={sendTestBlockedReason}
                              context={context}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className={cn('space-y-8 pb-28', className)} data-system-notifications-page="">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{COPY.pageTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{COPY.pageDescription}</p>
      </div>

      {!isSuperAdmin && (
        <div
          role="note"
          data-permission-note=""
          className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 text-[13px] leading-snug">
            <p className="font-medium text-foreground">{COPY.noAccessTitle}</p>
            <p className="text-muted-foreground">{COPY.noAccessBody}</p>
          </div>
        </div>
      )}

      <div
        role="note"
        data-notifications-notice={storageOff ? 'storage-off' : 'sending-unchanged'}
        className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground"
      >
        {storageOff ? (
          <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        )}
        {storageOff ? (
          <p>
            <span className="font-medium text-foreground">{COPY.storageOff}</span> {COPY.storageOffDetail}
            {canEdit && dirty && (
              <span className="text-warning" data-notifications-unsavable="">
                {' '}
                {COPY.storageOffEdits}
              </span>
            )}
          </p>
        ) : (
          <p>{COPY.notice}</p>
        )}
      </div>

      {!loaded ? (
        <div role="status" aria-label={COPY.loading} className="space-y-3" data-notifications-loading="">
          <Skeleton className="h-6 w-56" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : readFailed ? (
        <div
          role="alert"
          data-notifications-load-error=""
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm text-foreground">
            Couldn’t load {COPY.loadThing}. {settings.error?.message}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void settings.refresh()}>
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {COPY.retry}
          </Button>
        </div>
      ) : (
        <div className="space-y-10">{SYSTEM_DIRECTION_GROUPS.map(renderGroup)}</div>
      )}

      <SaveBar
        dirty={dirty}
        canSave={canSave}
        saving={settings.isSaving}
        storageOff={storageOff}
        error={saveError}
        onSave={() => void save()}
        onDiscard={discard}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The save bar                                                                */
/* -------------------------------------------------------------------------- */

function SaveBar({
  dirty,
  canSave,
  saving,
  storageOff,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  storageOff: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      data-save-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <p className="font-medium text-foreground">{COPY.dirtyLead}</p>
          {(error || !canSave) && (
            <p
              className={cn('text-xs [overflow-wrap:anywhere]', error ? 'text-destructive' : 'text-muted-foreground')}
              data-save-blocked-reason=""
            >
              {error ?? (storageOff ? COPY.storageOff : COPY.noAccessTitle)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving} data-discard="">
            {COPY.discard}
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={!canSave || saving} data-save="">
            {saving && <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />}
            {saving ? COPY.saving : COPY.save}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* An item whose content is written on another screen                          */
/* -------------------------------------------------------------------------- */

/**
 * The three broadcast items. Their wording is written per announcement, not
 * once as a template, and the screens that do it already exist — so this links
 * to them instead of building a second place to type the same thing.
 */
function ManagedElsewherePanel({ item, id }: { item: SystemNotificationItem; id: string }) {
  const managed = item.managedElsewhere;
  if (!managed) return null;
  return (
    <div
      id={id}
      role="region"
      aria-label={`${item.name}: where it is written`}
      data-managed-elsewhere={managed.href}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4"
    >
      <p className="min-w-0 text-[13px] text-muted-foreground">
        {COPY.managedElsewhereLead} It lives on <span className="text-foreground">{managed.screen}</span>.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={managed.href}>
          {COPY.managedElsewhereAction} {managed.screen}
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One notification's row                                                      */
/* -------------------------------------------------------------------------- */

interface NotificationItemRowProps {
  item: SystemNotificationItem;
  chip: string;
  emailOn: boolean | null;
  pushOn: boolean | null;
  inAppOn: boolean | null;
  edited: boolean;
  pending: boolean;
  open: boolean;
  canEdit: boolean;
  onToggleOpen: (key: string) => void;
  onToggleChannel: (key: string, channel: NotificationChannel, enabled: boolean) => void;
}

/** Memoised on primitives: typing in one panel re-renders the page, not twenty rows. */
const NotificationItemRow = memo(function NotificationItemRow({
  item,
  chip,
  emailOn,
  pushOn,
  inAppOn,
  edited,
  pending,
  open,
  canEdit,
  onToggleOpen,
  onToggleChannel,
}: NotificationItemRowProps) {
  const values: Record<NotificationChannel, boolean | null> = { email: emailOn, push: pushOn, in_app: inAppOn };
  const managed = !!item.managedElsewhere;
  return (
    <div className="flex flex-col gap-3 px-5 py-3.5 md:flex-row md:items-center md:gap-6">
      {/* The name is the button; its ::after stretches the click target over the
          whole text block, and the info button sits above that layer. */}
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            id={notificationToggleId(item.key)}
            aria-expanded={open}
            aria-controls={open ? notificationPanelId(item.key) : undefined}
            onClick={() => onToggleOpen(item.key)}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
            <span className="[overflow-wrap:anywhere]">{item.name}</span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${item.name}`}
                className="relative z-10 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[13px] font-normal">
              {item.tooltip}
            </TooltipContent>
          </Tooltip>
          <Badge variant="outline" data-direction-chip="" className="font-normal text-muted-foreground">
            {chip}
          </Badge>
          {edited && (
            <Badge variant="secondary" data-edited-badge="">
              {COPY.edited}
            </Badge>
          )}
          {pending && (
            <span data-unsaved-marker="" className="text-xs text-warning">
              {COPY.unsaved}
            </span>
          )}
        </div>
        <p className="mt-0.5 pl-[22px] text-[13px] leading-snug text-muted-foreground">{itemMetaLine(item)}</p>
      </div>

      {/* The three switches, one column per channel (the header above the card
          names them). Cells align to the TOP, not centre: a cell carrying the
          "Not sent yet" marker is taller than a bare one, and centring would
          push its switch above the switches beside it. */}
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
            canEdit={canEdit && !managed}
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
  item: SystemNotificationItem;
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
          <TooltipContent side="top" className="max-w-xs text-[13px] font-normal">
            {notApplicableCopy(item, channel)}
          </TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Switch
            checked={value}
            disabled={!canEdit}
            aria-label={`${label} for ${item.name}`}
            className="h-5 w-9"
            onCheckedChange={(checked) => onToggleChannel(item.key, channel, checked)}
          />
          {/* This channel has no sender yet, so the switch is saved but changes
              nothing live. Small and muted — one marker, not a banner. The full
              sentence is `title` and sr-only rather than a Radix tooltip: this
              fires on most cells of most rows, and ~40 more tooltip instances
              is real weight on a page that already mounts one per item. */}
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

export default SystemNotificationsPage;
