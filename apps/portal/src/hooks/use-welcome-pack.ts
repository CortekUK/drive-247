'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuthStore } from '@/stores/auth-store';

export interface WelcomePackSettings {
  id: string;
  doc_title: string;
  doc_subtitle: string | null;
  intro_md: string | null;
  show_on_first_login: boolean;
  version: number;
}

export interface WelcomePackGroup {
  id: string;
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

export interface WelcomePackSection {
  id: string;
  group_id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  icon: string | null;
  required_flag: string | null;
  sort_order: number;
}

export interface WelcomePackFaq {
  id: string;
  group_id: string | null;
  question: string;
  answer_md: string;
  required_flag: string | null;
  sort_order: number;
}

/** A chapter with its sections and FAQs already filtered for this tenant. */
export interface WelcomePackChapter extends WelcomePackGroup {
  sections: WelcomePackSection[];
  faqs: WelcomePackFaq[];
}

const CONTENT_KEY = ['welcome-pack-content'];

/**
 * The document. Content is global — one pack for every tenant — so the query
 * key carries no tenant id. Per-tenant *visibility* is applied below via
 * `required_flag`, not by fetching different rows.
 */
function useWelcomePackContent() {
  return useQuery({
    queryKey: CONTENT_KEY,
    queryFn: async () => {
      const [settingsRes, groupsRes, sectionsRes, faqsRes] = await Promise.all([
        (supabase as any)
          .from('welcome_pack_settings')
          .select('id, doc_title, doc_subtitle, intro_md, show_on_first_login, version')
          .maybeSingle(),
        (supabase as any)
          .from('welcome_pack_groups')
          .select('id, key, title, description, icon, sort_order')
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
        (supabase as any)
          .from('welcome_pack_sections')
          .select('id, group_id, slug, title, summary, body_md, icon, required_flag, sort_order')
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
        (supabase as any)
          .from('welcome_pack_faqs')
          .select('id, group_id, question, answer_md, required_flag, sort_order')
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
      ]);

      if (groupsRes.error) throw groupsRes.error;
      if (sectionsRes.error) throw sectionsRes.error;
      if (faqsRes.error) throw faqsRes.error;

      return {
        settings: (settingsRes.data ?? null) as WelcomePackSettings | null,
        groups: (groupsRes.data ?? []) as WelcomePackGroup[],
        sections: (sectionsRes.data ?? []) as WelcomePackSection[],
        faqs: (faqsRes.data ?? []) as WelcomePackFaq[],
      };
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Resolve any `required_flag` that TenantContext does not already carry.
 *
 * TenantContext selects a FIXED column list — it has `gig_driver_enabled` and
 * `security_deposit_enabled`, for instance, but NOT `lockbox_enabled`.
 * A super admin can type any boolean tenant column into
 * `required_flag` when authoring, so the set of flags the document references
 * is not knowable at build time. Fetch exactly the missing ones in one query.
 *
 * FAILS OPEN by design. A mistyped column name, a revoked grant or a network
 * blip must never silently blank pages for every operator. Worst case someone
 * reads about a feature they do not have; the alternative is a document with
 * holes in it that nobody can explain.
 */
function useResolvedFlags(referenced: string[]) {
  const { tenant } = useTenant();
  const tenantRecord = (tenant ?? {}) as Record<string, unknown>;
  const referencedKey = referenced.join(',');

  const missing = useMemo(
    () => referenced.filter((f) => !(f in tenantRecord)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [referencedKey, tenant]
  );

  const { data: extra } = useQuery({
    queryKey: ['welcome-pack-flags', (tenant as { id?: string } | null)?.id, missing.join(',')],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tenants')
        .select(missing.join(', '))
        .eq('id', (tenant as { id: string }).id)
        .single();
      if (error) return {} as Record<string, unknown>; // fail open
      return (data ?? {}) as Record<string, unknown>;
    },
    enabled: !!tenant && missing.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return useMemo(
    () => ({ ...tenantRecord, ...(extra ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenant, extra]
  );
}

/** The whole document, assembled and filtered for the current tenant. */
export function useWelcomePack() {
  const { data, isLoading, isError } = useWelcomePackContent();

  const referencedFlags = useMemo(() => {
    if (!data) return [];
    const all = [
      ...data.sections.map((s) => s.required_flag),
      ...data.faqs.map((f) => f.required_flag),
    ].filter((f): f is string => !!f);
    return Array.from(new Set(all));
  }, [data]);

  const flags = useResolvedFlags(referencedFlags);

  const chapters: WelcomePackChapter[] = useMemo(() => {
    if (!data) return [];
    // Only an explicit `false` hides content. Unresolved stays visible.
    const visible = (requiredFlag: string | null) =>
      !requiredFlag || flags[requiredFlag] !== false;

    return data.groups
      .map((g) => ({
        ...g,
        sections: data.sections.filter(
          (s) => s.group_id === g.id && visible(s.required_flag)
        ),
        faqs: data.faqs.filter((f) => f.group_id === g.id && visible(f.required_flag)),
      }))
      .filter((g) => g.sections.length > 0 || g.faqs.length > 0);
  }, [data, flags]);

  const allSections = useMemo(() => chapters.flatMap((c) => c.sections), [chapters]);
  const allFaqs = useMemo(() => chapters.flatMap((c) => c.faqs), [chapters]);

  return {
    settings: data?.settings ?? null,
    chapters,
    allSections,
    allFaqs,
    isLoading,
    isError,
  };
}

/** This user's read receipts, and the mutations that write them. */
export function useWelcomePackProgress() {
  const appUser = useAuthStore((s) => s.appUser);
  const appUserId = appUser?.id ?? null;
  const queryClient = useQueryClient();

  const readsKey = ['welcome-pack-reads', appUserId];

  const { data: readSectionIds = [] } = useQuery({
    queryKey: readsKey,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any)
        .from('welcome_pack_reads')
        .select('section_id')
        .eq('app_user_id', appUserId);
      if (error) throw error;
      return ((data ?? []) as { section_id: string }[]).map((r) => r.section_id);
    },
    enabled: !!appUserId,
    staleTime: 60_000,
  });

  const { data: completion } = useQuery({
    queryKey: ['welcome-pack-completion', appUserId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('welcome_pack_completions')
        .select('id, version, completed_at')
        .eq('app_user_id', appUserId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string; version: number; completed_at: string } | null;
    },
    enabled: !!appUserId,
    staleTime: 60_000,
  });

  const markRead = useMutation({
    mutationFn: async (sectionId: string) => {
      if (!appUserId) return;
      const { error } = await (supabase as any).from('welcome_pack_reads').upsert(
        { app_user_id: appUserId, section_id: sectionId, seen_at: new Date().toISOString() },
        { onConflict: 'app_user_id,section_id' }
      );
      if (error) throw error;
    },
    // Optimistic: progress must move the instant a section is opened, not after
    // a round-trip. A failed write is harmless — the receipt is rewritten the
    // next time the section scrolls into view.
    onMutate: async (sectionId: string) => {
      await queryClient.cancelQueries({ queryKey: readsKey });
      const previous = queryClient.getQueryData<string[]>(readsKey) ?? [];
      if (!previous.includes(sectionId)) {
        queryClient.setQueryData<string[]>(readsKey, [...previous, sectionId]);
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(readsKey, ctx.previous);
    },
  });

  const markComplete = useMutation({
    mutationFn: async (version: number) => {
      if (!appUserId) return;
      const { error } = await (supabase as any).from('welcome_pack_completions').upsert(
        { app_user_id: appUserId, version, completed_at: new Date().toISOString() },
        { onConflict: 'app_user_id' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['welcome-pack-completion', appUserId] });
    },
  });

  return {
    readSectionIds,
    isRead: (sectionId: string) => readSectionIds.includes(sectionId),
    completion,
    markRead,
    markComplete,
  };
}

/**
 * Whether to show the first-login prompt.
 *
 * Deliberately dismissible, and suppressed behind every existing gate by the
 * caller. The dashboard already mounts the subscription gate, the setup
 * reminder, the migration blocker and the feedback prompt — an operator who
 * cannot get past four consecutive dialogs concludes the software is broken,
 * not that the reading is important.
 */
export function useWelcomePackPrompt() {
  const { settings, isLoading } = useWelcomePack();
  const { completion } = useWelcomePackProgress();
  const appUser = useAuthStore((s) => s.appUser);

  const shouldPrompt =
    !isLoading &&
    !!settings &&
    settings.show_on_first_login &&
    !!appUser &&
    (!completion || completion.version < settings.version);

  return { shouldPrompt, settings };
}
