'use client';

/**
 * Testimonials — the operator quotes on the drive-247.com landing page
 * ("Operators building on Drive247").
 *
 * Rows live in `operator_testimonials` (super-admin RLS for writes; anon reads
 * published rows). The landing page reads them on every request, so a save here
 * shows on the next reload of the site. The first row by order is the
 * full-width featured card; the rest sit two-up beneath it.
 *
 * `highlight` is a phrase copied from inside the quote that the site bolds.
 */

import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { TestimonialsEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Loader2, MessageSquareQuote, Pencil, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Testimonial {
  id: string;
  operator_name: string;
  role: string | null;
  fleet_size: number | null;
  location: string | null;
  rating: number;
  quote: string;
  highlight: string | null;
  is_published: boolean;
  sort_order: number;
  updated_at: string;
}

interface Draft {
  operator_name: string;
  role: string;
  fleet_size: string;
  location: string;
  rating: number;
  quote: string;
  highlight: string;
  is_published: boolean;
}

const EMPTY: Draft = {
  operator_name: '',
  role: '',
  fleet_size: '',
  location: '',
  rating: 5,
  quote: '',
  highlight: '',
  is_published: true,
};

const SITE_URL = 'https://drive-247.com';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = (
          <Star
            className={cn('h-4 w-4', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
          />
        );
        return onChange ? (
          <button key={n} type="button" aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n)}>
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}

/** The quote as the site renders it: the highlight in bold if it appears. */
function QuotePreview({ quote, highlight }: { quote: string; highlight: string | null }) {
  const h = highlight?.trim();
  const at = h ? quote.indexOf(h) : -1;
  if (!h || at < 0) return <>{quote}</>;
  return (
    <>
      {quote.slice(0, at)}
      <strong className="font-semibold text-foreground">{h}</strong>
      {quote.slice(at + h.length)}
    </>
  );
}

function subtitle(t: { role: string | null; fleet_size: number | null; location: string | null }) {
  return [t.role, t.fleet_size ? `${t.fleet_size}-vehicle fleet` : null, t.location].filter(Boolean).join(' · ');
}

export function TestimonialsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Testimonial[]>([]);
  const [editing, setEditing] = useState<Testimonial | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Testimonial | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await db
        .from('operator_testimonials')
        .select('id, operator_name, role, fleet_size, location, rating, quote, highlight, is_published, sort_order, updated_at')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setRows((data as Testimonial[]) ?? []);
    } catch (e) {
      toast.error('Could not load testimonials', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setDraft(EMPTY);
    setEditing('new');
  };

  const openEdit = (t: Testimonial) => {
    setDraft({
      operator_name: t.operator_name,
      role: t.role ?? '',
      fleet_size: t.fleet_size ? String(t.fleet_size) : '',
      location: t.location ?? '',
      rating: t.rating,
      quote: t.quote,
      highlight: t.highlight ?? '',
      is_published: t.is_published,
    });
    setEditing(t);
  };

  const fleet = draft.fleet_size.trim() ? Number(draft.fleet_size) : null;
  const fleetInvalid = fleet !== null && (!Number.isInteger(fleet) || fleet < 1);
  const highlightMissing = !!draft.highlight.trim() && !draft.quote.includes(draft.highlight.trim());
  const canSave = !!draft.operator_name.trim() && !!draft.quote.trim() && !fleetInvalid && !saving;

  const save = async () => {
    if (!canSave || !editing) return;
    setSaving(true);
    const payload = {
      operator_name: draft.operator_name.trim(),
      role: draft.role.trim() || null,
      fleet_size: fleet,
      location: draft.location.trim() || null,
      rating: draft.rating,
      quote: draft.quote.trim(),
      highlight: draft.highlight.trim() || null,
      is_published: draft.is_published,
    };
    try {
      if (editing === 'new') {
        const nextOrder = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
        const { error } = await db
          .from('operator_testimonials')
          .insert({ ...payload, sort_order: nextOrder, created_by: user?.id ?? null });
        if (error) throw error;
        toast.success('Testimonial added');
      } else {
        const { error } = await db.from('operator_testimonials').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Testimonial updated');
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error('Could not save the testimonial', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      const { error } = await db.from('operator_testimonials').delete().eq('id', deleting.id);
      if (error) throw error;
      setRows((r) => r.filter((x) => x.id !== deleting.id));
      toast.success('Testimonial deleted');
      setDeleting(null);
    } catch (e) {
      toast.error('Could not delete the testimonial', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const togglePublished = async (t: Testimonial) => {
    setBusy(t.id);
    try {
      const { error } = await db.from('operator_testimonials').update({ is_published: !t.is_published }).eq('id', t.id);
      if (error) throw error;
      setRows((r) => r.map((x) => (x.id === t.id ? { ...x, is_published: !t.is_published } : x)));
    } catch (e) {
      toast.error('Could not update the testimonial', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  /** Swap with the neighbour, then renumber every row 0..n so ties can't stick. */
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(renumbered);
    setBusy(rows[index].id);
    try {
      const changed = renumbered.filter((r) => rows.find((o) => o.id === r.id)?.sort_order !== r.sort_order);
      const results = await Promise.all(
        changed.map((r) => db.from('operator_testimonials').update({ sort_order: r.sort_order }).eq('id', r.id)),
      );
      const failed = results.find((res: { error: unknown }) => res.error);
      if (failed) throw failed.error;
    } catch (e) {
      toast.error('Could not reorder', { description: (e as Error).message });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const publishedCount = rows.filter((r) => r.is_published).length;
  const featuredId = rows.find((r) => r.is_published)?.id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <MessageSquareQuote className="h-5 w-5 text-primary" />
                Testimonials
              </CardTitle>
              <CardDescription>
                Operator quotes shown in “Operators building on Drive247” on the{' '}
                <a href={SITE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  landing page <ExternalLink className="h-3 w-3" />
                </a>
                . The first published quote is the large featured card; the rest show two per row. Changes appear on the
                next page load.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button size="sm" className="gap-1.5" onClick={openNew} disabled={!canEdit}>
                <Plus className="h-4 w-4" />
                Add testimonial
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {publishedCount} published · {rows.length - publishedCount} hidden
            {publishedCount === 0 && rows.length > 0 && ' — the section is hidden on the site until one is published.'}
          </p>
          {!canEdit && (
            <p className="pt-2 text-sm text-muted-foreground">Read-only: managing testimonials needs a super admin account.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <EmptyState
              size="section"
              illustration={<TestimonialsEmptyArt />}
              headline="No testimonials yet"
              body="The section stays hidden on drive-247.com until there is one. Use “Add testimonial” to create it."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="max-md:min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">Order</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead className="min-w-[320px]">Quote</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Shown</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t, i) => (
                    <TableRow key={t.id} className={cn(!t.is_published && 'opacity-60')}>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Move up"
                            disabled={!canEdit || i === 0 || !!busy}
                            onClick={() => void move(i, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Move down"
                            disabled={!canEdit || i === rows.length - 1 || !!busy}
                            onClick={() => void move(i, 1)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          {t.operator_name}
                          {t.id === featuredId && <Badge variant="secondary">Featured</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{subtitle(t) || '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <p className="line-clamp-3">
                          “<QuotePreview quote={t.quote} highlight={t.highlight} />”
                        </p>
                      </TableCell>
                      <TableCell>
                        <Stars value={t.rating} />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={t.is_published}
                          disabled={!canEdit || busy === t.id}
                          onCheckedChange={() => void togglePublished(t)}
                          aria-label="Show on the landing page"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="gap-1.5" disabled={!canEdit} onClick={() => openEdit(t)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={!canEdit || busy === t.id}
                            onClick={() => setDeleting(t)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── create / edit ─────────────────────────────────────────────────── */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && !saving && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add testimonial' : 'Edit testimonial'}</DialogTitle>
            <DialogDescription>Shown publicly on drive-247.com once published.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Operator name *</Label>
              <Input
                id="t-name"
                value={draft.operator_name}
                maxLength={120}
                placeholder="Marcus Thompson"
                onChange={(e) => setDraft({ ...draft, operator_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-role">Role / title</Label>
              <Input
                id="t-role"
                value={draft.role}
                maxLength={120}
                placeholder="Owner"
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-fleet">Fleet size (vehicles)</Label>
              <Input
                id="t-fleet"
                type="number"
                min={1}
                inputMode="numeric"
                value={draft.fleet_size}
                placeholder="12"
                onChange={(e) => setDraft({ ...draft, fleet_size: e.target.value })}
              />
              {fleetInvalid && <p className="text-xs text-destructive">Enter a whole number of vehicles.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-location">Location</Label>
              <Input
                id="t-location"
                value={draft.location}
                maxLength={120}
                placeholder="Atlanta"
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Rating</Label>
              <Stars value={draft.rating} onChange={(n) => setDraft({ ...draft, rating: n })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="t-quote">Testimonial *</Label>
              <Textarea
                id="t-quote"
                rows={4}
                maxLength={1000}
                value={draft.quote}
                placeholder="We went from juggling spreadsheets to running everything from one dashboard…"
                onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
              />
              <p className="text-right text-xs text-muted-foreground">{draft.quote.length}/1000</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="t-highlight">Bold phrase (optional)</Label>
              <Input
                id="t-highlight"
                value={draft.highlight}
                maxLength={300}
                placeholder="Bookings doubled within the first quarter."
                onChange={(e) => setDraft({ ...draft, highlight: e.target.value })}
              />
              <p className={cn('text-xs', highlightMissing ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                {highlightMissing
                  ? 'This phrase isn’t in the testimonial exactly as typed, so nothing will be bolded.'
                  : 'Copy a phrase from the testimonial to show it in bold.'}
              </p>
            </div>
            <label className="flex items-center gap-3 sm:col-span-2">
              <Switch
                checked={draft.is_published}
                onCheckedChange={(v) => setDraft({ ...draft, is_published: v })}
              />
              <span className="text-sm">Show on the landing page</span>
            </label>
          </div>

          {/* Preview, styled like the site card */}
          {draft.quote.trim() && (
            <div className="rounded-2xl border bg-card p-5">
              <Stars value={draft.rating} />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                “<QuotePreview quote={draft.quote.trim()} highlight={draft.highlight} />”
              </p>
              <div className="mt-4 border-t pt-3">
                <p className="text-sm font-semibold">{draft.operator_name.trim() || 'Operator name'}</p>
                <p className="text-xs text-muted-foreground">
                  {subtitle({
                    role: draft.role.trim() || null,
                    fleet_size: fleetInvalid ? null : fleet,
                    location: draft.location.trim() || null,
                  })}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave} className="gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing === 'new' ? 'Add testimonial' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ────────────────────────────────────────────────── */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && !busy && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete testimonial?</DialogTitle>
            <DialogDescription>
              {deleting?.operator_name}’s quote will be removed from the site and can’t be recovered. To take it down
              temporarily, switch off “Shown” instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={!!busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={!!busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
