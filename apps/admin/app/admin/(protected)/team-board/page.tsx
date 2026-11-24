'use client';

/**
 * Team Board (Internal): where the platform team puts notes, documents and
 * images instead of passing them around in chat (Ghulam, 2026-11-24).
 *
 * A post is text, optionally with one document or one image. Each has one of
 * three states, a date, who put it up and who it is for, and the list filters
 * on all of them. Anyone on the team can edit or delete a post; a star is
 * personal, so each person keeps their own favourites. Staff only: the table and its bucket are `is_super_admin()`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FileText, ImageIcon, MoreVertical, Plus, Star, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { HEADER_ACTIONS, HEADER_PRIMARY, PAGE_DESCRIPTION, PAGE_HEADER, PAGE_HEADER_TEXT, PAGE_TITLE } from '@/components/admin/header-buttons';
import { usePageSearch } from '@/components/admin/page-search-slot';
import { SegmentedControl } from '@/components/announcements/segmented-control';
import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { PostDetailDialog, PostDialog, type PostDraft } from '@/components/admin/team-board/post-dialogs';
import {
  KIND_LABEL,
  NO_FILTERS,
  STATUS_LABEL,
  STATUS_TEXT,
  TEAM_BOARD_BUCKET,
  TEAM_BOARD_COLUMNS,
  TEAM_BOARD_FAVORITES,
  TEAM_BOARD_PEOPLE,
  TEAM_BOARD_STATUSES,
  TEAM_BOARD_TABLE,
  formatDate,
  initialsOf,
  kindOfFile,
  matchesFilters,
  memberName,
  storagePathFor,
  titleOf,
  type BoardFilters,
  type TeamBoardItem,
  type TeamBoardKind,
  type TeamBoardStatus,
  type TeamMember,
  type TeamPerson,
} from '@/lib/team-board/model';

const PAGE_SIZE = 25;

// `team_board_items` is newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const KIND_ICON: Record<TeamBoardKind, typeof FileText> = { note: StickyNote, document: FileText, image: ImageIcon };

const PILL =
  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
const PILL_IDLE = 'border-border text-muted-foreground hover:text-foreground';
const PILL_ON = 'border-primary/40 bg-primary/5 text-foreground';

function Person({ member, fallback }: { member: TeamMember | null; fallback?: string }) {
  if (!member) return <span className="text-muted-foreground">{fallback ?? 'Someone who has left'}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {member.avatar_url ? (
          // A small profile photo from the public avatars bucket.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          initialsOf(member)
        )}
      </span>
      <span className="truncate">{memberName(member)}</span>
    </span>
  );
}

export default function TeamBoardPage() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<TeamBoardItem[]>([]);
  // Who a post can be for: the team by name, in the order Ghulam gave.
  const [people, setPeople] = useState<TeamPerson[]>([]);
  // The posts the person looking has starred. Stars are per person.
  const [starred, setStarred] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamBoardItem | 'new' | null>(null);

  const setFilter = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  usePageSearch({ placeholder: 'Search posts, files, people…', value: filters.query, onChange: (q) => setFilter('query', q), scopeLabel: 'Team Board' });

  const load = useCallback(async () => {
    const [posts, team, stars] = await Promise.all([
      db.from(TEAM_BOARD_TABLE).select(TEAM_BOARD_COLUMNS).order('created_at', { ascending: false }).range(0, 999),
      db.from(TEAM_BOARD_PEOPLE).select('id, name').order('sort_order', { ascending: true }),
      // RLS returns only my own stars, so no filter on the person is needed.
      db.from(TEAM_BOARD_FAVORITES).select('item_id'),
    ]);
    if (posts.error) toast.error(`Could not load the board: ${posts.error.message}`);
    else setItems((posts.data as TeamBoardItem[]) ?? []);
    if (!team.error) setPeople((team.data as TeamPerson[]) ?? []);
    if (!stars.error) setStarred(new Set(((stars.data as { item_id: string }[]) ?? []).map((r) => r.item_id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(0), [filters]);

  const patch = (id: string, next: Partial<TeamBoardItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)));

  const setStatusOf = async (item: TeamBoardItem, status: TeamBoardStatus) => {
    if (item.status === status) return;
    patch(item.id, { status });
    const { error } = await db.from(TEAM_BOARD_TABLE).update({ status }).eq('id', item.id);
    if (error) {
      patch(item.id, { status: item.status });
      toast.error(`Could not save: ${error.message}`);
    }
  };

  const toggleStar = async (item: TeamBoardItem) => {
    if (!user) return;
    const on = !starred.has(item.id);
    const apply = (set: boolean) =>
      setStarred((prev) => {
        const next = new Set(prev);
        if (set) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
    apply(on);
    const { error } = on
      ? await db.from(TEAM_BOARD_FAVORITES).insert({ item_id: item.id, user_id: user.id })
      : await db.from(TEAM_BOARD_FAVORITES).delete().eq('item_id', item.id).eq('user_id', user.id);
    if (error) {
      apply(!on);
      toast.error(`Could not save: ${error.message}`);
    }
  };

  /** Puts a file in the private bucket. Returns the attachment columns, or null when it failed. */
  const upload = async (file: File) => {
    const kind = kindOfFile(file);
    if (!kind) return null;
    const path = storagePathFor(file.name);
    const { error } = await supabase.storage.from(TEAM_BOARD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      toast.error(`Could not upload the file: ${error.message}`);
      return null;
    }
    return { kind, attachment_path: path, attachment_name: file.name, attachment_type: file.type, attachment_size: file.size };
  };

  const removeFile = async (path: string | null) => {
    if (!path) return;
    const { error } = await supabase.storage.from(TEAM_BOARD_BUCKET).remove([path]);
    if (error) console.warn('[team-board] could not remove a file:', error.message);
  };

  const save = async (draft: PostDraft): Promise<boolean> => {
    if (!user) return false;
    const existing = editing && editing !== 'new' ? editing : null;

    // The file first, the row second: a post never points at a missing file.
    const uploaded = draft.file ? await upload(draft.file) : null;
    if (draft.file && !uploaded) return false;

    const attachment = uploaded
      ? uploaded
      : draft.removeAttachment
        ? { kind: 'note' as const, attachment_path: null, attachment_name: null, attachment_type: null, attachment_size: null }
        : {};
    const row = { body: draft.body, status: draft.status, for_person_id: draft.forPersonId, ...attachment };

    const request = existing
      ? db.from(TEAM_BOARD_TABLE).update(row).eq('id', existing.id).select(TEAM_BOARD_COLUMNS).single()
      : db.from(TEAM_BOARD_TABLE).insert({ ...row, created_by: user.id }).select(TEAM_BOARD_COLUMNS).single();
    const { data, error } = await request;

    if (error || !data) {
      // The row was not written, so the file just uploaded belongs to nothing.
      if (uploaded) await removeFile(uploaded.attachment_path);
      toast.error(`Could not save: ${error?.message ?? 'nothing came back'}`);
      return false;
    }

    const saved = data as TeamBoardItem;
    if (existing) {
      // The old file is only removed once the row no longer points at it.
      if ((uploaded || draft.removeAttachment) && existing.attachment_path) await removeFile(existing.attachment_path);
      setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      toast.success('Post saved');
    } else {
      setItems((prev) => [saved, ...prev]);
      toast.success('Posted');
    }
    return true;
  };

  const remove = async (item: TeamBoardItem) => {
    const ok = await confirmDialog({
      title: 'Delete this post?',
      description: item.attachment_name ? `"${item.attachment_name}" is deleted with it. This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await db.from(TEAM_BOARD_TABLE).delete().eq('id', item.id);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    await removeFile(item.attachment_path);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (openId === item.id) setOpenId(null);
    toast.success('Post deleted');
  };

  const counts = useMemo(() => {
    const c: Record<'all' | TeamBoardStatus, number> = { all: items.length, not_started: 0, in_progress: 0, done: 0 };
    for (const i of items) c[i.status]++;
    return c;
  }, [items]);

  // Only people who have put something up are offered as "Put up by".
  const posters = useMemo(() => {
    const seen = new Map<string, TeamMember>();
    for (const i of items) if (i.creator && !seen.has(i.created_by)) seen.set(i.created_by, i.creator);
    return [...seen.values()].sort((a, b) => memberName(a).localeCompare(memberName(b)));
  }, [items]);

  const filtered = useMemo(() => items.filter((i) => matchesFilters(i, filters, starred)), [items, filters, starred]);
  const starCount = useMemo(() => items.filter((i) => starred.has(i.id)).length, [items, starred]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const open = items.find((i) => i.id === openId) ?? null;

  const forLabel =
    filters.forWho === 'all'
      ? 'For anyone'
      : filters.forWho === 'team'
        ? 'For everyone'
        : `For ${people.find((p) => p.id === filters.forWho)?.name ?? 'someone'}`;
  const byLabel =
    filters.postedBy === 'all'
      ? 'Put up by anyone'
      : filters.postedBy === user?.id
        ? 'Put up by me'
        : `Put up by ${memberName(posters.find((m) => m.id === filters.postedBy) ?? null)}`;

  return (
    <div className="space-y-6">
      <div className={cn('flex flex-wrap items-center justify-between gap-4', PAGE_HEADER)}>
        <div className={cn('min-w-0', PAGE_HEADER_TEXT)}>
          <h1 className={cn('text-2xl font-bold tracking-tight sm:text-3xl', PAGE_TITLE)}>Team Board</h1>
          <p className={cn('text-sm text-muted-foreground', PAGE_DESCRIPTION)}>Notes, documents and images from the team, with who they are for and where each one stands.</p>
        </div>
        <div className={HEADER_ACTIONS}>
          <Button className={HEADER_PRIMARY} onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            New post
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 max-md:flex-col max-md:flex-nowrap max-md:items-stretch">
        {/* Phones: the status chips stay one row and scroll sideways. */}
        <div className="max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
          <SegmentedControl
            className="max-md:max-w-none max-md:flex-nowrap max-md:[&>button]:shrink-0 max-md:[&>button]:whitespace-nowrap"
            size="sm"
            ariaLabel="Status"
            options={[
              { value: 'all' as BoardFilters['status'], label: `All · ${counts.all}` },
              ...TEAM_BOARD_STATUSES.map((s) => ({ value: s as BoardFilters['status'], label: `${STATUS_LABEL[s]} · ${counts[s]}` })),
            ]}
            value={filters.status}
            onChange={(s) => setFilter('status', s)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(PILL, filters.kind === 'all' ? PILL_IDLE : PILL_ON)}>
              {filters.kind === 'all' ? 'All types' : `${KIND_LABEL[filters.kind]}s`}
              <ChevronDown className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[170px]">
              <DropdownMenuItem onSelect={() => setFilter('kind', 'all')} className={cn(filters.kind === 'all' && 'font-medium text-primary')}>
                All types
              </DropdownMenuItem>
              {(Object.keys(KIND_LABEL) as TeamBoardKind[]).map((k) => (
                <DropdownMenuItem key={k} onSelect={() => setFilter('kind', k)} className={cn(filters.kind === k && 'font-medium text-primary')}>
                  <span className="flex-1">{KIND_LABEL[k]}s</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{items.filter((i) => i.kind === k).length}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(PILL, filters.forWho === 'all' ? PILL_IDLE : PILL_ON)}>
              {forLabel}
              <ChevronDown className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[320px] min-w-[190px] overflow-y-auto">
              <DropdownMenuItem onSelect={() => setFilter('forWho', 'all')} className={cn(filters.forWho === 'all' && 'font-medium text-primary')}>
                For anyone
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFilter('forWho', 'team')} className={cn(filters.forWho === 'team' && 'font-medium text-primary')}>
                For everyone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {people.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setFilter('forWho', p.id)} className={cn(filters.forWho === p.id && 'font-medium text-primary')}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={cn(PILL, filters.postedBy === 'all' ? PILL_IDLE : PILL_ON)}>
              {byLabel}
              <ChevronDown className="size-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[320px] min-w-[190px] overflow-y-auto">
              <DropdownMenuItem onSelect={() => setFilter('postedBy', 'all')} className={cn(filters.postedBy === 'all' && 'font-medium text-primary')}>
                Put up by anyone
              </DropdownMenuItem>
              {user && (
                <DropdownMenuItem onSelect={() => setFilter('postedBy', user.id)} className={cn(filters.postedBy === user.id && 'font-medium text-primary')}>
                  Put up by me
                </DropdownMenuItem>
              )}
              {posters.some((m) => m.id !== user?.id) && <DropdownMenuSeparator />}
              {posters
                .filter((m) => m.id !== user?.id)
                .map((m) => (
                  <DropdownMenuItem key={m.id} onSelect={() => setFilter('postedBy', m.id)} className={cn(filters.postedBy === m.id && 'font-medium text-primary')}>
                    {memberName(m)}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            aria-pressed={filters.favouritesOnly}
            onClick={() => setFilter('favouritesOnly', !filters.favouritesOnly)}
            className={cn(
              PILL,
              filters.favouritesOnly ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200' : PILL_IDLE,
            )}
          >
            <Star className={cn('size-3.5', filters.favouritesOnly && 'fill-amber-400 text-amber-400')} />
            Favourites · {starCount}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {/* Below `lg` the rows are cards (lib/phone-cards.ts). */}
        <div className="overflow-x-auto" data-phone-cards="">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-12 py-3 pl-4" aria-label="Favourite" />
                <th className="px-3 py-3">Post</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">For</th>
                <th className="px-3 py-3">Put up by</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Date</th>
                <th className="w-12 py-3 pr-4" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="px-5 py-3">
                        <div className="h-5 animate-pulse rounded-full bg-muted/60" />
                      </td>
                    </tr>
                  ))
                : shown.map((item) => {
                    const Icon = KIND_ICON[item.kind];
                    return (
                      <tr key={item.id} onClick={() => setOpenId(item.id)} className="group cursor-pointer transition-colors hover:bg-muted/40">
                        <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label={starred.has(item.id) ? 'Remove from favourites' : 'Add to favourites'}
                            aria-pressed={starred.has(item.id)}
                            onClick={() => void toggleStar(item)}
                            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-amber-500"
                          >
                            <Star className={cn('size-4', starred.has(item.id) && 'fill-amber-400 text-amber-400')} />
                          </button>
                        </td>
                        <td className="max-w-[360px] px-3 py-3" data-card-title="">
                          <p className="truncate font-medium text-foreground">{titleOf(item.body)}</p>
                          {item.attachment_name && <p className="truncate text-xs text-muted-foreground">{item.attachment_name}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <Icon className="size-3.5" />
                            {KIND_LABEL[item.kind]}
                          </span>
                        </td>
                        <td className="max-w-[180px] px-3 py-3 text-foreground">
                          {item.for_person ? <span className="truncate">{item.for_person.name}</span> : <span className="text-muted-foreground">Everyone</span>}
                        </td>
                        <td className="max-w-[180px] px-3 py-3 text-foreground">
                          <Person member={item.creator} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger className={cn('inline-flex items-center gap-1 rounded-full font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', STATUS_TEXT[item.status])}>
                              {STATUS_LABEL[item.status]}
                              <ChevronDown className="size-3.5 opacity-60" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-[150px]">
                              {TEAM_BOARD_STATUSES.map((s) => (
                                <DropdownMenuItem key={s} onSelect={() => void setStatusOf(item, s)} className={cn(s === item.status && 'font-medium text-primary')}>
                                  {STATUS_LABEL[s]}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatDate(item.created_at)}</td>
                        <td className="py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label="Post actions"
                              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
                            >
                              <MoreVertical className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[150px]">
                              <DropdownMenuItem onSelect={() => setOpenId(item.id)}>Open</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setEditing(item)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => void toggleStar(item)}>{starred.has(item.id) ? 'Remove favourite' : 'Add to favourites'}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove(item)}>
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        {!loading && items.length === 0 && (
          <EmptyState
            headline="Nothing on the board yet"
            body="Put up a note, a document or an image, say who it is for, and the whole team can find it here."
            action={{ label: 'New post', onClick: () => setEditing('new'), icon: Plus }}
          />
        )}
        {!loading && items.length > 0 && filtered.length === 0 && <NoMatchState noun="posts" onClear={() => setFilters(NO_FILTERS)} size="section" />}

        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <PostDetailDialog
        item={open}
        onClose={() => setOpenId(null)}
        starred={open ? starred.has(open.id) : false}
        onStar={(i) => void toggleStar(i)}
        onStatus={(i, s) => void setStatusOf(i, s)}
        onEdit={(i) => {
          setOpenId(null);
          setEditing(i);
        }}
        onDelete={(i) => void remove(i)}
      />
      <PostDialog open={editing !== null} initial={editing === 'new' ? null : editing} people={people} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}
