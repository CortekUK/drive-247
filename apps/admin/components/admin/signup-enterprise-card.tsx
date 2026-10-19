'use client';

/**
 * The Enterprise card (Oct 17 2026, Ghulam): always last on the pricing page,
 * never bought online — its button goes to a contact page. Edited in place like
 * the plan cards, but it is not a signup plan: it lives on
 * admin_settings.enterprise_card, so it can never reach a checkout, and New plan
 * never makes one. The public site reads it through public_enterprise_card().
 */

import { ArrowRight, Check, Loader2, Plus, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { INLINE } from './signup-plan-editable-card';

export interface EnterpriseCard {
  name: string;
  fleet_band: string;
  price_label: string;
  tagline: string;
  cta_label: string;
  cta_href: string;
  bullets: string[];
  is_visible: boolean;
}

const DEFAULT_CARD: EnterpriseCard = {
  name: 'Enterprise',
  fleet_band: '40+ vehicles',
  price_label: 'Let’s talk',
  tagline: 'For large and multi-location fleets that need custom terms.',
  cta_label: 'Contact us',
  cta_href: '/strategy-call',
  bullets: ['Sized for fleets of 40+ vehicles', 'Custom pricing and contract terms'],
  is_visible: true,
};

const BULLETS_MAX = 8;

function readCard(raw: unknown): EnterpriseCard {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CARD;
  const r = raw as Record<string, unknown>;
  const str = (k: keyof EnterpriseCard): string =>
    typeof r[k] === 'string' ? (r[k] as string) : (DEFAULT_CARD[k] as string);
  return {
    name: str('name'),
    fleet_band: str('fleet_band'),
    price_label: str('price_label'),
    tagline: str('tagline'),
    cta_label: str('cta_label'),
    cta_href: str('cta_href'),
    bullets: Array.isArray(r.bullets) ? r.bullets.filter((b): b is string => typeof b === 'string') : DEFAULT_CARD.bullets,
    is_visible: r.is_visible !== false,
  };
}

/** A site path ("/strategy-call"), an https link or a mailto. */
function linkProblem(href: string): string | null {
  const v = href.trim();
  if (!v) return 'Add where the button goes.';
  if (/^\/[^\s]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v) || /^mailto:[^\s@]+@[^\s@]+$/.test(v)) return null;
  return 'Use a page like /strategy-call, an https:// link or mailto:';
}

function cardProblem(card: EnterpriseCard): string | null {
  if (card.name.trim().length < 2) return 'Give the card a name.';
  if (!card.cta_label.trim()) return 'Give the button some text.';
  if (card.bullets.some((b) => !b.trim())) return 'Fill in or remove the empty bullet.';
  return linkProblem(card.cta_href);
}

export function SignupEnterpriseCard() {
  const [rowId, setRowId] = useState<string | null>(null);
  const [saved, setSaved] = useState<EnterpriseCard | null>(null);
  const [draft, setDraft] = useState<EnterpriseCard>(DEFAULT_CARD);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('id, enterprise_card')
        .order('created_at', { ascending: true })
        .limit(1);
      const row = ((data ?? []) as unknown as { id: string; enterprise_card: unknown }[])[0];
      if (error || !row) {
        toast.error('Couldn’t load the Enterprise card.');
        return;
      }
      const card = readCard(row.enterprise_card);
      setRowId(row.id);
      setSaved(card);
      setDraft(card);
    })();
  }, []);

  const write = useCallback(
    async (next: EnterpriseCard): Promise<boolean> => {
      if (!rowId) return false;
      const clean: EnterpriseCard = {
        ...next,
        name: next.name.trim(),
        fleet_band: next.fleet_band.trim(),
        price_label: next.price_label.trim(),
        tagline: next.tagline.trim(),
        cta_label: next.cta_label.trim(),
        cta_href: next.cta_href.trim(),
        bullets: next.bullets.map((b) => b.trim()),
      };
      setSaving(true);
      const { data, error } = await supabase
        .from('admin_settings')
        .update({ enterprise_card: clean, updated_at: new Date().toISOString() } as never)
        .eq('id', rowId)
        .select('id');
      setSaving(false);
      if (error || !data?.length) {
        toast.error(error?.message || 'Nothing was saved. Check you are signed in as a super admin.');
        return false;
      }
      setSaved(clean);
      return true;
    },
    [rowId],
  );

  if (!saved) {
    return <div className="h-[440px] animate-pulse rounded-3xl border border-border bg-card" aria-label="Loading the Enterprise card" />;
  }

  const set = (patch: Partial<EnterpriseCard>): void => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify({ ...draft, is_visible: saved.is_visible }) !== JSON.stringify(saved);
  const problem = cardProblem(draft);

  const toggleVisible = async (next: boolean): Promise<void> => {
    if (await write({ ...saved, is_visible: next })) {
      setDraft((d) => ({ ...d, is_visible: next }));
      toast.success(next ? 'The Enterprise card is on the pricing page.' : 'The Enterprise card is off the pricing page.');
    }
  };

  const save = async (): Promise<void> => {
    if (problem) return;
    if (await write({ ...draft, is_visible: saved.is_visible })) toast.success('Enterprise card saved — the pricing page shows it now.');
  };

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Enterprise card">
      <div
        className={cn(
          'relative flex flex-col rounded-3xl border border-dashed border-primary/40 bg-card p-5 transition-colors',
          !saved.is_visible && 'opacity-60',
        )}
      >
        <span className="absolute -top-3 left-5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {saved.is_visible ? 'Last on the pricing page · contact only' : 'Off'}
        </span>

        <div className="absolute right-3 top-3 flex items-center gap-1">
          {saving ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <Switch
              checked={saved.is_visible}
              onCheckedChange={(v) => void toggleVisible(v)}
              aria-label={saved.is_visible ? 'Turn the Enterprise card off' : 'Turn the Enterprise card on'}
            />
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Enterprise card settings"
            title="Where the button goes"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-primary motion-reduce:transition-none"
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </button>
        </div>

        <input
          value={draft.name}
          maxLength={40}
          disabled={saving}
          placeholder="Card name"
          aria-label="Card name"
          onChange={(e) => set({ name: e.target.value })}
          className={cn(INLINE, 'h-8 pr-[5.5rem] text-lg font-semibold tracking-tight text-foreground')}
        />
        <input
          value={draft.fleet_band}
          maxLength={40}
          disabled={saving}
          placeholder="Fleet band"
          aria-label="Fleet band"
          onChange={(e) => set({ fleet_band: e.target.value })}
          className={cn(INLINE, 'mt-1 h-6 text-[11px] font-medium uppercase tracking-[0.14em] text-primary')}
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Chip>No online checkout</Chip>
          <Chip>Button → {draft.cta_href || '—'}</Chip>
        </div>

        {/* Where a plan has its price */}
        <input
          value={draft.price_label}
          maxLength={24}
          disabled={saving}
          placeholder="Let’s talk"
          aria-label="Price line, shown where the other cards show a price"
          onChange={(e) => set({ price_label: e.target.value })}
          className={cn(INLINE, 'mt-3 h-10 text-3xl font-bold tracking-tighter text-foreground')}
        />
        <p className="mt-0.5 text-[11px] text-muted-foreground">Shown where the other cards show a price.</p>

        <textarea
          value={draft.tagline}
          maxLength={160}
          disabled={saving}
          rows={2}
          placeholder="Tagline appears here."
          aria-label="Tagline"
          onChange={(e) => set({ tagline: e.target.value })}
          className={cn(INLINE, 'mt-2 resize-none py-1 text-[13px] leading-snug text-muted-foreground')}
        />

        {/* The button: its text is edited right on it. */}
        <div className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground">
          <input
            value={draft.cta_label}
            maxLength={30}
            disabled={saving}
            aria-label="Button text"
            onChange={(e) => set({ cta_label: e.target.value })}
            style={{ width: `calc(${Math.max(4, draft.cta_label.length)}ch + 8px)` }}
            className="min-w-0 rounded-md bg-transparent px-1 text-center outline-none placeholder:text-primary-foreground/60 hover:bg-white/10 focus:bg-white/15"
            placeholder="Contact us"
          />
          <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
        </div>

        <ul className="mt-4 space-y-1 border-t border-border pt-3" aria-label="Bullets">
          {draft.bullets.map((bullet, index) => (
            <li key={index} className="group/bullet relative flex items-start gap-1.5">
              <Check className="mt-[7px] size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <input
                value={bullet}
                maxLength={120}
                disabled={saving}
                placeholder="A line about the card"
                aria-label={`Bullet ${index + 1}`}
                onChange={(e) => set({ bullets: draft.bullets.map((b, i) => (i === index ? e.target.value : b)) })}
                className={cn(INLINE, 'h-7 text-[13px] text-foreground')}
              />
              <button
                type="button"
                aria-label={`Remove bullet ${index + 1}`}
                disabled={saving}
                onClick={() => set({ bullets: draft.bullets.filter((_, i) => i !== index) })}
                className="pointer-events-none absolute right-0 top-0 flex size-7 items-center justify-center rounded-full bg-card text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-200 hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/bullet:pointer-events-auto group-hover/bullet:opacity-100 motion-reduce:transition-none"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={saving || draft.bullets.length >= BULLETS_MAX}
          onClick={() => set({ bullets: [...draft.bullets, ''] })}
          className="mt-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add bullet
          <span className="font-normal">
            {draft.bullets.length}/{BULLETS_MAX}
          </span>
        </button>

        {dirty && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button className="rounded-full" size="sm" disabled={saving || Boolean(problem)} onClick={() => void save()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save card content'}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" disabled={saving} onClick={() => setDraft(saved)}>
              Discard changes
            </Button>
            {problem && <span className="text-xs text-destructive">{problem}</span>}
          </div>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Where the button goes</DialogTitle>
            <DialogDescription>
              A page on drive-247.com like /strategy-call, any https:// link, or mailto: with an email address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="enterprise-href">Button link</Label>
            <Input
              id="enterprise-href"
              value={draft.cta_href}
              placeholder="/strategy-call"
              onChange={(e) => set({ cta_href: e.target.value })}
            />
            {linkProblem(draft.cta_href) && <p className="text-xs text-destructive">{linkProblem(draft.cta_href)}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setSettingsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-secondary px-2 py-0.5">{children}</span>;
}
