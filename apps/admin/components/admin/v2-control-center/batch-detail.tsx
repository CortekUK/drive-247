'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  FileText,
  Plus,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  ShieldOff,
} from 'lucide-react';
import { RolloutPanel } from './rollout-panel';
import type { Batch, BatchFile, BatchStatus, ChecklistItem, TenantBatch, TenantLite } from './types';
import {
  BATCH_STATUSES,
  BATCH_TAGS,
  STATUS_META,
  TAG_LABELS,
  describeDbError,
  formatBytes,
  formatWhen,
} from './types';

const BUCKET = 'batch-files';

interface BatchDetailProps {
  batch: Batch;
  tenants: TenantLite[];
  rollouts: TenantBatch[];
  actor: string;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}

/** The free-text fields, which save together rather than per keystroke. */
interface Draft {
  title: string;
  description: string;
  branch: string;
  owner: string;
  area: string;
  notes: string;
}

function draftOf(batch: Batch): Draft {
  return {
    title: batch.title,
    description: batch.description ?? '',
    branch: batch.branch ?? '',
    owner: batch.owner ?? '',
    area: batch.area ?? '',
    notes: batch.notes ?? '',
  };
}

export function BatchDetail({
  batch,
  tenants,
  rollouts,
  actor,
  onChanged,
  onDeleted,
}: BatchDetailProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(batch));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selecting a different batch must reset the form, not carry the previous
  // batch's half-typed values across.
  useEffect(() => {
    setDraft(draftOf(batch));
    setConfirmDelete(false);
  }, [batch]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setFilesLoading(true);
      const { data, error } = await supabase
        .from('batch_files')
        .select('*')
        .eq('batch_id', batch.id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(`Could not load files: ${error.message}`);
        setFiles([]);
      } else {
        setFiles((data ?? []) as BatchFile[]);
      }
      setFilesLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [batch.id]);

  const dirty = useMemo(() => {
    const original = draftOf(batch);
    return (Object.keys(original) as (keyof Draft)[]).some((k) => original[k] !== draft[k]);
  }, [batch, draft]);

  const done = batch.checklist.filter((i) => i.done).length;

  /** Every write to `batches` funnels through here so errors read the same way. */
  const patchBatch = async (patch: Record<string, unknown>, successMessage?: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('batches').update(patch).eq('id', batch.id);
      if (error) throw error;
      if (successMessage) toast.success(successMessage);
      await onChanged();
      return true;
    } catch (error) {
      toast.error(describeDbError(error, 'Could not save the batch'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft.title.trim()) {
      toast.error('A batch needs a title');
      return;
    }
    setSaving(true);
    await patchBatch(
      {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        branch: draft.branch.trim() || null,
        owner: draft.owner.trim() || null,
        // Empty string would claim the "" area in the uniqueness index, so
        // blank always means NULL here.
        area: draft.area.trim() || null,
        notes: draft.notes.trim() || null,
      },
      'Batch saved',
    );
    setSaving(false);
  };

  const toggleTag = async (tag: string) => {
    const next = batch.tags.includes(tag)
      ? batch.tags.filter((t) => t !== tag)
      : [...batch.tags, tag];
    await patchBatch({ tags: next });
  };

  const writeChecklist = async (next: ChecklistItem[]) => {
    await patchBatch({ checklist: next });
  };

  const addChecklistItem = async () => {
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    await writeChecklist([
      ...batch.checklist,
      { id: crypto.randomUUID(), text, done: false, done_at: null, done_by: null },
    ]);
  };

  const toggleChecklistItem = async (item: ChecklistItem) => {
    const nowDone = !item.done;
    await writeChecklist(
      batch.checklist.map((i) =>
        i.id === item.id
          ? {
              ...i,
              done: nowDone,
              // Clearing the stamps on un-tick matters: a leftover "done by
              // Ghulam" on an unticked item reads as if the work was undone by
              // whoever is named, which is not what happened.
              done_at: nowDone ? new Date().toISOString() : null,
              done_by: nowDone ? actor : null,
            }
          : i,
      ),
    );
  };

  const removeChecklistItem = async (id: string) => {
    await writeChecklist(batch.checklist.filter((i) => i.id !== id));
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const path = `${batch.id}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from('batch_files')
        .insert({
          batch_id: batch.id,
          file_name: file.name,
          file_url: path,
          file_size: file.size,
          uploaded_by: actor,
        })
        .select()
        .single();

      // The object is already in the bucket at this point; a failed row would
      // orphan it forever, so take it back out rather than leave litter.
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }

      setFiles((prev) => [data as BatchFile, ...prev]);
      toast.success(`Uploaded ${file.name}`);
    } catch (error) {
      toast.error(describeDbError(error, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // The bucket is private, so there is no durable URL to store — a link is
  // minted per click and expires.
  const downloadFile = async (file: BatchFile) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.file_url, 60);
    if (error || !data) {
      toast.error(`Could not open ${file.file_name}: ${error?.message ?? 'no signed URL'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const deleteFile = async (file: BatchFile) => {
    const { error } = await supabase.from('batch_files').delete().eq('id', file.id);
    if (error) {
      toast.error(`Could not remove ${file.file_name}: ${error.message}`);
      return;
    }
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([file.file_url]);
    if (storageError) console.warn('Could not remove batch file object:', storageError.message);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  };

  const deleteBatch = async () => {
    setBusy(true);
    try {
      // Objects first: the rows cascade away with the batch, and once they are
      // gone nothing remembers the paths to clean up.
      const paths = files.map((f) => f.file_url);
      if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);

      const { error } = await supabase.from('batches').delete().eq('id', batch.id);
      if (error) throw error;
      toast.success(`Batch ${batch.key} deleted`);
      await onDeleted();
    } catch (error) {
      toast.error(describeDbError(error, 'Could not delete the batch'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className="font-mono uppercase shrink-0">
                {batch.key}
              </Badge>
              <CardTitle className="text-base truncate">{batch.title}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={batch.status}
                onValueChange={(value) => patchBatch({ status: value as BatchStatus })}
              >
                <SelectTrigger className="h-9 w-[172px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BATCH_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Kill-switch */}
          <div
            className={cn(
              'flex items-start justify-between gap-4 rounded-md border px-3 py-2.5',
              batch.killswitch
                ? 'border-destructive/40 bg-destructive/10'
                : 'border-border bg-secondary/30',
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              <ShieldOff
                className={cn(
                  'h-4 w-4 mt-0.5 shrink-0',
                  batch.killswitch ? 'text-red-400' : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">Kill-switch</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {batch.killswitch
                    ? 'ON — every tenant is off this batch. Per-tenant rows are untouched, so turning it off restores the exact rollout below.'
                    : 'Off. Turn on to pull this batch from every tenant at once without losing the rollout.'}
                </p>
              </div>
            </div>
            <Switch
              checked={batch.killswitch}
              disabled={busy}
              onCheckedChange={(next) =>
                patchBatch(
                  { killswitch: next },
                  next ? `Kill-switch ON for ${batch.key}` : `Kill-switch off for ${batch.key}`,
                )
              }
              className={cn('mt-0.5 shrink-0', batch.killswitch && 'bg-destructive')}
            />
          </div>

          {/* Tags */}
          <div>
            <Label className="mb-2 block">Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {BATCH_TAGS.map((tag) => {
                const on = batch.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50',
                      on
                        ? 'border-primary/30 bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary',
                    )}
                  >
                    {TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Free-text fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Title</Label>
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Description</Label>
              <Textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this batch changes, and what it replaces."
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Branch</Label>
              <Input
                value={draft.branch}
                onChange={(e) => setDraft({ ...draft, branch: e.target.value })}
                placeholder="v2/b1-dashboard"
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Owner</Label>
              <Input
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                placeholder="Who is building it"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Area</Label>
              <Input
                value={draft.area}
                onChange={(e) => setDraft({ ...draft, area: e.target.value })}
                placeholder="portal/dashboard"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                The screen this batch owns. Only one live batch may claim an area — completing or
                rejecting a batch releases it.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Notes</Label>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Anything the next person needs to know."
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Updated {formatWhen(batch.updated_at)}
            </p>
            <Button onClick={saveDraft} disabled={!dirty || saving}>
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Checklist ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Checklist</CardTitle>
            <Badge variant={batch.checklist.length > 0 && done === batch.checklist.length ? 'success' : 'outline'}>
              {done} / {batch.checklist.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {batch.checklist.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
              No checklist items yet.
            </p>
          ) : (
            batch.checklist.map((item) => (
              <div
                key={item.id}
                className="group flex items-start gap-3 rounded-md border border-border px-3 py-2"
              >
                <Checkbox
                  checked={item.done}
                  disabled={busy}
                  onCheckedChange={() => toggleChecklistItem(item)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm',
                      item.done && 'line-through text-muted-foreground',
                    )}
                  >
                    {item.text}
                  </p>
                  {item.done && (item.done_by || item.done_at) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {item.done_by ?? 'unknown'} · {formatWhen(item.done_at)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeChecklistItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Remove "${item.text}"`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))
          )}

          <div className="flex gap-2 pt-1">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addChecklistItem();
                }
              }}
              placeholder="Add a checklist item"
              className="flex-1"
            />
            <Button variant="secondary" onClick={addChecklistItem} disabled={busy || !newItem.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Files ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Files</CardTitle>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filesLoading ? (
            <p className="text-xs text-muted-foreground px-1">Loading files…</p>
          ) : files.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
              No files attached. Specs, screenshots and before/afters go here.
            </p>
          ) : (
            files.map((file) => (
              <div
                key={file.id}
                className="group flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{file.file_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {formatBytes(file.file_size)}
                    {file.uploaded_by ? ` · ${file.uploaded_by}` : ''} ·{' '}
                    {formatWhen(file.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => downloadFile(file)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={`Download ${file.file_name}`}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteFile(file)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Remove ${file.file_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Rollout ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <RolloutPanel
            batch={batch}
            tenants={tenants}
            rollouts={rollouts}
            actor={actor}
            onChanged={onChanged}
          />
        </CardContent>
      </Card>

      {/* ── Delete ────────────────────────────────────────────────────── */}
      <Card className="border-destructive/40">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Delete this batch</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Removes the batch, its files and its whole rollout history. To take a batch off
                  every tenant without losing that record, use the kill-switch instead.
                </p>
              </div>
            </div>
            {confirmDelete ? (
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={deleteBatch}>
                  Yes, delete {batch.key}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator className="opacity-0" />
    </div>
  );
}
