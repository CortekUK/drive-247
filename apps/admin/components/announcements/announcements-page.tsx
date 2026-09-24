'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Database, Megaphone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  deleteAnnouncement,
  loadActiveTenantCount,
  loadAnnouncementsData,
  prepareDuplicate,
  referencedImageUrls,
  removeAnnouncementImages,
  reorderAnnouncements,
  setAnnouncementActive,
  showAnnouncementAgain,
  applyKindOrder,
  STALE_ROW_CODE,
  type AnnouncementsData,
} from '@/lib/announcements/api';
import { compareAdminRows, type AdminAnnouncementRow, type AnnouncementKind } from '@/lib/announcements/contract';
import {
  activeTenantCountFromStats,
  allTenantsConfirmCopy,
  needsAllTenantsConfirm,
  showAgainConfirmCopy,
  type ConfirmCopy,
} from '@/lib/announcements/all-tenants-confirm';
import { type DuplicateSeed, type RowPending } from '@/lib/announcements/row-actions';
import { AnnouncementEditorDialog } from './announcement-editor-dialog';
import { AnnouncementList, ListSkeleton } from './announcement-list';
import { ConfirmDialog } from './confirm-dialog';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';
import { QUIET_BUTTON } from './form-field';

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not-installed' }
  | { status: 'ready'; data: AnnouncementsData };

type TabValue = 'features' | 'system';

const TAB_KIND: Record<TabValue, AnnouncementKind> = { features: 'feature', system: 'system' };

const TAB_HINT: Record<TabValue, string> = {
  features:
    'Cards on the new dashboard’s “On your desk” row, each opening a slides dialog. Tenants see them in this order; drag to change it.',
  system:
    'Dialogs and banners in every targeted portal, shown before any feature. Hard blockers come first, then soft; drag within a section to change the order.',
};

/**
 * Super admin Announcements: Features | System tabs over the portal
 * announcement tables. Loads on mount and after every change; a request
 * sequence drops stale responses, so an optimistic change is never overwritten
 * by a read that started before it.
 */
export function AnnouncementsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: TabValue = searchParams.get('tab') === 'system' ? 'system' : 'features';

  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [editor, setEditor] = useState<{
    key: number;
    kind: AnnouncementKind;
    row: AdminAnnouncementRow | null;
    /** Set when the editor opens a duplicate (create mode, prefilled, images already copied). */
    duplicate: DuplicateSeed | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Switching on a system announcement for All tenants, waiting for the admin's yes. */
  const [confirmActivate, setConfirmActivate] = useState<{ row: AdminAnnouncementRow; copy: ConfirmCopy } | null>(null);
  const [confirmShowAgain, setConfirmShowAgain] = useState<{
    row: AdminAnnouncementRow;
    copy: { title: string; description: string; confirmLabel: string };
  } | null>(null);
  /** Keep each confirmation's text while it animates closed. */
  const lastActivateCopy = useRef<ConfirmCopy>(allTenantsConfirmCopy({ blocking: 'soft', display: 'banner' }, 'activate', null));
  const lastShowAgainCopy = useRef(showAgainConfirmCopy({ title: '', kind: 'feature', audience: 'selected', is_active: false }, null));
  /** The title of the row whose confirmation is waiting for the active-tenant count: one at a time. */
  const askingConfirm = useRef<string | null>(null);
  /** That row, shown as busy (switch disabled) until its question opens. */
  const [askingRowId, setAskingRowId] = useState<string | null>(null);
  const tenantCountLoad = useRef<Promise<number | null> | null>(null);
  /** Inline Active writes in flight per row (a counter: the switch can be flipped again before the first write lands). */
  const [activeWrites, setActiveWrites] = useState<Record<string, number>>({});
  const [showingAgain, setShowingAgain] = useState<Record<string, true>>({});
  /** The row whose duplicate is being prepared; one at a time. */
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Any dialog of this page is open (editor or a confirmation). */
  const modalOpen = useRef(false);
  const seq = useRef(0);
  const editorKey = useRef(0);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  /** The control that opened the dialog on screen; it gets focus back on close. */
  const opener = useRef<HTMLElement | null>(null);
  /** After a delete: the row whose Edit button takes focus instead of the removed row's. */
  const focusRowAfterDelete = useRef<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'silent') => {
    const mine = ++seq.current;
    if (mode === 'initial') setState({ status: 'loading' });
    const result = await loadAnnouncementsData();
    if (mine !== seq.current) return;
    if (result.status === 'ready') setState({ status: 'ready', data: result.data });
    else if (result.status === 'not-installed') setState({ status: 'not-installed' });
    else if (mode === 'initial') setState({ status: 'error', message: result.message });
    // A failed silent refresh keeps what is on screen.
    else console.warn('[announcements] refresh failed:', result.message);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load('initial');
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, [load]);

  useEffect(() => {
    modalOpen.current = editor !== null || deleteTarget !== null || confirmActivate !== null || confirmShowAgain !== null;
  }, [editor, deleteTarget, confirmActivate, confirmShowAgain]);

  /** The active-tenant count read from the stats on screen (null: none to read it from). */
  const statsTenantCount = useMemo(
    () => (state.status === 'ready' ? activeTenantCountFromStats(state.data.rows, state.data.statsById) : null),
    [state],
  );

  /**
   * N in "(N active tenants)": the stats' reachable count of any All tenants row when the page
   * has one (the old and the new stats function both return it), otherwise the picker's tenant
   * read counted the same way. null when neither is available: the question is asked without N.
   */
  const resolveAllTenantsCount = useCallback((): Promise<number | null> => {
    if (statsTenantCount !== null) return Promise.resolve(statsTenantCount);
    if (!tenantCountLoad.current) {
      const load = loadActiveTenantCount()
        .then((res) => {
          if (!res.ok) console.warn('[announcements] active tenant count unavailable:', res.message);
          return res.ok ? res.data : null;
        })
        .catch(() => null)
        .finally(() => {
          if (tenantCountLoad.current === load) tenantCountLoad.current = null;
        });
      tenantCountLoad.current = load;
    }
    return tenantCountLoad.current;
  }, [statsTenantCount]);

  /**
   * Open a confirmation that needs the tenant count, unless another dialog opened while it loaded.
   * The count always settles (the fallback read gives up after a few seconds), so the latch is always
   * released. A click this cannot ask about is never dropped silently: `dropped` says what to do.
   */
  const askWithTenantCount = (row: AdminAnnouncementRow, dropped: string, open: (count: number | null) => void) => {
    if (askingConfirm.current !== null) {
      toast.info('Still reading the tenant count for “' + askingConfirm.current + '”. Try again in a moment.');
      return;
    }
    askingConfirm.current = row.title;
    setAskingRowId(row.id);
    void resolveAllTenantsCount()
      .catch(() => null)
      .then((count) => {
        askingConfirm.current = null;
        if (!mounted.current) return;
        setAskingRowId(null);
        if (modalOpen.current) {
          toast.info(dropped);
          return;
        }
        open(count);
      });
  };

  const pendingById = useMemo(() => {
    const out: Record<string, RowPending | undefined> = {};
    if (askingRowId) out[askingRowId] = 'asking';
    for (const id of Object.keys(activeWrites)) if (activeWrites[id] > 0) out[id] = 'active';
    for (const id of Object.keys(showingAgain)) out[id] = 'show-again';
    return out;
  }, [askingRowId, activeWrites, showingAgain]);

  /** Apply an optimistic change and invalidate any read already in flight. */
  const updateRows = (fn: (rows: AdminAnnouncementRow[]) => AdminAnnouncementRow[]) => {
    seq.current += 1;
    setState((s) => (s.status === 'ready' ? { status: 'ready', data: { ...s.data, rows: fn(s.data.rows) } } : s));
  };

  const setTab = (value: string) => {
    const next: TabValue = value === 'system' ? 'system' : 'features';
    router.replace(pathname + '?tab=' + next, { scroll: false });
  };

  // The dialogs here open from code, not a DialogTrigger, so Radix would drop
  // focus on <body> when they close. Remember the opener and hand focus back.
  const rememberOpener = () => {
    const el = typeof document === 'undefined' ? null : document.activeElement;
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const el = opener.current;
    const rowId = focusRowAfterDelete.current;
    opener.current = null;
    focusRowAfterDelete.current = null;
    if (el?.isConnected) {
      el.focus();
      return;
    }
    const rowEdit = rowId
      ? document.querySelector<HTMLElement>('[data-announcement-row="' + rowId + '"] button[aria-label^="Edit "]')
      : null;
    if (rowEdit) rowEdit.focus();
    else newButtonRef.current?.focus({ preventScroll: true });
  };

  const toggleActive = (row: AdminAnnouncementRow, next: boolean) => {
    // Switching on a system announcement for All tenants (dialog or banner, soft or hard) puts it
    // on every tenant's portal: ask first, exactly as saving one from the editor does. The switch
    // stays off until confirmed. Switching off, and features, never ask.
    if (needsAllTenantsConfirm({ ...row, is_active: next })) {
      rememberOpener();
      const dropped = 'Turning on “' + row.title + '” was cancelled because another dialog was open. Switch it on again.';
      askWithTenantCount(row, dropped, (count) => {
        const copy = allTenantsConfirmCopy(row, 'activate', count);
        lastActivateCopy.current = copy;
        setConfirmActivate({ row, copy });
      });
      return;
    }
    void writeActive(row, next);
  };

  /** Show again re-saves the row: for an active system announcement for All tenants its confirmation says so. */
  const askShowAgain = (row: AdminAnnouncementRow) => {
    rememberOpener();
    const open = (count: number | null) => {
      const copy = showAgainConfirmCopy(row, count);
      lastShowAgainCopy.current = copy;
      setConfirmShowAgain({ row, copy });
    };
    const dropped = 'Show again for “' + row.title + '” was cancelled because another dialog was open. Press Show again to try once more.';
    if (needsAllTenantsConfirm(row)) askWithTenantCount(row, dropped, open);
    else open(null);
  };

  const writeActive = async (row: AdminAnnouncementRow, next: boolean) => {
    const previous = row.is_active;
    const countWrite = (delta: 1 | -1) =>
      setActiveWrites((w) => {
        const n = (w[row.id] ?? 0) + delta;
        const out = { ...w };
        if (n > 0) out[row.id] = n;
        else delete out[row.id];
        return out;
      });
    updateRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));
    countWrite(1);
    const res = await setAnnouncementActive(row.id, next);
    if (mounted.current) countWrite(-1);
    if (!res.ok) {
      // Same stale-row case as delete: the switch cannot be moved on a row that
      // no longer exists, so refresh rather than restoring a phantom.
      if (res.code === STALE_ROW_CODE) {
        updateRows((rows) => rows.filter((r) => r.id !== row.id));
        toast.success(res.message);
        void load('silent');
        return;
      }
      updateRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, is_active: previous } : r)));
      toast.error('Could not change Active: ' + res.message);
      return;
    }
    void load('silent');
  };

  const reorder = async (kind: AnnouncementKind, ids: string[]) => {
    if (state.status !== 'ready') return;
    const before = new Map(state.data.rows.filter((r) => r.kind === kind).map((r) => [r.id, r.sort_order]));
    updateRows((rows) => applyKindOrder(rows, kind, ids));
    const res = await reorderAnnouncements(kind, ids);
    if (!res.ok) {
      updateRows((rows) =>
        rows
          .map((r) => (r.kind === kind && before.has(r.id) ? { ...r, sort_order: before.get(r.id) as number } : r))
          .sort(compareAdminRows),
      );
      // An expired sign-in says what to do; anything else keeps the short toast.
      toast.error(res.code === 'SESSION_EXPIRED' ? 'Could not save the new order: ' + res.message : 'Could not save the new order');
      console.warn('[announcements] reorder failed:', res.message);
    }
    void load('silent');
  };

  const confirmDelete = async (row: AdminAnnouncementRow) => {
    setDeleting(true);
    const res = await deleteAnnouncement(row.id);
    setDeleting(false);
    if (!res.ok) {
      /**
       * The row is already gone from the database. Leaving it on screen was the
       * actual bug: the dialog stayed open over a row that no delete could ever
       * remove, so the same "reload the page" toast appeared on every attempt
       * (Sep 18 2026 — three system announcements, deleted, still listed). Close
       * the dialog, drop the row, and refetch, which is what the message used to
       * ask the operator to do by hand.
       */
      if (res.code === STALE_ROW_CODE) {
        setDeleteTarget(null);
        updateRows((rows) => rows.filter((r) => r.id !== row.id));
        toast.success(res.message);
        void load('silent');
        return;
      }
      toast.error('Could not delete: ' + res.message);
      return;
    }
    if (state.status === 'ready') {
      const ofKind = state.data.rows.filter((r) => r.kind === row.kind);
      const i = ofKind.findIndex((r) => r.id === row.id);
      focusRowAfterDelete.current = (ofKind[i + 1] ?? ofKind[i - 1])?.id ?? null;
    }
    setDeleteTarget(null);
    updateRows((rows) => rows.filter((r) => r.id !== row.id));
    toast.success('Deleted');
    void removeAnnouncementImages(referencedImageUrls(row));
    void load('silent');
  };

  const openEditor = (kind: AnnouncementKind, row: AdminAnnouncementRow | null) => {
    rememberOpener();
    editorKey.current += 1;
    setEditor({ key: editorKey.current, kind, row, duplicate: null });
  };

  /**
   * Show again: the save RPC with p_reshow and the row's current content (read
   * fresh by the api), which bumps the revision so earlier dismissals no longer count.
   */
  const runShowAgain = async (row: AdminAnnouncementRow) => {
    if (showingAgain[row.id]) return;
    setShowingAgain((m) => ({ ...m, [row.id]: true }));
    const res = await showAnnouncementAgain(row.id);
    if (!mounted.current) return;
    setShowingAgain((m) => {
      const out = { ...m };
      delete out[row.id];
      return out;
    });
    if (!res.ok) {
      toast.error('Could not show it again: ' + res.message);
      return;
    }
    toast.success('“' + row.title + '” will show again to everyone who closed it');
    void load('silent');
  };

  /**
   * Duplicate: copy the row's images to objects of its own, then open the editor
   * in create mode, prefilled and inactive. Nothing is saved until Save; Cancel
   * deletes the copies (they are the editor's uploads).
   */
  const duplicate = async (row: AdminAnnouncementRow) => {
    if (duplicatingId !== null || state.status !== 'ready') return;
    rememberOpener();
    setDuplicatingId(row.id);
    const res = await prepareDuplicate(row, state.data.targetsById[row.id] ?? []);
    if (!mounted.current) {
      if (res.ok) void removeAnnouncementImages(res.data.uploads);
      return;
    }
    setDuplicatingId(null);
    if (!res.ok) {
      toast.error('Could not duplicate: ' + res.message);
      return;
    }
    if (modalOpen.current) {
      // Another dialog opened while the images were copying: never stack the editor on it. Drop this
      // duplicate with its copies (nothing was saved) and say so.
      void removeAnnouncementImages(res.data.uploads);
      toast.info('Duplicate of “' + row.title + '” not opened because another dialog was open. Press Duplicate again.');
      return;
    }
    editorKey.current += 1;
    setEditor({ key: editorKey.current, kind: row.kind, row: null, duplicate: res.data });
  };

  const rows = state.status === 'ready' ? state.data.rows : [];
  const count = (kind: AnnouncementKind) => {
    const ofKind = rows.filter((r) => r.kind === kind);
    return ofKind.filter((r) => r.is_active).length + '/' + ofKind.length;
  };

  const renderTab = (value: TabValue) => {
    const kind = TAB_KIND[value];
    if (state.status === 'loading') return <ListSkeleton />;
    if (state.status === 'not-installed') {
      return (
        <StateBox icon={<Database className="h-5 w-5" />}>
          <p className="text-sm text-muted-foreground">
            Announcements are not installed in this database yet. Apply ops/portal_announcements.sql.
          </p>
        </StateBox>
      );
    }
    if (state.status === 'error') {
      return (
        <StateBox icon={<AlertTriangle className="h-5 w-5 text-destructive" />}>
          <p className="text-sm font-medium text-foreground">Could not load announcements</p>
          <p className="max-w-md break-words text-sm text-muted-foreground">{state.message}</p>
          <Button variant="outline" className={QUIET_BUTTON} onClick={() => void load('initial')}>
            Try again
          </Button>
        </StateBox>
      );
    }
    const ofKind = state.data.rows.filter((r) => r.kind === kind);
    if (ofKind.length === 0) {
      return (
        <StateBox icon={<Megaphone className="h-5 w-5 text-primary" />}>
          <p className="text-sm font-medium text-foreground">
            {kind === 'feature' ? 'No feature announcements yet' : 'No system announcements yet'}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {kind === 'feature'
              ? 'With no active feature, the dashboard shows no card and the other desk cards fill the row.'
              : 'With no active system announcement, tenants see nothing extra.'}
          </p>
          <Button onClick={() => openEditor(kind, null)}>
            <Plus className="h-4 w-4" />
            New announcement
          </Button>
        </StateBox>
      );
    }
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{TAB_HINT[value]}</p>
        <AnnouncementList
          kind={kind}
          rows={ofKind}
          targetsById={state.data.targetsById}
          statsById={state.data.statsById}
          statsCountSuperAdmins={state.data.statsCountSuperAdmins}
          onReorder={(k, ids) => void reorder(k, ids)}
          pendingById={pendingById}
          duplicatingId={duplicatingId}
          onToggleActive={toggleActive}
          onEdit={(row) => openEditor(row.kind, row)}
          onDelete={(row) => {
            rememberOpener();
            setDeleteTarget(row);
          }}
          onShowAgain={askShowAgain}
          onDuplicate={(row) => void duplicate(row)}
        />
      </div>
    );
  };

  const otherActiveFeatures = rows.filter((r) => r.kind === 'feature' && r.is_active && r.id !== editor?.row?.id).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="glow-purple-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <Megaphone className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Announcements</h1>
            <p className="text-sm text-muted-foreground">
              Feature cards on the dashboard and system messages for tenants&apos; portals.
            </p>
          </div>
        </div>
        <Button ref={newButtonRef} onClick={() => openEditor(TAB_KIND[tab], null)} disabled={state.status !== 'ready'}>
          <Plus className="h-4 w-4" />
          New announcement
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="features" className="cursor-pointer">
            Features
            {state.status === 'ready' && <span className="ml-1.5 tabular-nums text-muted-foreground">({count('feature')})</span>}
          </TabsTrigger>
          <TabsTrigger value="system" className="cursor-pointer">
            System
            {state.status === 'ready' && <span className="ml-1.5 tabular-nums text-muted-foreground">({count('system')})</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="features">{renderTab('features')}</TabsContent>
        <TabsContent value="system">{renderTab('system')}</TabsContent>
      </Tabs>

      {editor && state.status === 'ready' && (
        <AnnouncementEditorDialog
          key={editor.key}
          kind={editor.kind}
          row={editor.row}
          duplicate={editor.duplicate}
          tenantIds={editor.row ? (state.data.targetsById[editor.row.id] ?? []) : []}
          otherActiveFeatures={otherActiveFeatures}
          resolveAllTenantsCount={resolveAllTenantsCount}
          onCloseAutoFocus={restoreFocus}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            toast.success('Saved');
            void load('silent');
          }}
        />
      )}

      <DeleteAnnouncementDialog
        row={deleteTarget}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(row) => void confirmDelete(row)}
        onCloseAutoFocus={restoreFocus}
      />

      <ConfirmDialog
        open={confirmShowAgain !== null}
        {...(confirmShowAgain?.copy ?? lastShowAgainCopy.current)}
        returnFocusRef={opener}
        onCancel={() => setConfirmShowAgain(null)}
        onConfirm={() => {
          const pending = confirmShowAgain;
          setConfirmShowAgain(null);
          if (pending) void runShowAgain(pending.row);
        }}
      />

      <ConfirmDialog
        open={confirmActivate !== null}
        {...(confirmActivate?.copy ?? lastActivateCopy.current)}
        returnFocusRef={opener}
        onCancel={() => setConfirmActivate(null)}
        onConfirm={() => {
          const pending = confirmActivate;
          setConfirmActivate(null);
          if (pending) void writeActive(pending.row, true);
        }}
      />
    </div>
  );
}

function StateBox({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-14 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">{icon}</div>
      {children}
    </div>
  );
}
