'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useBonzahPendingCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    const fetchCount = async () => {
      const { count: c, error } = await supabase
        .from('bonzah_onboarding_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (!error && active) setCount(c ?? 0);
    };

    void fetchCount();

    const channel = supabase
      .channel('bonzah-onboarding-pending-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bonzah_onboarding_submissions' },
        () => {
          void fetchCount();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
