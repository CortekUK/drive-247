'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Megaphone, Plus, Pencil, Eye, Archive, Trash2, Upload } from 'lucide-react';
import AnnouncementPreview from '@/components/announcements/AnnouncementPreview';

interface Announcement {
  id: string;
  title: string;
  summary: string | null;
  body_html: string | null;
  body_format: 'html' | 'markdown';
  image_url: string | null;
  video_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  severity: 'major' | 'minor' | 'critical' | 'info';
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  is_active: boolean;
  published_at: string | null;
  expires_at: string | null;
  sort_priority: number;
  created_at: string;
  updated_at: string;
}

interface AnnouncementStats {
  announcement_id: string;
  seen_count: number;
  dismissed_count: number;
}

const emptyForm: Partial<Announcement> = {
  title: '',
  summary: '',
  body_html: '',
  body_format: 'html',
  image_url: '',
  video_url: '',
  cta_label: '',
  cta_url: '',
  severity: 'minor',
  status: 'draft',
  is_active: true,
  published_at: null,
  expires_at: null,
  sort_priority: 0,
};

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [stats, setStats] = useState<Record<string, AnnouncementStats>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<Announcement | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState<Partial<Announcement>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('feature_announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems((data || []) as Announcement[]);

      const { data: statsData } = await supabase
        .from('feature_announcement_stats')
        .select('announcement_id, seen_count, dismissed_count');
      const map: Record<string, AnnouncementStats> = {};
      (statsData || []).forEach((s: any) => {
        map[s.announcement_id] = s;
      });
      setStats(map);
    } catch (err: any) {
      toast.error(`Failed to load announcements: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const visible = items.filter((it) => {
    if (filter === 'all') return true;
    return it.status === filter;
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };

  const openEdit = (item: Announcement) => {
    setEditing(item);
    setForm({
      ...item,
      published_at: item.published_at ? toLocalInput(item.published_at) : '',
      expires_at: item.expires_at ? toLocalInput(item.expires_at) : '',
    });
    setEditorOpen(true);
  };

  const handleUpload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File must be under 25MB');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from('announcement-media')
        .upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from('announcement-media').getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: data.publicUrl }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.title?.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        title: form.title,
        summary: form.summary || null,
        body_html: form.body_html || null,
        body_format: form.body_format || 'html',
        image_url: form.image_url || null,
        video_url: form.video_url || null,
        cta_label: form.cta_label || null,
        cta_url: form.cta_url || null,
        severity: form.severity || 'minor',
        status: form.status || 'draft',
        is_active: form.is_active ?? true,
        published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        sort_priority: form.sort_priority ?? 0,
      };

      if (form.status === 'published' && !payload.published_at) {
        payload.published_at = new Date().toISOString();
      }

      if (editing) {
        const { error } = await supabase
          .from('feature_announcements')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Announcement updated');
      } else {
        const { error } = await supabase.from('feature_announcements').insert(payload);
        if (error) throw error;
        toast.success('Announcement created');
      }
      setEditorOpen(false);
      load();
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (id: string) => {
    try {
      const { error } = await supabase
        .from('feature_announcements')
        .update({ status: 'archived', is_active: false })
        .eq('id', id);
      if (error) throw error;
      toast.success('Archived');
      load();
    } catch (err: any) {
      toast.error(`Archive failed: ${err.message}`);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Permanently delete this announcement and all view records? This cannot be undone.'))
      return;
    try {
      const { error } = await supabase.from('feature_announcements').delete().eq('id', id);
      if (error) throw error;
      toast.success('Deleted');
      load();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <TableSkeleton
        rows={5}
        columns={6}
        title="Announcements"
        subtitle="Publish what's-new updates to all customers across all tenants"
        showButton
      />
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Megaphone className="h-7 w-7 text-primary" />
            Announcements
          </h1>
          <p className="mt-2 text-gray-400">
            Publish what's-new updates to all customers across all tenants
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New announcement
        </Button>
      </div>

      <div className="mb-6 flex space-x-2">
        {['all', 'draft', 'scheduled', 'published', 'archived'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg font-medium capitalize text-sm ${
              filter === status
                ? 'bg-primary-600 text-white'
                : 'bg-dark-card text-gray-300 hover:bg-dark-hover border border-dark-border'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="bg-dark-card rounded-lg shadow overflow-hidden border border-dark-border">
        <table className="min-w-full divide-y divide-dark-border">
          <thead className="bg-dark-bg">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Title</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Severity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Published</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Reach</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-dark-card divide-y divide-dark-border">
            {visible.map((item) => {
              const s = stats[item.id];
              return (
                <tr key={item.id} className="hover:bg-dark-hover">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-white">{item.title}</div>
                    {item.summary && (
                      <div className="text-xs text-gray-500 mt-1 max-w-md truncate">
                        {item.summary}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold capitalize ${
                        item.severity === 'critical'
                          ? 'text-red-400'
                          : item.severity === 'major'
                            ? 'text-amber-400'
                            : item.severity === 'minor'
                              ? 'text-blue-400'
                              : 'text-gray-400'
                      }`}
                    >
                      {item.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`text-xs font-semibold capitalize ${
                        item.status === 'published'
                          ? 'text-green-400'
                          : item.status === 'scheduled'
                            ? 'text-blue-400'
                            : item.status === 'archived'
                              ? 'text-gray-500'
                              : 'text-yellow-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                    {item.published_at
                      ? new Date(item.published_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                    {s ? (
                      <>
                        <span className="text-white font-medium">{s.seen_count}</span>
                        <span className="text-gray-500"> seen · </span>
                        <span className="text-gray-300">{s.dismissed_count}</span>
                        <span className="text-gray-500"> dismissed</span>
                      </>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPreviewItem(item);
                        setPreviewOpen(true);
                      }}
                      title="Preview"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(item)} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {item.status !== 'archived' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => archive(item.id)}
                        title="Archive"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(item.id)}
                      title="Delete"
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="text-center py-12">
            <Megaphone className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No announcements yet.</p>
            <Button onClick={openCreate} className="mt-4">
              <Plus className="h-4 w-4" />
              Create your first
            </Button>
          </div>
        )}
      </div>

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit announcement' : 'New announcement'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={form.title || ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="What's new in 2.0"
              />
            </div>

            <div>
              <Label htmlFor="summary">Summary (shown in drawer)</Label>
              <Input
                id="summary"
                value={form.summary || ''}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                placeholder="One-line teaser"
              />
            </div>

            <div>
              <Label htmlFor="body">Body (HTML allowed — sanitized on render)</Label>
              <Textarea
                id="body"
                rows={6}
                value={form.body_html || ''}
                onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                placeholder="<p>Big news! We just shipped...</p>"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <Label>Hero image</Label>
              <div className="flex items-center gap-3">
                {form.image_url ? (
                  <img
                    src={form.image_url}
                    alt=""
                    className="h-16 w-24 object-cover rounded border border-dark-border"
                  />
                ) : (
                  <div className="h-16 w-24 bg-dark-bg rounded border border-dark-border flex items-center justify-center text-gray-600 text-xs">
                    No image
                  </div>
                )}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                    }}
                  />
                  <span className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-dark-bg border border-dark-border hover:bg-dark-hover">
                    <Upload className="h-4 w-4" />
                    {uploading ? 'Uploading…' : 'Upload'}
                  </span>
                </label>
                {form.image_url && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm({ ...form, image_url: '' })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cta_label">CTA label</Label>
                <Input
                  id="cta_label"
                  value={form.cta_label || ''}
                  onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
                  placeholder="Learn more"
                />
              </div>
              <div>
                <Label htmlFor="cta_url">CTA URL</Label>
                <Input
                  id="cta_url"
                  value={form.cta_url || ''}
                  onChange={(e) => setForm({ ...form, cta_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v: any) => setForm({ ...form, severity: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="major">Major (modal + drawer)</SelectItem>
                    <SelectItem value="minor">Minor (drawer only)</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v: any) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="published_at">Publish at</Label>
                <Input
                  id="published_at"
                  type="datetime-local"
                  value={(form.published_at as string) || ''}
                  onChange={(e) => setForm({ ...form, published_at: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="expires_at">Expires at</Label>
                <Input
                  id="expires_at"
                  type="datetime-local"
                  value={(form.expires_at as string) || ''}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPreviewItem({ ...(form as Announcement), id: 'preview' });
                setPreviewOpen(true);
              }}
            >
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Customer preview</DialogTitle>
          </DialogHeader>
          {previewItem && <AnnouncementPreview item={previewItem} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tzOffset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}
