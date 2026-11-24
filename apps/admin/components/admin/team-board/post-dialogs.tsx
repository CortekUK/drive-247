'use client';

/**
 * Team Board's two dialogs: writing a post (or editing one), and reading one.
 *
 * A post is text. It may carry one document or one image, and then the text
 * says what the file is about. The file goes up first and the row second, so a
 * post never points at a file that is not there.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, ImageIcon, Loader2, Paperclip, Pencil, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';
import { SegmentedControl } from '@/components/announcements/segmented-control';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  ACCEPTED_FILE_TYPES,
  BODY_MAX,
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_TEXT,
  TEAM_BOARD_BUCKET,
  TEAM_BOARD_STATUSES,
  fileProblem,
  formatBytes,
  formatDateTime,
  kindOfFile,
  memberName,
  type TeamBoardItem,
  type TeamBoardStatus,
  type TeamMember,
} from '@/lib/team-board/model';

/** What the page needs to save a post. `file` is a newly chosen file, if any. */
export interface PostDraft {
  body: string;
  status: TeamBoardStatus;
  forUserId: string | null;
  file: File | null;
  /** Editing only: the post had a file and it was taken off. */
  removeAttachment: boolean;
}

const EVERYONE = 'everyone';

/* --------------------------------- Write --------------------------------- */

export function PostDialog({
  open,
  initial,
  members,
  onClose,
  onSave,
}: {
  open: boolean;
  /** null = a new post. */
  initial: TeamBoardItem | null;
  members: TeamMember[];
  onClose: () => void;
  onSave: (draft: PostDraft) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<TeamBoardStatus>('not_started');
  const [forWho, setForWho] = useState<string>(EVERYONE);
  const [file, setFile] = useState<File | null>(null);
  const [keptName, setKeptName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setBody(initial?.body ?? '');
    setStatus(initial?.status ?? 'not_started');
    setForWho(initial?.for_user_id ?? EVERYONE);
    setFile(null);
    setKeptName(initial?.attachment_name ?? null);
    setTried(false);
  }, [open, initial]);

  const attachedName = file?.name ?? keptName;
  const attachedKind = file ? kindOfFile(file) : initial && keptName ? (initial.kind === 'note' ? null : initial.kind) : null;
  const empty = !body.trim();

  const choose = (picked: File | undefined) => {
    if (picker.current) picker.current.value = '';
    if (!picked) return;
    const problem = fileProblem(picked);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(picked);
  };

  const takeOff = () => {
    setFile(null);
    setKeptName(null);
  };

  const save = async () => {
    setTried(true);
    if (empty) return;
    setBusy(true);
    const ok = await onSave({
      body: body.trim(),
      status,
      forUserId: forWho === EVERYONE ? null : forWho,
      file,
      removeAttachment: !!initial?.attachment_path && !keptName && !file,
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[560px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>{initial ? 'Edit post' : 'New post'}</DialogTitle>
          <DialogDescription>Write a note, or attach a document or an image and say what it is about.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2 [scrollbar-width:thin]">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {attachedName ? (attachedKind === 'image' ? 'What is this image about?' : 'What is this document about?') : 'What do you want to share?'}
              <span className="text-destructive"> *</span>
            </span>
            <Textarea
              autoFocus
              rows={5}
              maxLength={BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={(tried && empty) || undefined}
              className={cn('resize-none rounded-2xl', tried && empty && 'ring-2 ring-destructive/50')}
            />
            {tried && empty && <span className="text-xs text-destructive">Write a line or two first.</span>}
          </label>

          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Attachment</span>
            <input ref={picker} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
            {attachedName ? (
              <div className="flex items-center gap-2.5 rounded-2xl border border-border px-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {attachedKind === 'image' ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{attachedName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {attachedKind ? KIND_LABEL[attachedKind] : 'File'}
                    {file ? ` · ${formatBytes(file.size)}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Take the file off"
                  onClick={takeOff}
                  disabled={busy}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => picker.current?.click()}
                disabled={busy}
                className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
              >
                <Paperclip className="size-4 shrink-0" />
                <span>
                  Attach a document or an image
                  <span className="block text-xs">PDF, Word, Excel, PowerPoint, text or an image, up to 25 MB.</span>
                </span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Who is it for?</span>
              <Select value={forWho} onValueChange={setForWho} disabled={busy}>
                <SelectTrigger className="rounded-full" aria-label="Who is it for?">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERYONE}>Everyone</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col items-start gap-1">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <SegmentedControl
                size="sm"
                ariaLabel="Status"
                options={TEAM_BOARD_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                value={status}
                onChange={setStatus}
                disabled={busy}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-4">
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-full" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button className="rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {initial ? 'Save' : 'Post'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Read --------------------------------- */

export function PostDetailDialog({
  item,
  starred,
  onClose,
  onStar,
  onStatus,
  onEdit,
  onDelete,
}: {
  item: TeamBoardItem | null;
  /** Whether the person looking has starred this post. */
  starred: boolean;
  onClose: () => void;
  onStar: (item: TeamBoardItem) => void;
  onStatus: (item: TeamBoardItem, status: TeamBoardStatus) => void;
  onEdit: (item: TeamBoardItem) => void;
  onDelete: (item: TeamBoardItem) => void;
}) {
  // Keep the last post on screen while the dialog closes, so it does not empty first.
  const last = useRef<TeamBoardItem | null>(null);
  if (item) last.current = item;
  const post = item ?? last.current;

  // The bucket is private: a file is reached through a link that expires.
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileFailed, setFileFailed] = useState(false);
  const path = item?.attachment_path ?? null;
  useEffect(() => {
    setFileUrl(null);
    setFileFailed(false);
    if (!path) return;
    let cancelled = false;
    void supabase.storage
      .from(TEAM_BOARD_BUCKET)
      .createSignedUrl(path, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFileFailed(true);
        else setFileUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!post) return null;

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[640px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>{KIND_LABEL[post.kind]}</DialogTitle>
          <DialogDescription>
            Put up by {memberName(post.creator)} on {formatDateTime(post.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2 [scrollbar-width:thin]">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{post.body}</p>

          {post.attachment_path && (
            <div className="space-y-2">
              {post.kind === 'image' && fileUrl && (
                // A signed, expiring link to a private file: next/image cannot optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl} alt={post.attachment_name ?? 'Attached image'} className="max-h-[320px] w-full rounded-2xl border border-border object-contain" />
              )}
              <div className="flex items-center gap-2.5 rounded-2xl border border-border px-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {post.kind === 'image' ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{post.attachment_name}</span>
                  <span className="block text-xs text-muted-foreground">{formatBytes(post.attachment_size)}</span>
                </span>
                {fileUrl ? (
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Open
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : fileFailed ? (
                  <span className="shrink-0 text-xs text-destructive">Could not load the file</span>
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Who is it for</dt>
              <dd className="mt-0.5 text-foreground">{post.for_user_id ? memberName(post.for_user) : 'Everyone'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Put up by</dt>
              <dd className="mt-0.5 text-foreground">{memberName(post.creator)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger className={cn('inline-flex items-center gap-1 rounded-full font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring', STATUS_TEXT[post.status])}>
                    {STATUS_LABEL[post.status]}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[150px]">
                    {TEAM_BOARD_STATUSES.map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => onStatus(post, s)} className={cn(s === post.status && 'font-medium text-primary')}>
                        {STATUS_LABEL[s]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 pb-6 pt-4">
          <Button variant="ghost" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(post)}>
            <Trash2 className="size-4" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="rounded-full"
              aria-pressed={starred}
              onClick={() => onStar(post)}
            >
              <Star className={cn('size-4', starred && 'fill-amber-400 text-amber-400')} />
              {starred ? 'Favourite' : 'Add to favourites'}
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => onEdit(post)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <DialogClose asChild>
              <Button className="rounded-full">Close</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
