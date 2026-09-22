'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { AgreementTemplateCategoryV2, AgreementTemplateV2 } from '@/lib/agreements-v2/types';

/**
 * Agreements v2 — the tenant's agreement templates, every category, as ONE list.
 *
 * Same table as v1 (`agreement_templates`), no schema change. What v2 changes
 * is the model on top of it: v1 shows two fixed name-keyed slots per category
 * ("Default Template" / "Custom Template"); v2 shows every row, and any name.
 *
 * "DEFAULT" IS `is_active`, and nothing else
 * A partial unique index allows one active row per (tenant_id,
 * template_category), and all three send engines pick exactly that row (with
 * the standard category as the fallback). So "the default template is what
 * goes out from a rental" is true by construction, not by a second flag that
 * could drift from it.
 *
 * What this hook deliberately does NOT do, unlike the v1 screens:
 *  - write on read. The v1 chooser seeds rows on mount, which has already
 *    displaced a tenant's seeded installment contract once.
 *  - deactivate across categories. `useAgreementTemplates().setActive` in
 *    hooks/use-agreement-templates.ts deactivates EVERY template of the tenant;
 *    `setDefault` here touches one category only.
 *  - ignore an error. supabase-js returns `{ error }` rather than throwing, so
 *    every write below checks it.
 *
 * TENANT ISOLATION: RLS is off on `agreement_templates` (and anon holds GRANT
 * ALL on it), so every read and write carries its own `.eq('tenant_id', …)`.
 */

const CATEGORIES: ReadonlySet<string> = new Set(['standard', 'payg', 'extension', 'installment']);

/** The unique index on (tenant_id, template_name, template_category), or the active-row index. */
const UNIQUE_VIOLATION = '23505';

export const agreementTemplatesV2QueryKey = (tenantId: string | undefined) =>
  ['agreement-templates-v2', tenantId] as const;

interface TemplateRow {
  id: string;
  template_name: string | null;
  template_content: string | null;
  template_category: string | null;
  is_active: boolean | null;
  updated_at: string | null;
}

const SELECT = 'id, template_name, template_content, template_category, is_active, updated_at';

export function toTemplateV2(row: TemplateRow): AgreementTemplateV2 {
  const category = CATEGORIES.has(row.template_category ?? '')
    ? (row.template_category as AgreementTemplateCategoryV2)
    : 'standard';
  return {
    id: row.id,
    name: row.template_name ?? '',
    content: row.template_content ?? '',
    category,
    isDefault: row.is_active === true,
    updatedAt: row.updated_at ?? null,
  };
}

/** Defaults first (the standard one ahead of the others), then by name. */
export function sortTemplatesV2(templates: AgreementTemplateV2[]): AgreementTemplateV2[] {
  return [...templates].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isDefault && b.isDefault && a.category !== b.category) {
      if (a.category === 'standard') return -1;
      if (b.category === 'standard') return 1;
    }
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

/**
 * The template a send in `category` uses: that category's default, else the
 * standard default (the send engines' own fallback), else none.
 */
export function defaultTemplateFor(
  templates: AgreementTemplateV2[],
  category: AgreementTemplateCategoryV2,
): AgreementTemplateV2 | null {
  return (
    templates.find((t) => t.isDefault && t.category === category) ??
    templates.find((t) => t.isDefault && t.category === 'standard') ??
    null
  );
}

/**
 * `name`, or `name (2)`, `name (3)`… — the first that is not already taken.
 * Compared exactly, as the unique index compares.
 */
export function uniqueTemplateName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`;
    if (!used.has(candidate)) return candidate;
  }
}

export function useAgreementTemplatesV2() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: agreementTemplatesV2QueryKey(tenantId),
    queryFn: async (): Promise<AgreementTemplateV2[]> => {
      const { data, error } = await supabase
        .from('agreement_templates')
        .select(SELECT)
        .eq('tenant_id', tenantId!);
      if (error) throw error;
      return sortTemplatesV2(((data ?? []) as TemplateRow[]).map(toTemplateV2));
    },
    enabled: !!tenantId,
  });

  return {
    templates: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useAgreementTemplateMutationsV2() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const queryClient = useQueryClient();

  const invalidate = useCallback(async () => {
    // The v1 screens cache the same rows under their own keys; a default set
    // here must not leave them showing the old one.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: agreementTemplatesV2QueryKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['agreement-templates', tenantId] }),
    ]);
  }, [queryClient, tenantId]);

  const requireTenant = useCallback((): string => {
    if (!tenantId) throw new Error('No tenant is loaded.');
    return tenantId;
  }, [tenantId]);

  /**
   * A new `standard` template, NOT the default. Its name is made unique by
   * suffixing " (2)", " (3)"… so it can never collide with the unique index;
   * a collision that still happens (someone else created that name in the
   * meantime) is retried with the next free name.
   */
  const create = useCallback(
    async (input: { name: string; content: string }): Promise<AgreementTemplateV2> => {
      const tid = requireTenant();
      const base = (input.name ?? '').trim() || 'Untitled template';

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data: existing, error: readError } = await supabase
          .from('agreement_templates')
          .select('template_name')
          .eq('tenant_id', tid)
          .eq('template_category', 'standard');
        if (readError) throw readError;

        const name = uniqueTemplateName(
          base,
          ((existing ?? []) as { template_name: string | null }[]).map((r) => r.template_name ?? ''),
        );

        const { data, error } = await supabase
          .from('agreement_templates')
          .insert({
            tenant_id: tid,
            template_name: name,
            template_content: input.content ?? '',
            template_category: 'standard',
            is_active: false,
          })
          .select(SELECT)
          .single();

        if (error) {
          if (error.code === UNIQUE_VIOLATION && attempt < 2) continue;
          throw error;
        }
        await invalidate();
        return toTemplateV2(data as TemplateRow);
      }
      throw new Error('Could not find a free name for this template.');
    },
    [requireTenant, invalidate],
  );

  /** Rename and/or rewrite one template of this tenant. */
  const update = useCallback(
    async (id: string, patch: { name?: string; content?: string }): Promise<void> => {
      const tid = requireTenant();
      const changes: { template_name?: string; template_content?: string; updated_at: string } = {
        updated_at: new Date().toISOString(),
      };
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new Error('A template needs a name.');
        changes.template_name = name;
      }
      if (patch.content !== undefined) changes.template_content = patch.content;

      const { data, error } = await supabase
        .from('agreement_templates')
        .update(changes)
        .eq('id', id)
        .eq('tenant_id', tid)
        .select('id');
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new Error(`A template named "${changes.template_name}" already exists.`);
        }
        throw error;
      }
      if (!data || data.length === 0) throw new Error('That template was not found.');
      await invalidate();
    },
    [requireTenant, invalidate],
  );

  /**
   * Make one template the default of ITS OWN category: deactivate the other
   * active rows in that category, then activate this one. Two steps, like the
   * v1 hook, because the partial unique index refuses a second active row.
   *
   * Unlike the v1 hook, a failed step is not ignored. If activating fails after
   * the others were deactivated, the previous default is put back, so the
   * category is never left with no default: with none, the send path silently
   * falls back to the standard template, or to plain text.
   */
  const setDefault = useCallback(
    async (id: string): Promise<void> => {
      const tid = requireTenant();

      const { data: target, error: targetError } = await supabase
        .from('agreement_templates')
        .select('id, template_category, is_active')
        .eq('id', id)
        .eq('tenant_id', tid)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) throw new Error('That template was not found.');
      if (target.is_active === true) return;

      const category = target.template_category;

      const { data: previous, error: deactivateError } = await supabase
        .from('agreement_templates')
        .update({ is_active: false })
        .eq('tenant_id', tid)
        .eq('template_category', category)
        .eq('is_active', true)
        .neq('id', id)
        .select('id');
      if (deactivateError) throw deactivateError;

      const { error: activateError } = await supabase
        .from('agreement_templates')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tid);

      if (activateError) {
        const restore = ((previous ?? []) as { id: string }[]).map((r) => r.id);
        if (restore.length > 0) {
          const { error: restoreError } = await supabase
            .from('agreement_templates')
            .update({ is_active: true })
            .eq('tenant_id', tid)
            .in('id', restore);
          if (restoreError) {
            console.error('[agreement-templates-v2] Could not restore the previous default:', restoreError);
          }
        }
        await invalidate();
        throw activateError;
      }
      await invalidate();
    },
    [requireTenant, invalidate],
  );

  /**
   * Delete a template. Never the DEFAULT: that is what a rental sends, so
   * deleting it would silently switch rentals to another template or to the
   * built-in fallback text. Set another one as default first. The delete
   * itself also refuses an active row, so a template that became the default
   * a moment ago (another tab) is never removed on a stale check.
   */
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const tid = requireTenant();
      const { data: row, error: readError } = await supabase
        .from('agreement_templates')
        .select('id, is_active')
        .eq('id', id)
        .eq('tenant_id', tid)
        .maybeSingle();
      if (readError) throw readError;
      if (!row) throw new Error('That template was not found.');
      if (row.is_active === true) {
        throw new Error('This is your default template. Set another one as default first.');
      }
      const { data, error } = await supabase
        .from('agreement_templates')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tid)
        .or('is_active.is.null,is_active.eq.false')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('That template could not be deleted. It may have just become your default.');
      }
      await invalidate();
    },
    [requireTenant, invalidate],
  );

  return { create, update, setDefault, remove };
}
