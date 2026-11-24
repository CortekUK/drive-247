'use client';

/**
 * Team Board's two dialogs: writing a post (or editing one), and reading one.
 *
 * A post is text. It may carry several files (documents, images, videos,
 * voice notes recorded here), and then the text says what they are about.
 * Images can be pasted straight in. A voice note needs no text. The file goes up first and the row second, so a
 * post never points at a file that is not there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, ImageIcon, Loader2, Mic, Paperclip, Pencil, Square, Star, Trash2, Video, X } from 'lucide-react';
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
  FILES_MAX,
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_TEXT,
  TEAM_BOARD_BUCKET,
  TEAM_BOARD_STATUSES,
  VOICE_NOTE_BODY,
  baseType,
  fileProblem,
  formatBytes,
  formatDateTime,
  filesOf,
  kindLabelOf,
  kindOfFile,
  memberName,
  type FileKind,
  type TeamAttachment,
  type TeamBoardItem,
  type TeamBoardStatus,
  type TeamPerson,
} from '@/lib/team-board/model';

/** What the page needs to save a post. */
export interface PostDraft {
  body: string;
  status: TeamBoardStatus;
  forPersonId: string | null;
  /** Files added in this sitting, in order. */
  files: File[];
  /** Editing only: the ids of files the post had that were taken off. */
  removeIds: string[];
}

const EVERYONE = 'everyone';

const FILE_ICON: Record<FileKind, typeof FileText> = { document: FileText, image: ImageIcon, voice: Mic, video: Video };

/** "2026-11-24 22.15", safe in a file name. */
const stamp = () => {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/* --------------------------------- Write --------------------------------- */

export function PostDialog({
  open,
  initial,
  people,
  uploadPct,
  onClose,
  onSave,
}: {
  open: boolean;
  /** null = a new post. */
  initial: TeamBoardItem | null;
  people: TeamPerson[];
  /** 0-100 while the file is going up, otherwise null. */
  uploadPct: number | null;
  onClose: () => void;
  onSave: (draft: PostDraft) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<TeamBoardStatus>('not_started');
  const [forWho, setForWho] = useState<string>(EVERYONE);
  // New files, and (when editing) the files the post already has and keeps.
  const [files, setFiles] = useState<File[]>([]);
  const [kept, setKept] = useState<TeamAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Recording a voice note.
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);

  const stopRecording = (throwAway: boolean) => {
    discard.current = throwAway;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  };

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Closing the dialog mid-recording lets go of the microphone.
  useEffect(() => {
    if (!open) stopRecording(true);
    return () => stopRecording(true);
  }, [open]);

  // A local address for each new file, to show it before it is posted.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const count = kept.length + files.length;

  /** Adds files to the post, leaving out any the board cannot take. */
  const add = (picked: File[]) => {
    if (!picked.length) return;
    const room = FILES_MAX - count;
    if (picked.length > room) toast.error(`A post can carry ${FILES_MAX} files.`);
    const good: File[] = [];
    for (const f of picked.slice(0, Math.max(0, room))) {
      const problem = fileProblem(f);
      if (problem) toast.error(picked.length > 1 ? `"${f.name}": ${problem}` : problem);
      else good.push(f);
    }
    if (good.length) setFiles((prev) => [...prev, ...good]);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('This browser cannot record audio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error('The microphone is blocked. Allow it for this site in your browser, then try again.');
      return;
    }
    const wanted = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, wanted ? { mimeType: wanted } : undefined);
    const chunks: Blob[] = [];
    discard.current = false;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      if (discard.current) return;
      const type = baseType(r.mimeType || wanted || 'audio/webm');
      const blob = new Blob(chunks, { type });
      if (!blob.size) {
        toast.error('Nothing was recorded.');
        return;
      }
      const ext = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'webm';
      add([new File([blob], `Voice note ${stamp()}.${ext}`, { type })]);
    };
    recorder.current = r;
    r.start();
    setSeconds(0);
    setRecording(true);
  };

  /** Images copied from anywhere (a screenshot, a chat) are attached on paste. */
  const pasteImage = (e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (!images.length || busy || recording) return;
    e.preventDefault();
    // Screenshots all arrive as "image.png": give each a name of its own.
    add(
      images.map((image, i) => {
        if (image.name && !/^image\.\w+$/i.test(image.name)) return image;
        const ext = image.name.includes('.') ? image.name.split('.').pop() : 'png';
        return new File([image], `Pasted image ${stamp()}${images.length > 1 ? ` (${i + 1})` : ''}.${ext}`, { type: image.type });
      }),
    );
  };

  useEffect(() => {
    if (!open) return;
    setBody(initial?.body ?? '');
    setStatus(initial?.status ?? 'not_started');
    setForWho(initial?.for_person_id ?? EVERYONE);
    setFiles([]);
    setKept(initial ? filesOf(initial) : []);
    setTried(false);
  }, [open, initial]);

  const kinds = [...kept.map((k) => k.kind), ...files.map((f) => kindOfFile(f))];
  // A voice note speaks for itself: text with it is optional.
  const hasVoice = kinds.includes('voice');
  const empty = !body.trim() && !hasVoice;

  const choose = (picked: FileList | null) => {
    const list = picked ? Array.from(picked) : [];
    if (picker.current) picker.current.value = '';
    add(list);
  };

  const save = async () => {
    setTried(true);
    if (empty || recording) return;
    setBusy(true);
    const ok = await onSave({
      body: body.trim() || VOICE_NOTE_BODY,
      status,
      forPersonId: forWho === EVERYONE ? null : forWho,
      files,
      removeIds: initial ? initial.attachments.filter((a) => !kept.some((k) => k.id === a.id)).map((a) => a.id) : [],
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent onPaste={pasteImage} className="flex max-h-[90vh] w-[96vw] max-w-[560px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>{initial ? 'Edit post' : 'New post'}</DialogTitle>
          <DialogDescription>Write a note, record a voice note, or attach files and say what they are about.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2 [scrollbar-width:thin]">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {hasVoice
                ? 'Add a line with it (optional)'
                : count === 0
                  ? 'What do you want to share?'
                  : count > 1
                    ? 'What are these about?'
                    : kinds[0] === 'image'
                      ? 'What is this image about?'
                      : kinds[0] === 'video'
                        ? 'What is this video about?'
                        : 'What is this document about?'}
              {!hasVoice && <span className="text-destructive"> *</span>}
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
            <span className="text-xs font-medium text-muted-foreground">{count > 0 ? `Attachments · ${count}` : 'Attachments'}</span>
            <input ref={picker} type="file" multiple accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={(e) => choose(e.target.files)} />

            {count > 0 && (
              <ul className="space-y-2">
                {kept.map((a) => {
                  const Icon = FILE_ICON[a.kind];
                  return (
                    <li key={a.id} className="flex items-center gap-2.5 rounded-2xl border border-border px-3 py-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {KIND_LABEL[a.kind]} · {formatBytes(a.size_bytes)}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Take ${a.name} off`}
                        onClick={() => setKept((prev) => prev.filter((k) => k.id !== a.id))}
                        disabled={busy}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  );
                })}
                {files.map((f, i) => {
                  const kind = kindOfFile(f);
                  const Icon = kind ? FILE_ICON[kind] : FileText;
                  return (
                    <li key={`${f.name}-${i}`} className="rounded-2xl border border-border px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                          {kind === 'image' ? (
                            // A local preview of an image just chosen or pasted.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={previews[i]} alt="" className="size-full object-cover" />
                          ) : (
                            <Icon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{f.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {kind ? KIND_LABEL[kind] : 'File'} · {formatBytes(f.size)}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`Take ${f.name} off`}
                          onClick={() => setFiles((prev) => prev.filter((_, n) => n !== i))}
                          disabled={busy}
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      {kind === 'voice' && <audio controls src={previews[i]} className="mt-2 h-10 w-full" />}
                    </li>
                  );
                })}
              </ul>
            )}

            {recording ? (
              <div className="flex items-center gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2">
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <span className="size-3 animate-pulse rounded-full bg-destructive" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  Recording <span className="tabular-nums text-muted-foreground">{clock(seconds)}</span>
                </span>
                <Button type="button" variant="ghost" className="h-8 rounded-full px-3 text-[13px]" onClick={() => stopRecording(true)}>
                  Discard
                </Button>
                <Button type="button" className="h-8 rounded-full px-3 text-[13px]" onClick={() => stopRecording(false)}>
                  <Square className="size-3 fill-current" />
                  Stop
                </Button>
              </div>
            ) : (
              count < FILES_MAX && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => picker.current?.click()}
                    disabled={busy}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    <Paperclip className="size-4 shrink-0" />
                    <span>
                      {count > 0 ? 'Add more files' : 'Attach files'}
                      <span className="block text-xs">Or paste images. Up to 1 GB each.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    disabled={busy}
                    className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    <Mic className="size-4 shrink-0" />
                    <span>
                      Record a voice note
                      <span className="block text-xs">Uses your microphone.</span>
                    </span>
                  </button>
                </div>
              )
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
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
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
          <Button className="rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90" onClick={() => void save()} disabled={busy || recording}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy && uploadPct !== null ? `Uploading ${uploadPct}%` : initial ? 'Save' : 'Post'}
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

  // The bucket is private: each file is reached through a link that expires.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [linksFailed, setLinksFailed] = useState(false);
  const paths = item ? filesOf(item).map((a) => a.path).join('\n') : '';
  useEffect(() => {
    setUrls({});
    setLinksFailed(false);
    if (!paths) return;
    let cancelled = false;
    void supabase.storage
      .from(TEAM_BOARD_BUCKET)
      .createSignedUrls(paths.split('\n'), 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) return setLinksFailed(true);
        const next: Record<string, string> = {};
        for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        setUrls(next);
        if (Object.keys(next).length === 0) setLinksFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  if (!post) return null;

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[640px] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="px-6 pb-4 pt-6 text-left">
          <DialogTitle>{kindLabelOf(post)}</DialogTitle>
          <DialogDescription>
            Put up by {memberName(post.creator)} on {formatDateTime(post.created_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-2 [scrollbar-width:thin]">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{post.body}</p>

          {(() => {
            const files = filesOf(post);
            if (!files.length) return null;
            const images = files.filter((a) => a.kind === 'image' && urls[a.path]);
            return (
              <div className="space-y-2">
                {images.length > 0 && (
                  <div className={cn('grid gap-2', images.length > 1 && 'grid-cols-2')}>
                    {images.map((a) => (
                      <a key={a.id} href={urls[a.path]} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-border">
                        {/* A signed, expiring link to a private file: next/image cannot optimise it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urls[a.path]} alt={a.name} className={cn('w-full', images.length > 1 ? 'h-36 object-cover' : 'max-h-[320px] object-contain')} />
                      </a>
                    ))}
                  </div>
                )}
                {files.map((a) => {
                  const Icon = FILE_ICON[a.kind];
                  const url = urls[a.path];
                  return (
                    <div key={a.id} className="rounded-2xl border border-border px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {KIND_LABEL[a.kind]} · {formatBytes(a.size_bytes)}
                          </span>
                        </span>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            Open
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : linksFailed ? (
                          <span className="shrink-0 text-xs text-destructive">Could not load</span>
                        ) : (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {a.kind === 'voice' && url && <audio controls src={url} className="mt-2 h-10 w-full" />}
                      {a.kind === 'video' && url && <video controls src={url} className="mt-2 max-h-[320px] w-full rounded-xl bg-black" />}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Who is it for</dt>
              <dd className="mt-0.5 text-foreground">{post.for_person?.name ?? 'Everyone'}</dd>
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

        {/* Phones: Delete and the star are icons only, so the row never wraps. */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 pb-6 pt-4">
          <Button
            variant="ghost"
            aria-label="Delete"
            className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive max-sm:size-10 max-sm:px-0"
            onClick={() => onDelete(post)}
          >
            <Trash2 className="size-4" />
            <span className="max-sm:hidden">Delete</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="rounded-full max-sm:size-10 max-sm:px-0"
              aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={starred}
              onClick={() => onStar(post)}
            >
              <Star className={cn('size-4', starred && 'fill-amber-400 text-amber-400')} />
              <span className="max-sm:hidden">{starred ? 'Favourite' : 'Add to favourites'}</span>
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => onEdit(post)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <DialogClose asChild>
              {/* Phones close with the X in the corner; the row has no room for a fourth button. */}
              <Button className="rounded-full max-sm:hidden">Close</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
