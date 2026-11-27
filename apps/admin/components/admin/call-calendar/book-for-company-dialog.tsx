'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { db, errorText, flushMailer } from './shared';
import { formatFull, isZone, timeZones, zoneLabel } from './time';
import { SlotPicker } from './slot-picker';

interface Company {
  id: string;
  company_name: string | null;
  slug: string;
  timezone: string | null;
  admin_name: string | null;
  admin_email: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  phone: string | null;
}

/** Bryan books a call for a company that asked by phone or WhatsApp (spec 10.12, 05.15). */
export function BookForCompanyDialog({
  open,
  hostTz,
  onClose,
  onBooked,
}: {
  open: boolean;
  hostTz: string;
  onClose: () => void;
  onBooked: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Company[] | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [zone, setZone] = useState(hostTz);
  const [time, setTime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => {
    const list = timeZones();
    return list.includes(zone) ? list : [zone, ...list];
  }, [zone]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setCompany(null);
    setName('');
    setEmail('');
    setPhone('');
    setNotes('');
    setZone(hostTz);
    setTime(null);
  }, [open, hostTz]);

  useEffect(() => {
    if (!open || company) return;
    const q = query.replace(/[%,()*]/g, ' ').trim();
    let live = true;
    const t = setTimeout(async () => {
      let req = db
        .from('tenants')
        .select('id, company_name, slug, timezone, admin_name, admin_email, contact_email, contact_phone, phone')
        .order('company_name')
        .limit(8);
      if (q) req = req.or(`company_name.ilike.%${q}%,slug.ilike.%${q}%`);
      const { data, error } = await req;
      if (!live) return;
      if (error) {
        toast.error(errorText(error));
        setResults([]);
        return;
      }
      setResults((data ?? []) as Company[]);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, open, company]);

  const pick = (c: Company) => {
    setCompany(c);
    setName(c.admin_name ?? '');
    setEmail(c.admin_email ?? c.contact_email ?? '');
    setPhone(c.contact_phone ?? c.phone ?? '');
    setZone(isZone(c.timezone) ? c.timezone : hostTz);
  };

  const ready = company && time && name.trim() && email.includes('@');

  const book = async () => {
    if (!company || !time) return;
    const label = company.company_name || company.slug;
    const ok = await confirmDialog({
      title: `Book ${label} for ${formatFull(time, hostTz)}?`,
      description: `${email.trim()} is emailed the time in ${zoneLabel(zone)}: ${formatFull(time, zone)}.`,
      confirmLabel: 'Book the call',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    setSaving(true);
    const { data, error } = await db.rpc('admin_book_onboarding_call', {
      p_tenant_id: company.id,
      p_starts_at: time,
      p_name: name.trim(),
      p_email: email.trim(),
      p_phone: phone.trim() || null,
      p_notes: notes.trim() || null,
      p_timezone: zone,
    });
    setSaving(false);
    if (error) {
      toast.error(errorText(error));
      return;
    }
    toast.success('Call booked');
    flushMailer();
    onBooked((data as { id: string }).id);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto shadow-none">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Book for a company</DialogTitle>
          <DialogDescription>For a company that asked for a call by phone or WhatsApp. They are emailed as if they booked it.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          <Field label="Company">
            {company ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{company.company_name || company.slug}</p>
                  <p className="truncate text-xs text-muted-foreground">{company.slug}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCompany(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by company name or slug" className="pl-9" autoFocus />
                </div>
                {results === null ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching
                  </p>
                ) : results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No company matches.</p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => pick(c)} className="w-full px-3 py-2 text-left hover:bg-primary/5">
                          <span className="block truncate text-sm font-medium">{c.company_name || c.slug}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.slug}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>

          {company && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Person's name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
                </Field>
                <Field label="Phone (optional)">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
                </Field>
                <Field label="The company's time zone">
                  <Select value={zone} onValueChange={setZone}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {zones.map((z) => (
                        <SelectItem key={z} value={z}>
                          {z.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Time">
                <SlotPicker hostTz={hostTz} companyTz={zone} exclude={null} value={time} onChange={setTime} />
              </Field>

              <Field label="Note (optional)">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="What they want to talk about." className="min-h-[64px]" />
              </Field>

              {time && (
                <p className="text-sm text-muted-foreground">
                  {formatFull(time, hostTz)}
                  {zone !== hostTz && <> · for them {formatFull(time, zone)}</>}
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button size="sm" onClick={() => void book()} disabled={!ready || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Book the call
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
