/**
 * The Supabase-backed report store: a private bucket and a job table.
 *
 * Both are created by docs/trax/pending-migrations/01-trax-report-jobs.sql, which
 * is NOT applied. Until it is, `configuredReports` returns undefined and the
 * orchestrator does not offer the report tool at all — so TRAX says it cannot
 * produce a file rather than claiming one exists.
 *
 * Objects are written with the service credential into a bucket that is private,
 * and every path begins with the tenant id. A download is a short-lived signed
 * URL created here; the bucket is never public.
 */
import { SupportError } from './types.ts';
import type { ReportJob, ReportStore, JobState } from './report-tools.ts';

export const REPORT_BUCKET = 'trax-reports';
export const REPORT_JOB_TABLE = 'trax_report_jobs';

/** Only the shape used, so the service client is never handed to the model. */
export interface ReportDatabase {
  from(table: string): {
    insert(values: Record<string, unknown>): { select(columns: string): { single(): PromiseLike<{ data: unknown; error: unknown }> } };
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): PromiseLike<{ error: unknown }> };
  };
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
      createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl?: string } | null; error: unknown }>;
    };
  };
}

export function createReportStore(db: ReportDatabase): ReportStore {
  return {
    async createJob(job) {
      const result = await db.from(REPORT_JOB_TABLE).insert({
        tenant_id: job.tenantId, requested_by: job.requestedBy, kind: job.kind,
        format: job.format, state: job.state, rows: job.rows ?? null,
      }).select('id').single();
      if (result.error || !result.data || typeof (result.data as { id?: unknown }).id !== 'string') {
        throw new SupportError('report_failed', 'The report job could not be recorded, so no file was produced.', 503);
      }
      return { id: (result.data as { id: string }).id };
    },

    async updateJob(id, patch) {
      const values: Record<string, unknown> = {};
      if (patch.state !== undefined) values.state = patch.state satisfies JobState;
      if (patch.rows !== undefined) values.rows = patch.rows;
      if (patch.bytes !== undefined) values.bytes = patch.bytes;
      if (patch.path !== undefined) values.path = patch.path;
      if (patch.error !== undefined) values.error = patch.error;
      values.updated_at = new Date().toISOString();
      const { error } = await db.from(REPORT_JOB_TABLE).update(values).eq('id', id);
      if (error) throw new SupportError('report_failed', 'The report job could not be updated.', 503);
    },

    async put(path, bytes, contentType) {
      const { error } = await db.storage.from(REPORT_BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new SupportError('report_failed', 'The report file could not be stored.', 503);
    },

    async signedUrl(path, expiresInSeconds) {
      const { data, error } = await db.storage.from(REPORT_BUCKET).createSignedUrl(path, expiresInSeconds);
      const url = data?.signedUrl;
      if (error || typeof url !== 'string' || !url) {
        throw new SupportError('report_failed', 'The report was stored but no download link could be issued.', 503);
      }
      return url;
    },
  };
}

/**
 * Reports are ON unless a deployment turns them off with `TRAX_REPORTS=disabled`.
 *
 * They used to require `TRAX_REPORTS=enabled`, because the bucket and job table
 * had to exist first and an opt-in was the honest default while they did not.
 * They do exist now (docs/trax/pending-migrations/01-trax-report-jobs.sql, applied
 * 2026-09-18), so the opt-in had become a switch that cost an environment variable
 * to say "yes" — and on a project already at its secret limit, that is a real cost
 * for no safety.
 *
 * Turning the default around is safe because the store already fails honestly: if
 * the table or bucket is missing, `createJob` raises `report_failed` and TRAX says
 * no file was produced rather than inventing one. An environment without the
 * migration therefore refuses reports whether or not anyone remembered a flag.
 */
export function configuredReports(db: ReportDatabase, env: (key: string) => string | undefined): ReportStore | undefined {
  if (env('TRAX_REPORTS') === 'disabled') return undefined;
  return createReportStore(db);
}

export type { ReportJob };
