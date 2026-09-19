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
  normalizeAdminAnnouncementStats,
  validateSaveArgs,
  type AdminAnnouncementRow,
  type AdminAnnouncementStats,
  type AnnouncementKind,
  type AnnouncementSlide,
  type ImageSlot,
  type SaveAnnouncementArgs,
  type SegmentKey,
  type SegmentMatchTenant,
} from './contract';
import { countActiveTenants } from './all-tenants-confirm';
import { IMAGE_ERRORS, checkImageFile, newAnnouncementImagePath } from './image-upload';
import {
  buildDuplicateSeed,
  canShowAgain,
  duplicateImagePaths,
  imageCopyJobs,
  showAgainSaveArgs,
  statsCountSuperAdmins,
  type DuplicateSeed,
  type ImageCopyJob,
  type ImageCopyResult,
} from './row-actions';
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

/**
 * Shown when a write reaches the database WITHOUT a signed-in user. The browser
 * session had expired (Sep 17 2026: a tab left open for hours sent Save as the
 * anon role, and Postgres answered "permission denied for function
 * admin_save_portal_announcement"), so the raw message blamed permissions that
 * the super admin actually has.
 */
export const SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Sign in again (a new tab is fine), then press Save here again. Your edits are kept.';
export const NOT_SUPER_ADMIN_MESSAGE = 'Only a super admin can change announcements.';

/**
 * Anon-role refusals: Postgres "permission denied for function/table …" (42501)
 * and PostgREST's JWT errors. The RPCs' own super-admin check raises 42501 with
 * "not permitted", which is a real permission problem, not an expired session.
 */
export function isSessionError(error: PgError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST301' || error.code === 'PGRST302' || error.code === 'PGRST303') return true;
  return error.code === '42501' && /permission denied for (function|table|relation|schema)/i.test(error.message || '');
}

function fail<T>(error: PgError | null | undefined, fallback: string): Result<T> {
  if (isSessionError(error)) return { ok: false, message: SESSION_EXPIRED_MESSAGE, code: 'SESSION_EXPIRED' };
  if (error?.code === '42501' && /not permitted/i.test(error.message || '')) {
    return { ok: false, message: NOT_SUPER_ADMIN_MESSAGE, code: '42501' };
  }
  return { ok: false, message: error?.message || fallback, code: error?.code ?? null };
}

/**
 * Makes sure a write goes out with a live session: supabase-js refreshes an
 * expired access token from the refresh token here. False when no session can
 * be restored, so the caller shows SESSION_EXPIRED_MESSAGE instead of sending
 * the write as anon.
 */
async function ensureSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (session && (!session.expires_at || session.expires_at * 1000 > Date.now() + 30_000)) return true;
    const refreshed = await supabase.auth.refreshSession();
    return !!refreshed.data.session;
  } catch {
    return false;
  }
}

function sessionExpired<T>(): Result<T> {
  return { ok: false, message: SESSION_EXPIRED_MESSAGE, code: 'SESSION_EXPIRED' };
}

/**
 * SESSION_EXPIRED_MESSAGE talks about the editor ("press Save here again. Your edits are kept."). A
 * write made anywhere else says what to do again in its own place instead.
 */
function withSessionMessage<T>(res: Result<T>, message: string): Result<T> {
  return !res.ok && res.code === 'SESSION_EXPIRED' ? { ...res, message } : res;
}

/** The Active switch in the list. */
export function activeSessionExpiredMessage(isActive: boolean): string {
  return 'Your sign-in has expired. Sign in again (a new tab is fine), then switch it ' + (isActive ? 'on' : 'off') + ' again.';
}
export const DELETE_SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Sign in again (a new tab is fine), then press Delete again.';
export const REORDER_SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Sign in again (a new tab is fine), then drag it into place again.';

function thrown<T>(e: unknown, fallback: string): Result<T> {
  return { ok: false, message: e instanceof Error && e.message ? e.message : fallback, code: null };
}

/**
 * The row this page is showing is not in the database any more.
 *
 * supabase-js returns `{ error: null, data: [] }` when RLS filters a write out
 * AND when the row simply is not there, so a zero-row DELETE or UPDATE cannot
 * be read as either on its own. Callers that get this code must REFRESH the
 * list: the screen is stale, and every retry against that id will fail exactly
 * the same way. Sep 18 2026: three system announcements had already been
 * deleted, the list still showed them because a failed delete never refetched,
 * and "Reload the page and try again" appeared on every attempt — correct, and
 * useless, because the row it pointed at could not be deleted by anyone.
 */
export const STALE_ROW_CODE = 'STALE_ROW';

/**
 * Which of the two zero-row causes was it?
 *
 * One extra read, only on the failure path. SELECT on the announcement table is
 * governed by the same `is_super_admin()` policy as the write, so:
 *  - the row reads back  → it exists and the WRITE was refused → a real
 *    permission problem, and saying "already deleted" would be a lie;
 *  - the row does not    → it is gone (or was never visible to this session),
 *    so the list is stale and must be refreshed.
 */
async function classifyZeroRows<T>(id: string, staleMessage: string): Promise<Result<T>> {
  try {
    const { data, error } = await supabase
      .from(ANNOUNCEMENT_TABLES.content)
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!error && data) {
      return { ok: false, message: NOT_SUPER_ADMIN_MESSAGE, code: '42501' };
    }
  } catch {
    /* fall through to the stale answer: we still know the write did nothing */
  }
  return { ok: false, message: staleMessage, code: STALE_ROW_CODE };
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
  /**
   * false when the database still has the OLDER nine-column stats function: the counts are
   * then staff only (the contract falls back to them) and the tooltip says so.
   */
  statsCountSuperAdmins: boolean;
}

export type LoadAnnouncementsResult =
  | { status: 'ready'; data: AnnouncementsData }
  | { status: 'not-installed' }
  | { status: 'error'; message: string };

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
    let superAdminsCounted = true;
    if (statsRes.error) {
      console.warn('[announcements] reach stats unavailable:', statsRes.error.message);
    } else {
      statsById = {};
      const raws = (statsRes.data as unknown[] | null) ?? [];
      superAdminsCounted = statsCountSuperAdmins(raws);
      for (const raw of raws) {
        const stats = normalizeAdminAnnouncementStats(raw);
        if (stats) statsById[stats.announcement_id] = stats;
      }
    }

    return { status: 'ready', data: { rows, targetsById, statsById, statsCountSuperAdmins: superAdminsCounted } };
  } catch (e) {
    return { status: 'error', message: e instanceof Error && e.message ? e.message : 'Could not load announcements.' };
  }
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function saveAnnouncement(args: SaveAnnouncementArgs): Promise<Result<string>> {
  try {
    if (!(await ensureSession())) return sessionExpired();
    const { data, error } = await supabase.rpc(ANNOUNCEMENT_RPC.save, args);
    if (error) return fail(error, 'Could not save the announcement.');
    return { ok: true, data: typeof data === 'string' ? data : '' };
  } catch (e) {
    return thrown(e, 'Could not save the announcement.');
  }
}

export async function reorderAnnouncements(kind: AnnouncementKind, ids: string[]): Promise<Result<null>> {
  return withSessionMessage(await reorderAnnouncementsInner(kind, ids), REORDER_SESSION_EXPIRED_MESSAGE);
}

async function reorderAnnouncementsInner(kind: AnnouncementKind, ids: string[]): Promise<Result<null>> {
  try {
    if (!(await ensureSession())) return sessionExpired();
    const { error } = await supabase.rpc(ANNOUNCEMENT_RPC.reorder, { p_kind: kind, p_ids: ids });
    if (error) return fail(error, 'Could not save the new order.');
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not save the new order.');
  }
}

/** Zero rows back means RLS refused or the row is gone: both are failures, not silent successes. */
export async function setAnnouncementActive(id: string, isActive: boolean): Promise<Result<null>> {
  return withSessionMessage(await setAnnouncementActiveInner(id, isActive), activeSessionExpiredMessage(isActive));
}

async function setAnnouncementActiveInner(id: string, isActive: boolean): Promise<Result<null>> {
  try {
    if (!(await ensureSession())) return sessionExpired();
    const { data, error } = await supabase
      .from(ANNOUNCEMENT_TABLES.content)
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id');
    if (error) return fail(error, 'Could not change Active.');
    if (!Array.isArray(data) || data.length !== 1) {
      if (!(await ensureSession())) return sessionExpired();
      return await classifyZeroRows(id, 'That announcement is no longer there. The list is up to date now.');
    }
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not change Active.');
  }
}

export async function deleteAnnouncement(id: string): Promise<Result<null>> {
  return withSessionMessage(await deleteAnnouncementInner(id), DELETE_SESSION_EXPIRED_MESSAGE);
}

async function deleteAnnouncementInner(id: string): Promise<Result<null>> {
  try {
    if (!(await ensureSession())) return sessionExpired();
    const { data, error } = await supabase.from(ANNOUNCEMENT_TABLES.content).delete().eq('id', id).select('id');
    if (error) return fail(error, 'Could not delete the announcement.');
    if (!Array.isArray(data) || data.length !== 1) {
      if (!(await ensureSession())) return sessionExpired();
      return await classifyZeroRows(id, 'That announcement had already been deleted. The list is up to date now.');
    }
    return { ok: true, data: null };
  } catch (e) {
    return thrown(e, 'Could not delete the announcement.');
  }
}

// ─── Show again ──────────────────────────────────────────────────────────────

/**
 * Re-show one SOFT announcement to everyone who closed it: the save RPC with
 * p_reshow and the row's current content, targets and settings unchanged, which
 * bumps its revision. The row and its tenants are read fresh first, so an edit
 * made in another tab since this page loaded is kept, not overwritten.
 */
export const SHOW_AGAIN_SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Sign in again (a new tab is fine), then press Show again here.';

export async function showAnnouncementAgain(id: string): Promise<Result<string>> {
  return withSessionMessage(await showAnnouncementAgainInner(id), SHOW_AGAIN_SESSION_EXPIRED_MESSAGE);
}

async function showAnnouncementAgainInner(id: string): Promise<Result<string>> {
  const fallback = 'Could not show it again.';
  try {
    if (!(await ensureSession())) return sessionExpired();
    const [rowRes, targetsRes] = await Promise.all([
      supabase.from(ANNOUNCEMENT_TABLES.content).select('*').eq('id', id),
      supabase.from(ANNOUNCEMENT_TABLES.targets).select('tenant_id').eq('announcement_id', id),
    ]);
    if (rowRes.error) return fail(rowRes.error, fallback);
    if (targetsRes.error) return fail(targetsRes.error, fallback);
    const raw = ((rowRes.data as unknown[] | null) ?? [])[0];
    if (raw === undefined) {
      return { ok: false, message: 'This announcement no longer exists. Reload the page.', code: null };
    }
    const row = normalizeAdminAnnouncementRow(raw);
    if (!row) return { ok: false, message: 'This announcement could not be read. Open Edit and save it first.', code: null };
    if (!canShowAgain(row)) {
      return { ok: false, message: 'Hard announcements already show every time. Reload the page.', code: null };
    }
    if (!row.is_active) {
      return { ok: false, message: 'It was switched off in the meantime. Reload the page, turn it on, then try again.', code: null };
    }
    const tenantIds = ((targetsRes.data as Array<{ tenant_id: string }> | null) ?? []).map((t) => t.tenant_id);
    const args = showAgainSaveArgs(row, tenantIds);
    if (!validateSaveArgs(args).valid) {
      return { ok: false, message: 'Something in this announcement needs fixing first. Open Edit, fix it and save.', code: null };
    }
    const { data, error } = await supabase.rpc(ANNOUNCEMENT_RPC.save, args);
    if (error) return fail(error, fallback);
    return { ok: true, data: typeof data === 'string' ? data : id };
  } catch (e) {
    return thrown(e, fallback);
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
    if (!(await ensureSession())) return sessionExpired();
    const { error } = await supabase.storage
      .from(ANNOUNCEMENT_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (error) {
      // Storage answers an anon upload with an RLS message, not 42501.
      if (/row-level security|unauthori[sz]ed|jwt/i.test(error.message || '') && !(await ensureSession())) return sessionExpired();
      return fail(error, 'Upload failed.');
    }
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

/** A copy that takes longer than this is treated as failed; if it lands later, its object is removed. */
export const IMAGE_COPY_TIMEOUT_MS = 20_000;

export const DUPLICATE_SESSION_EXPIRED_MESSAGE =
  'Your sign-in has expired. Sign in again (a new tab is fine), then press Duplicate again.';

/**
 * Copy one announcement image to a new object of its own (storage copy: needs
 * the bucket's SELECT and INSERT policies, both super admin). Resolves to the
 * copy's public URL, never to the source's.
 */
export async function copyAnnouncementImage(job: ImageCopyJob): Promise<Result<string>> {
  const paths = duplicateImagePaths(job.sourceUrl, job.slot, crypto.randomUUID());
  if (!paths) return { ok: false, message: IMAGE_ERRORS.address, code: null };
  const bucket = supabase.storage.from(ANNOUNCEMENT_BUCKET);
  let settled = false;
  let timedOut = false;
  const copy = (async (): Promise<Result<string>> => {
    try {
      const { error } = await bucket.copy(paths.from, paths.to);
      if (error) return fail(error, 'Image copy failed.');
      const url = bucket.getPublicUrl(paths.to).data?.publicUrl;
      if (!isAnnouncementImageUrl(url) || url === job.sourceUrl) {
        await bucket.remove([paths.to]).catch(() => undefined);
        return { ok: false, message: IMAGE_ERRORS.address, code: null };
      }
      return { ok: true, data: url };
    } catch (e) {
      return thrown(e, 'Image copy failed.');
    } finally {
      settled = true;
    }
  })();
  // A copy that finishes after the timeout would be an object nobody references: delete it.
  void copy.then((res) => {
    if (timedOut && res.ok) void removeAnnouncementImages([res.data]);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<string>>((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      resolve({ ok: false, message: 'Image copy timed out.', code: null });
    }, IMAGE_COPY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([copy, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Everything the editor needs to open a duplicate of `row` in CREATE mode:
 * its images copied to objects the duplicate owns (card and every slide), and
 * the prefilled draft. Nothing is written to the announcement tables. A failed
 * copy leaves that image empty with a note; a signed-out browser stops here.
 */
export async function prepareDuplicate(
  row: AdminAnnouncementRow,
  tenantIds: readonly string[],
): Promise<Result<DuplicateSeed>> {
  try {
    const jobs = imageCopyJobs(row);
    if (jobs.length > 0 && !(await ensureSession())) {
      return { ok: false, message: DUPLICATE_SESSION_EXPIRED_MESSAGE, code: 'SESSION_EXPIRED' };
    }
    const results: ImageCopyResult[] = await Promise.all(
      jobs.map(async (job) => {
        const res = await copyAnnouncementImage(job).catch((e: unknown) => thrown<string>(e, 'Image copy failed.'));
        if (!res.ok) console.warn('[announcements] image copy failed:', res.message);
        return { job, url: res.ok ? res.data : null };
      }),
    );
    if (jobs.length > 0 && results.every((r) => r.url === null) && !(await ensureSession())) {
      return { ok: false, message: DUPLICATE_SESSION_EXPIRED_MESSAGE, code: 'SESSION_EXPIRED' };
    }
    return { ok: true, data: buildDuplicateSeed(row, tenantIds, results) };
  } catch (e) {
    return thrown(e, 'Could not prepare the duplicate.');
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

/**
 * How many ACTIVE tenants an All tenants announcement reaches, for its confirmation when the
 * page has no stats to read it from: the picker's own tenant read, counted like the stats
 * function counts reachable tenants (status 'active').
 *
 * Gives up after TENANT_COUNT_TIMEOUT_MS: a read that never answers must not leave Save spinning or
 * the list's switch and Show again waiting for good. The question then opens without N.
 */
export const TENANT_COUNT_TIMEOUT_MS = 5_000;

export async function loadActiveTenantCount(timeoutMs: number = TENANT_COUNT_TIMEOUT_MS): Promise<Result<number>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<PickerTenant[]>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, message: 'Reading the tenant count timed out.', code: 'TIMEOUT' }), timeoutMs);
  });
  try {
    const res = await Promise.race([loadPickerTenants(), timeout]);
    return res.ok ? { ok: true, data: countActiveTenants(res.data) } : res;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
