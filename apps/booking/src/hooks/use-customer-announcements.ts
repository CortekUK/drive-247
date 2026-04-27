import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export type AnnouncementSeverity = 'major' | 'minor' | 'critical' | 'info';

export interface FeatureAnnouncement {
  id: string;
  title: string;
  summary: string | null;
  body_html: string | null;
  body_format: 'html' | 'markdown';
  image_url: string | null;
  video_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  severity: AnnouncementSeverity;
  status: string;
  is_active: boolean;
  published_at: string | null;
  expires_at: string | null;
  sort_priority: number;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementWithViewState extends FeatureAnnouncement {
  viewed: boolean;
  dismissed: boolean;
  view_id: string | null;
  seen_at: string | null;
  dismissed_at: string | null;
}

interface AnnouncementView {
  id: string;
  announcement_id: string;
  seen_at: string | null;
  dismissed_at: string | null;
}

export function useCustomerAnnouncements() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();
  const customerUserId = customerUser?.id ?? null;
  const customerJoinedAt = customerUser?.created_at ?? null;

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['feature-announcements', customerUserId],
    queryFn: async (): Promise<AnnouncementWithViewState[]> => {
      if (!customerUserId) return [];

      const { data: liveAnnouncements, error: aErr } = await supabase
        .from('feature_announcements')
        .select('*')
        .eq('status', 'published')
        .eq('is_active', true)
        .order('published_at', { ascending: false });

      if (aErr) throw aErr;

      const { data: views, error: vErr } = await supabase
        .from('customer_announcement_views')
        .select('id, announcement_id, seen_at, dismissed_at')
        .eq('customer_user_id', customerUserId);

      if (vErr) throw vErr;

      const viewMap = new Map<string, AnnouncementView>();
      (views || []).forEach((v: any) => viewMap.set(v.announcement_id, v));

      const now = Date.now();
      return (liveAnnouncements || [])
        .filter((a: any) => {
          if (a.expires_at && new Date(a.expires_at).getTime() <= now) return false;
          if (a.published_at && new Date(a.published_at).getTime() > now) return false;
          return true;
        })
        .map((a: any): AnnouncementWithViewState => {
          const v = viewMap.get(a.id);
          return {
            ...(a as FeatureAnnouncement),
            viewed: !!v?.seen_at,
            dismissed: !!v?.dismissed_at,
            view_id: v?.id ?? null,
            seen_at: v?.seen_at ?? null,
            dismissed_at: v?.dismissed_at ?? null,
          };
        });
    },
    enabled: !!customerUserId,
    staleTime: 60_000,
  });

  // Realtime: invalidate on any change to feature_announcements (announcements
  // are global so we don't filter by customer). Insert/update will trigger
  // a refetch and may show a new modal.
  useEffect(() => {
    if (!customerUserId) return;
    const channel = supabase
      .channel(`feature-announcements:${customerUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_announcements' },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['feature-announcements', customerUserId],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerUserId, queryClient]);

  const unreadCount = useMemo(
    () => announcements.filter((a) => !a.viewed).length,
    [announcements]
  );

  // The most-recent un-dismissed major announcement that was published after
  // the customer signed up. This drives the one-time modal.
  const pendingMajorModal = useMemo(() => {
    if (!customerJoinedAt) return null;
    const joinedAt = new Date(customerJoinedAt).getTime();
    return (
      announcements.find(
        (a) =>
          a.severity === 'major' &&
          !a.dismissed &&
          a.published_at &&
          new Date(a.published_at).getTime() >= joinedAt
      ) ?? null
    );
  }, [announcements, customerJoinedAt]);

  const markSeen = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!customerUserId) return;
      const { error } = await supabase.from('customer_announcement_views').upsert(
        {
          customer_user_id: customerUserId,
          announcement_id: announcementId,
          seen_at: new Date().toISOString(),
        },
        { onConflict: 'customer_user_id,announcement_id' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['feature-announcements', customerUserId],
      });
    },
  });

  const dismiss = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!customerUserId) return;
      const now = new Date().toISOString();
      const { error } = await supabase.from('customer_announcement_views').upsert(
        {
          customer_user_id: customerUserId,
          announcement_id: announcementId,
          seen_at: now,
          dismissed_at: now,
        },
        { onConflict: 'customer_user_id,announcement_id' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['feature-announcements', customerUserId],
      });
    },
  });

  const markAllSeen = useMutation({
    mutationFn: async () => {
      if (!customerUserId) return;
      const unread = announcements.filter((a) => !a.viewed);
      if (unread.length === 0) return;
      const now = new Date().toISOString();
      const rows = unread.map((a) => ({
        customer_user_id: customerUserId,
        announcement_id: a.id,
        seen_at: now,
      }));
      const { error } = await supabase
        .from('customer_announcement_views')
        .upsert(rows, { onConflict: 'customer_user_id,announcement_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['feature-announcements', customerUserId],
      });
    },
  });

  return {
    announcements,
    unreadCount,
    pendingMajorModal,
    isLoading,
    markSeen,
    dismiss,
    markAllSeen,
  };
}
