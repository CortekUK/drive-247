'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';

export interface AdminSettings {
  id?: string;
  notification_emails: string[];
  contact_form_enabled: boolean;
  subscription_gate_disabled: boolean;
  /** Days a tenant keeps access after a failed payment, before the blocker. */
  subscription_grace_days: number;
  updated_at?: string;
}

const DEFAULTS: AdminSettings = {
  notification_emails: ['ilyasghulam35@gmail.com'],
  contact_form_enabled: true,
  subscription_gate_disabled: false,
  // The window a tenant keeps working after a payment fails. 7 is what the
  // column defaults to and what the product did before this was configurable.
  subscription_grace_days: 7,
};

/** The fields a page edits — what "unsaved changes" compares. */
function editable(s: AdminSettings) {
  const { id: _id, updated_at: _updated, ...rest } = s;
  return JSON.stringify(rest);
}

/**
 * The one `admin_settings` row, as a draft the settings pages edit and a saved
 * copy Reset goes back to. Every page shares the row, so Save writes the whole
 * draft exactly as the single settings page used to.
 */
export function useAdminSettings() {
  const [saved, setSaved] = useState<AdminSettings>(DEFAULTS);
  const [draft, setDraft] = useState<AdminSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('admin_settings')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1);

        if (error) throw error;

        const data = rows?.[0];
        if (data) {
          const loaded: AdminSettings = {
            id: data.id,
            notification_emails: data.notification_emails || DEFAULTS.notification_emails,
            contact_form_enabled: data.contact_form_enabled ?? true,
            subscription_gate_disabled: (data as any).subscription_gate_disabled ?? false,
            subscription_grace_days: (data as any).subscription_grace_days ?? 7,
            updated_at: data.updated_at,
          };
          setSaved(loaded);
          setDraft(loaded);
        }
      } catch (err) {
        console.error('Error loading settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = useMemo(() => editable(draft) !== editable(saved), [draft, saved]);

  const update = useCallback((patch: Partial<AdminSettings>) => {
    setJustSaved(false);
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setDraft(saved);
  }, [saved]);

  const save = useCallback(async () => {
    const settings = draft;
    setSaving(true);
    setError(null);
    try {
      let id = settings.id;
      const updatedAt = new Date().toISOString();
      if (id) {
        const { error } = await supabase
          .from('admin_settings')
          .update({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
            subscription_gate_disabled: settings.subscription_gate_disabled,
            subscription_grace_days: settings.subscription_grace_days,
            updated_at: updatedAt,
          } as any)
          .eq('id', id);

        if (error) throw error;

        // Keep the global flags consistent across every admin_settings row,
        // since the portal/edge read them as "true if ANY row is true".
        // (The maintenance banner was retired for Announcements, Oct 17 2026;
        // its columns are left as they are, off on every row.)
        await supabase
          .from('admin_settings')
          .update({
            subscription_gate_disabled: settings.subscription_gate_disabled,
            subscription_grace_days: settings.subscription_grace_days,
          } as any)
          .neq('id', id);
      } else {
        const { data, error } = await supabase
          .from('admin_settings')
          .insert({
            notification_emails: settings.notification_emails,
            contact_form_enabled: settings.contact_form_enabled,
            subscription_gate_disabled: settings.subscription_gate_disabled,
            subscription_grace_days: settings.subscription_grace_days,
          } as any)
          .select()
          .single();

        if (error) throw error;
        id = data.id;
      }

      const next = { ...settings, id, updated_at: updatedAt };
      setSaved(next);
      setDraft(next);
      setJustSaved(true);
      toast.success('Settings saved');
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setError(err instanceof Error ? err : new Error(err?.message ?? 'Unknown error'));
      toast.error(`Failed to save settings: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return { settings: draft, update, reset, save, dirty, loading, saving, saved: justSaved, error };
}
