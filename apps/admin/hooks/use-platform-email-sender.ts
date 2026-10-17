'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { PlatformEmailSender } from '@/lib/notifications-v2/types';

/**
 * The platform's email sender and where alerts to our team go, for
 * Notifications › Setups › Email sender. Both live on the first admin_settings
 * row (the row the Settings page reads): `platform_sender_name`,
 * `platform_sender_local_part`, `platform_reply_to` (NULL = the default,
 * "Drive 247 <noreply@drive-247.com>") and the existing `notification_emails`.
 */

export interface PlatformEmailSetup {
  sender: PlatformEmailSender;
  /** Who our own alert emails go to (admin_settings.notification_emails). */
  recipients: string[];
}

const EMPTY: PlatformEmailSetup = {
  sender: { from_name: null, from_local_part: null, reply_to: null },
  recipients: [],
};

type SettingsRow = {
  id: string;
  notification_emails: string[] | null;
  platform_sender_name: string | null;
  platform_sender_local_part: string | null;
  platform_reply_to: string | null;
};

export function usePlatformEmailSender() {
  const [rowId, setRowId] = useState<string | null>(null);
  const [saved, setSaved] = useState<PlatformEmailSetup>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const { data, error: readError } = await supabase
      .from('admin_settings')
      .select('id, notification_emails, platform_sender_name, platform_sender_local_part, platform_reply_to')
      .order('created_at', { ascending: true })
      .limit(1);
    if (readError) {
      setError(readError.message);
    } else {
      const row = ((data ?? []) as unknown as SettingsRow[])[0];
      if (row) {
        setRowId(row.id);
        setSaved({
          sender: {
            from_name: row.platform_sender_name,
            from_local_part: row.platform_sender_local_part,
            reply_to: row.platform_reply_to,
          },
          recipients: row.notification_emails ?? [],
        });
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Writes the setup; throws a plain sentence when it was not saved. */
  const save = useCallback(
    async (next: PlatformEmailSetup): Promise<void> => {
      if (!rowId) throw new Error('The settings row hasn’t loaded yet. Try again in a moment.');
      const clean = (v: string | null): string | null => (v && v.trim() ? v.trim() : null);
      const patch = {
        platform_sender_name: clean(next.sender.from_name),
        platform_sender_local_part: clean(next.sender.from_local_part),
        platform_reply_to: clean(next.sender.reply_to),
        notification_emails: next.recipients,
        updated_at: new Date().toISOString(),
      };
      const { data, error: writeError } = await supabase
        .from('admin_settings')
        .update(patch as never)
        .eq('id', rowId)
        .select('id');
      if (writeError) throw new Error(writeError.message || 'Couldn’t save. Try again in a moment.');
      if (!data || data.length === 0) throw new Error('Nothing was saved. Check you are signed in as a super admin.');
      setSaved({
        sender: {
          from_name: patch.platform_sender_name,
          from_local_part: patch.platform_sender_local_part,
          reply_to: patch.platform_reply_to,
        },
        recipients: next.recipients,
      });
    },
    [rowId],
  );

  return { saved, loading, error, save, reload: load };
}
