'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Database, Megaphone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  deleteAnnouncement,
  loadAnnouncementsData,
  referencedImageUrls,
  removeAnnouncementImages,
  reorderAnnouncements,
  setAnnouncementActive,
  applyKindOrder,
  type AnnouncementsData,
} from '@/lib/announcements/api';
import { compareAdminRows, type AdminAnnouncementRow, type AnnouncementKind } from '@/lib/announcements/contract';
import { AnnouncementEditorDialog } from './announcement-editor-dialog';
import { AnnouncementList, ListSkeleton } from './announcement-list';
import { ConfirmDialog } from './confirm-dialog';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';
import { QUIET_BUTTON } from './form-field';
import { blocksEveryTenant } from './form-logic';

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
  const [editor, setEditor] = useState<{ key: number; kind: AnnouncementKind; row: AdminAnnouncementRow | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState<AdminAnnouncementRow | null>(null);
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
    void load('initial');
    return () => {
      seq.current += 1;
    };
  }, [load]);

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
    // Switching on a hard blocker for All tenants blocks every portal: ask first,
    // exactly as saving one from the editor does. The switch stays off until confirmed.
    if (blocksEveryTenant({ ...row, is_active: next })) {
      rememberOpener();
      setConfirmActivate(row);
      return;
    }
    void writeActive(row, next);
  };

  const writeActive = async (row: AdminAnnouncementRow, next: boolean) => {
    const previous = row.is_active;
    updateRows((rows) => rows.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));
    const res = await setAnnouncementActive(row.id, next);
    if (!res.ok) {
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
      toast.error('Could not save the new order');
      console.warn('[announcements] reorder failed:', res.message);
    }
    void load('silent');
  };

  const confirmDelete = async (row: AdminAnnouncementRow) => {
    setDeleting(true);
    const res = await deleteAnnouncement(row.id);
    setDeleting(false);
    if (!res.ok) {
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
    setEditor({ key: editorKey.current, kind, row });
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
          onReorder={(k, ids) => void reorder(k, ids)}
          onToggleActive={toggleActive}
          onEdit={(row) => openEditor(row.kind, row)}
          onDelete={(row) => {
            rememberOpener();
            setDeleteTarget(row);
          }}
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
            <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
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
          tenantIds={editor.row ? (state.data.targetsById[editor.row.id] ?? []) : []}
          otherActiveFeatures={otherActiveFeatures}
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
        open={confirmActivate !== null}
        title="Block every tenant?"
        description="This blocks every tenant's portal until you deactivate it. Continue?"
        confirmLabel="Turn on and block"
        destructive
        returnFocusRef={opener}
        onCancel={() => setConfirmActivate(null)}
        onConfirm={() => {
          const row = confirmActivate;
          setConfirmActivate(null);
          if (row) void writeActive(row, true);
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
