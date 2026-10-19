'use client';

/**
 * Edit a rental company: its details, and its head admin's login (email and
 * password) — everything a super admin changes on the company page, in one
 * dialog opened from the Company card.
 *
 * The login is changed through admin-tenant-password-reset (action
 * `update_email`, and `reset` with a chosen password), which refuses to touch
 * a super admin and writes every change to audit_logs. A password is never
 * shown back once set; leaving the field empty keeps the current one.
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Wand2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface EditableCompany {
  id: string;
  company_name: string;
  admin_name: string | null;
  slug: string;
  contact_email: string;
  contact_phone?: string | null;
  address?: string | null;
  timezone?: string | null;
  currency_code?: string | null;
}

type Fields = Required<{ [K in Exclude<keyof EditableCompany, 'id'>]: string }>;

const fieldsOf = (t: EditableCompany): Fields => ({
  company_name: t.company_name ?? '',
  admin_name: t.admin_name ?? '',
  slug: t.slug ?? '',
  contact_email: t.contact_email ?? '',
  contact_phone: t.contact_phone ?? '',
  address: t.address ?? '',
  timezone: t.timezone ?? '',
  currency_code: t.currency_code ?? '',
});

interface Login {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  canReset: boolean;
}

/** Look-alike characters left out: these get read aloud. */
function generatePassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="truncate text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EditCompanyDialog({
  open,
  onOpenChange,
  tenant,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: EditableCompany;
  /** The saved company fields, to merge into the page's copy. */
  onSaved: (patch: Partial<EditableCompany>) => void;
}) {
  const [form, setForm] = useState<Fields>(() => fieldsOf(tenant));
  const [login, setLogin] = useState<Login | null | undefined>(undefined);
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fresh form, and the current head admin login, each time it opens.
  useEffect(() => {
    if (!open) return;
    setForm(fieldsOf(tenant));
    setPassword('');
    setShowPassword(false);
    setLogin(undefined);
    supabase.functions
      .invoke('admin-tenant-password-reset', { body: { action: 'list', tenantId: tenant.id } })
      .then(({ data }) => {
        const users: Login[] = (data?.users ?? []).filter((u: Login) => u.canReset);
        const head = users.find((u) => u.role === 'head_admin' && u.isActive) ?? users.find((u) => u.isActive) ?? null;
        setLogin(head);
        setLoginEmail(head?.email ?? '');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant.id]);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const slugChanged = form.slug.trim() !== tenant.slug;
  const passwordTooShort = password.length > 0 && password.length < 8;

  const save = async () => {
    if (!form.company_name.trim()) return toast.error('The company needs a name.');
    if (passwordTooShort) return toast.error('A password needs at least 8 characters.');
    setSaving(true);
    try {
      // 1. The company's own details.
      const slug = form.slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
      const patch = {
        company_name: form.company_name.trim(),
        admin_name: form.admin_name.trim() || null,
        slug,
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim() || null,
        address: form.address.trim() || null,
        timezone: form.timezone.trim() || null,
        currency_code: form.currency_code.trim().toUpperCase() || null,
      };
      const { error } = await supabase.from('tenants').update(patch as any).eq('id', tenant.id);
      if (error) throw new Error(error.message);
      onSaved(patch);

      // 2. The login: email, then password.
      if (login) {
        const nextEmail = loginEmail.trim().toLowerCase();
        if (nextEmail && nextEmail !== login.email.toLowerCase()) {
          const { data, error: fnError } = await supabase.functions.invoke('admin-tenant-password-reset', {
            body: { action: 'update_email', tenantId: tenant.id, userId: login.id, email: nextEmail },
          });
          if (fnError || data?.error) throw new Error(data?.error || 'The login email could not be changed.');
        }
        if (password) {
          const { data, error: fnError } = await supabase.functions.invoke('admin-tenant-password-reset', {
            body: { action: 'reset', tenantId: tenant.id, userId: login.id, password },
          });
          if (fnError || data?.error) throw new Error(data?.error || 'The password could not be changed.');
        }
      }

      toast.success('Company saved');
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="flex max-w-3xl flex-col gap-0 rounded-3xl p-7 [&_input]:h-9 [&_input]:text-sm">
        <DialogHeader className="mb-4">
          <DialogTitle>Edit company</DialogTitle>
          <DialogDescription>Details, and how their head admin signs in.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Company name">
                <Input value={form.company_name} onChange={set('company_name')} />
              </Field>
              <Field label="Admin name">
                <Input value={form.admin_name} onChange={set('admin_name')} placeholder="John Doe" />
              </Field>
              <Field label="Slug" hint={slugChanged ? <span className="text-amber-600">Changes their portal and booking site addresses.</span> : undefined}>
                <Input value={form.slug} onChange={set('slug')} />
              </Field>
              <Field label="Contact email">
                <Input type="email" value={form.contact_email} onChange={set('contact_email')} />
              </Field>
              <Field label="Phone">
                <Input type="tel" value={form.contact_phone} onChange={set('contact_phone')} />
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={set('address')} />
              </Field>
              <Field label="Time zone">
                <Input value={form.timezone} onChange={set('timezone')} placeholder="America/New_York" />
              </Field>
              <Field label="Currency">
                <Input value={form.currency_code} onChange={set('currency_code')} placeholder="USD" maxLength={3} />
              </Field>
            </div>
          </section>

          <section className="space-y-2 border-t border-border/60 pt-4">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Login</h3>
            {login === undefined ? (
              <p className="text-sm text-muted-foreground">Loading their login…</p>
            ) : login === null ? (
              <p className="text-sm text-muted-foreground">This company has no login that can be changed from here.</p>
            ) : (
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
                <Field label="Login email">
                  <Input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                </Field>
                <Field
                  label="New password"
                  hint={
                    passwordTooShort ? (
                      <span className="text-destructive">At least 8 characters.</span>
                    ) : password ? (
                      'They choose their own at sign-in.'
                    ) : (
                      'Empty keeps their current one.'
                    )
                  }
                >
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Unchanged"
                      autoComplete="new-password"
                      className="pr-16 font-mono"
                    />
                    <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPassword(generatePassword());
                          setShowPassword(true);
                        }}
                        title="Generate one"
                        aria-label="Generate a password"
                        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Wand2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        title={showPassword ? 'Hide' : 'Show'}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                </Field>
              </div>
            )}
          </section>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || passwordTooShort}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
