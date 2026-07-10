'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BonzahTrainingVideo {
  id: string;
  title: string;
  description: string | null;
  loom_url: string;
  sort_order: number;
}

/**
 * Active Bonzah training videos, shown in the onboarding Training step.
 * Global content (not tenant-scoped) — swappable via the super-admin editor.
 */
export function useBonzahTrainingVideos() {
  return useQuery({
    queryKey: ['bonzah-training-videos'],
    queryFn: async (): Promise<BonzahTrainingVideo[]> => {
      const { data, error } = await supabase
        .from('bonzah_training_videos')
        .select('id, title, description, loom_url, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data as unknown as BonzahTrainingVideo[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
