/**
 * Every database and storage call the admin Announcements page makes, plus the
 * pure list-order helpers they depend on.
 *
 * Reads and writes ONLY the portal announcement tables, RPCs and bucket named in
 * ./contract.ts (ops/portal_announcements.sql). The legacy renter-facing
 * announcement table and its bucket are never touched from here.
 *
 * supabase-js resolves with `{ error }` instead of throwing, so every call
 * checks it and returns a result object; nothing here throws.
 */

import { supabase } from '@/lib/supabase';
import {
  ANNOUNCEMENT_BUCKET,
  ANNOUNCEMENT_RPC,
  ANNOUNCEMENT_TABLES,
  announcementImageObjectPath,
  compareAdminRows,
  isAnnouncementImageUrl,
  normalizeAdminAnnouncementRow,
  type AdminAnnouncementRow,
  type AdminAnnouncementStats,
  type AnnouncementKind,
  type AnnouncementSlide,
  type ImageSlot,
  type SaveAnnouncementArgs,
  type SegmentKey,
  type SegmentMatchTenant,
} from './contract';
import { IMAGE_ERRORS, checkImageFile, newAnnouncementImagePath } from './image-upload';
import {
  PICKER_TENANT_COLUMNS,
  buildBillingIndex,
  type BillingIndex,
  type PickerTenant,
  type SubscriptionRow,
} from './tenant-filters';

export type Result<T> = { ok: true; data: T } | { ok: false; message: string; code: string | null };

interface PgError {
  message?: string;
  code?: string;
}

function fail<T>(error: PgError | null | undefined, fallback: string): Result<T> {
  return { ok: false, message: error?.message || fallback, code: error?.code ?? null };
}

function thrown<T>(e: unknown, fallback: string): Result<T> {
  return { ok: false, message: e instanceof Error && e.message ? e.message : fallback, code: null };
}

/** Undefined table (42P01), undefined function (42883), PostgREST schema-cache misses (PGRST202/205). */
export const NOT_INSTALLED_CODES: readonly string[] = ['42P01', '42883', 'PGRST202', 'PGRST205'];

export function isNotInstalledCode(code: string | null | undefined): boolean {
  return !!code && NOT_INSTALLED_CODES.indexOf(code) !== -1;
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface AnnouncementsData {
  /** Both kinds, in display order (compareAdminRows). */
  rows: AdminAnnouncementRow[];
  /** announcement id -> selected tenant ids (audience 'selected' only has rows). */
  targetsById: Record<string, string[]>;
  /** null when the stats RPC failed: rows still render, with "Reach unavailable". */
  statsById: Record<string, AdminAnnouncementStats> | null;
}

export type LoadAnnouncementsResult =
  | { status: 'ready'; data: AnnouncementsData }
  | { status: 'not-installed' }
  | { status: 'error'; message: string };

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return isFinite(n) ? n : 0;
}

export async function loadAnnouncementsData(): Promise<LoadAnnouncementsResult> {
  try {
    const [rowsRes, targetsRes, statsRes] = await Promise.all([
      supabase.from(ANNOUNCEMENT_TABLES.content).select('*'),
      supabase.from(ANNOUNCEMENT_TABLES.targets).select('announcement_id, tenant_id'),
      supabase.rpc(ANNOUNCEMENT_RPC.stats),
    ]);

    const tableError = rowsRes.error || targetsRes.error;
    if (tableError) {
      if (isNotInstalledCode(rowsRes.error?.code) || isNotInstalledCode(targetsRes.error?.code)) {
        return { status: 'not-installed' };
      }
      return { status: 'error', message: tableError.message || 'Could not load announcements.' };
    }

    const rows: AdminAnnouncementRow[] = [];
    for (const raw of (rowsRes.data as unknown[] | null) ?? []) {
      const row = normalizeAdminAnnouncementRow(raw);
      if (row) rows.push(row);
    }
    rows.sort(compareAdminRows);

    const targetsById: Record<string, string[]> = {};
    for (const t of (targetsRes.data as Array<{ announcement_id: string; tenant_id: string }> | null) ?? []) {
      (targetsById[t.announcement_id] ??= []).push(t.tenant_id);
    }

    let statsById: Record<string, AdminAnnouncementStats> | null = null;
    if (statsRes.error) {
      console.warn('[announcements] reach stats unavailable:', statsRes.error.message);
    } else {
      statsById = {};
      for (const s of (statsRes.data as Array<Record<string, unknown>> | null) ?? []) {
        if (typeof s.announcement_id !== 'string') continue;
        statsById[s.announcement_id] = {
          announcement_id: s.announcement_id,
          audience_tenants: toCount(s.audience_tenants),
          reachable_tenants: toCount(s.reachable_tenants),
          shown_users: toCount(s.shown_users),
          shown_tenants: toCount(s.shown_tenants),
          card_opened_users: toCount(s.card_opened_users),
          dismissed_users: toCount(s.dismissed_users),
          dont_show_again_users: toCount(s.dont_show_again_users),
          cta_users: toCount(s.cta_users),
        };
      }
    }

    return { status: 'ready', data: { rows, targetsById, statsById } };
  } catch (e) {
    return { status: 'error', message: e instanceof Error && e.message ? e.message : 'Could not load announcements.' };
  }
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function saveAnnouncement(args: SaveAnnouncementArgs): Promise<Result<string>> {
  try {
    const { data, error } = await supabase.rpc(ANNOUNCEMENT_RPC.save, args);
    if (error) return fail(error, 'Could not save the announcement.');
    return { ok: true, data: typeof data === 'string' ? data : '' };
  } catch (e) {
    return thrown(e, 'Could not save the announcement.');
  }
}

export async function reorderAnnouncements(kind: AnnouncementKind, ids: string[]): Promise<Result<null>> {
  try {
    const { error } = await supabase.rpc(ANNOUNCEMENT_RPC.reorder, { p_kind: kind, p_ids: ids });
    if (error) return fail(error, 'Could not save the new order.');
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not save the new order.');
  }
}

/** Zero rows back means RLS refused or the row is gone: both are failures, not silent successes. */
export async function setAnnouncementActive(id: string, isActive: boolean): Promise<Result<null>> {
  try {
    const { data, error } = await supabase
      .from(ANNOUNCEMENT_TABLES.content)
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id');
    if (error) return fail(error, 'Could not change Active.');
    if (!Array.isArray(data) || data.length !== 1) {
      return { ok: false, message: 'The announcement was not updated. Reload the page and try again.', code: null };
    }
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not change Active.');
  }
}

export async function deleteAnnouncement(id: string): Promise<Result<null>> {
  try {
    const { data, error } = await supabase.from(ANNOUNCEMENT_TABLES.content).delete().eq('id', id).select('id');
    if (error) return fail(error, 'Could not delete the announcement.');
    if (!Array.isArray(data) || data.length !== 1) {
      return { ok: false, message: 'The announcement was not deleted. Reload the page and try again.', code: null };
    }
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not delete the announcement.');
  }
}

// ─── Images ──────────────────────────────────────────────────────────────────

/** Every uploaded image a row or draft references (card + slides). */
export function referencedImageUrls(row: { image_url: string | null; slides: readonly AnnouncementSlide[] }): string[] {
  const out: string[] = [];
  if (row.image_url) out.push(row.image_url);
  for (const s of row.slides) if (s.image_url) out.push(s.image_url);
  return out;
}

/** Best effort: storage cleanup never blocks or fails a save or a delete. */
export async function removeAnnouncementImages(urls: ReadonlyArray<string | null | undefined>): Promise<void> {
  const paths: string[] = [];
  for (const url of urls) {
    const p = announcementImageObjectPath(url);
    if (p && paths.indexOf(p) === -1) paths.push(p);
  }
  if (paths.length === 0) return;
  try {
    const { error } = await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove(paths);
    if (error) console.warn('[announcements] could not remove images:', error.message);
  } catch (e) {
    console.warn('[announcements] could not remove images:', e);
  }
}

export async function uploadAnnouncementImage(slot: ImageSlot, file: File): Promise<Result<string>> {
  const check = checkImageFile(file);
  if (!check.ok) return { ok: false, message: check.error, code: null };
  const path = newAnnouncementImagePath(slot, check.mime, crypto.randomUUID());
  try {
    const { error } = await supabase.storage
      .from(ANNOUNCEMENT_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (error) return fail(error, 'Upload failed.');
    const { data } = supabase.storage.from(ANNOUNCEMENT_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl;
    if (!isAnnouncementImageUrl(url)) {
      // The object is useless to us if its address fails the database CHECK.
      await supabase.storage.from(ANNOUNCEMENT_BUCKET).remove([path]).catch(() => undefined);
      return { ok: false, message: IMAGE_ERRORS.address, code: null };
    }
    return { ok: true, data: url };
  } catch (e) {
    return thrown(e, 'Upload failed.');
  }
}

// ─── Targeting ───────────────────────────────────────────────────────────────

export async function loadSegmentTenants(key: SegmentKey): Promise<Result<SegmentMatchTenant[]>> {
  try {
    const { data, error } = await supabase.rpc(ANNOUNCEMENT_RPC.segmentTenants, { p_segment_key: key });
    if (error) return fail(error, 'Could not load the matching tenants.');
    return { ok: true, data: ((data as SegmentMatchTenant[] | null) ?? []).slice() };
  } catch (e) {
    return thrown(e, 'Could not load the matching tenants.');
  }
}

export async function loadPickerTenants(): Promise<Result<PickerTenant[]>> {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select(PICKER_TENANT_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) return fail(error, 'Could not load tenants.');
    return { ok: true, data: (data as PickerTenant[] | null) ?? [] };
  } catch (e) {
    return thrown(e, 'Could not load tenants.');
  }
}

/** Names for the "Specific tenants" chips when an existing announcement is opened. */
export async function loadTenantsByIds(ids: readonly string[]): Promise<Result<PickerTenant[]>> {
  if (ids.length === 0) return { ok: true, data: [] };
  try {
    const { data, error } = await supabase.from('tenants').select(PICKER_TENANT_COLUMNS).in('id', ids.slice());
    if (error) return fail(error, 'Could not load tenant names.');
    return { ok: true, data: (data as PickerTenant[] | null) ?? [] };
  } catch (e) {
    return thrown(e, 'Could not load tenant names.');
  }
}

/**
 * The same three billing reads as the Rental Companies list
 * (rentals/page.tsx:417-445: tenant_subscriptions, subscription_plans with a
 * Stripe price, tenant_subscription_invoices), narrowed to the columns the
 * bucket classification needs.
 */
export async function loadBillingIndex(): Promise<Result<BillingIndex>> {
  try {
    const [subsRes, plansRes, invoicesRes] = await Promise.all([
      supabase
        .from('tenant_subscriptions')
        .select('tenant_id, status, amount, currency, interval, plan_name, current_period_end, trial_end, cancel_at, canceled_at, ended_at, created_at'),
      supabase.from('subscription_plans').select('tenant_id').eq('is_active', true).not('stripe_price_id', 'is', null),
      supabase.from('tenant_subscription_invoices').select('tenant_id, status'),
    ]);
    const failed = [subsRes.error, plansRes.error, invoicesRes.error].filter(Boolean);
    if (failed.length > 0) {
      return { ok: false, message: failed.map((e) => e?.message).join('; ') || 'Billing data unavailable.', code: null };
    }
    return {
      ok: true,
      data: buildBillingIndex(
        (subsRes.data as SubscriptionRow[] | null) ?? [],
        (plansRes.data as Array<{ tenant_id: string }> | null) ?? [],
        (invoicesRes.data as Array<{ tenant_id: string; status: string }> | null) ?? [],
      ),
    };
  } catch (e) {
    return thrown(e, 'Billing data unavailable.');
  }
}

// ─── Order (pure) ────────────────────────────────────────────────────────────

export type ListSection = 'feature' | 'hard' | 'soft';

/** Which sortable section a row lives in. System rows never cross between Hard and Soft. */
export function sectionOf(row: Pick<AdminAnnouncementRow, 'kind' | 'blocking'>): ListSection {
  if (row.kind === 'feature') return 'feature';
  return row.blocking === 'hard' ? 'hard' : 'soft';
}

/**
 * The full `p_ids` for admin_reorder_portal_announcements after dragging
 * `activeId` onto `overId`. `rows` are that kind's rows in display order.
 * System = [every Hard in section order] ++ [every Soft in section order], so
 * the stored order always equals the portal's display order. Returns null for a
 * no-op, an unknown id, or a drop across sections.
 */
export function reorderAfterDrop(
  rows: readonly AdminAnnouncementRow[],
  kind: AnnouncementKind,
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const ofKind = rows.filter((r) => r.kind === kind).slice().sort(compareAdminRows);
  const active = ofKind.find((r) => r.id === activeId);
  const over = ofKind.find((r) => r.id === overId);
  if (!active || !over) return null;
  const section = sectionOf(active);
  if (sectionOf(over) !== section) return null;

  const ids = ofKind.filter((r) => sectionOf(r) === section).map((r) => r.id);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  const moved = ids.slice();
  moved.splice(to, 0, moved.splice(from, 1)[0]);

  if (kind === 'feature') return moved;
  const hard = section === 'hard' ? moved : ofKind.filter((r) => sectionOf(r) === 'hard').map((r) => r.id);
  const soft = section === 'soft' ? moved : ofKind.filter((r) => sectionOf(r) === 'soft').map((r) => r.id);
  return hard.concat(soft);
}

/** Optimistic copy of what the reorder RPC stores: sort_order = position x 10 within the kind. */
export function applyKindOrder(
  rows: readonly AdminAnnouncementRow[],
  kind: AnnouncementKind,
  ids: readonly string[],
): AdminAnnouncementRow[] {
  const position = new Map<string, number>();
  ids.forEach((id, i) => position.set(id, (i + 1) * 10));
  return rows
    .map((r) => (r.kind === kind && position.has(r.id) ? { ...r, sort_order: position.get(r.id) as number } : r))
    .sort(compareAdminRows);
}
