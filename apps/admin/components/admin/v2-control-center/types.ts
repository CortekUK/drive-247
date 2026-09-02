/**
 * Local row shapes for the v2 Control Center.
 *
 * `lib/supabase.ts` builds an UNTYPED client — it never passes the generated
 * `Database` type as a generic — so nothing in this app reads
 * `src/integrations/supabase/types.ts`. These interfaces are therefore the only
 * description of these three tables on the client, and are kept in step with
 * `supabase/migrations/20260902120000_add_v2_control_center.sql` by hand.
 */

export const BATCH_STATUSES = [
  'not_started',
  'in_progress',
  'testing',
  'partial_rollout',
  'pending',
  'rejected',
  'completed',
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_TAGS = [
  'ui',
  'architecture',
  'api',
  'refactoring',
  'cutting',
  'testing',
  'documentation',
  'feature_addition',
] as const;

export type BatchTag = (typeof BATCH_TAGS)[number];

/** One row of `batches.checklist`, which is jsonb rather than a table. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
}

export interface Batch {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: BatchStatus;
  tags: string[];
  branch: string | null;
  owner: string | null;
  area: string | null;
  checklist: ChecklistItem[];
  killswitch: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantBatch {
  id: string;
  batch_id: string;
  tenant_id: string;
  enabled: boolean;
  enabled_at: string | null;
  enabled_by: string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchFile {
  id: string;
  batch_id: string;
  file_name: string;
  /** Object path inside the private `batch-files` bucket — NOT an absolute URL. */
  file_url: string;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Only the tenant fields the rollout panel needs. */
export interface TenantLite {
  id: string;
  slug: string;
  company_name: string;
  status: string | null;
}

export const STATUS_META: Record<BatchStatus, { label: string; className: string }> = {
  not_started: { label: 'Not started', className: 'bg-secondary text-muted-foreground border-border' },
  in_progress: { label: 'In progress', className: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  testing: { label: 'Testing', className: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  partial_rollout: { label: 'Partial rollout', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  pending: { label: 'Pending', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  rejected: { label: 'Rejected', className: 'bg-destructive/15 text-red-400 border-destructive/30' },
  completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

export const TAG_LABELS: Record<BatchTag, string> = {
  ui: 'UI',
  architecture: 'Architecture',
  api: 'API',
  refactoring: 'Refactoring',
  cutting: 'Cutting',
  testing: 'Testing',
  documentation: 'Documentation',
  feature_addition: 'Feature addition',
};

/**
 * A batch whose status still claims its `area`. Mirrors the partial unique
 * index `batches_area_live_uniq`: completed and rejected batches release the
 * screen they owned so the next batch can take it.
 */
export function statusHoldsArea(status: BatchStatus): boolean {
  return status !== 'completed' && status !== 'rejected';
}

/** jsonb arrives as `unknown`; never trust its shape. */
export function parseChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ChecklistItem[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.text !== 'string') return [];
    return [
      {
        id: item.id,
        text: item.text,
        done: item.done === true,
        done_at: typeof item.done_at === 'string' ? item.done_at : null,
        done_by: typeof item.done_by === 'string' ? item.done_by : null,
      },
    ];
  });
}

/** Rows come back from an untyped client, so normalise once at the edge. */
export function parseBatch(row: Record<string, unknown>): Batch {
  return {
    id: String(row.id),
    key: String(row.key),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    status: row.status as BatchStatus,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    branch: (row.branch as string | null) ?? null,
    owner: (row.owner as string | null) ?? null,
    area: (row.area as string | null) ?? null,
    checklist: parseChecklist(row.checklist),
    killswitch: row.killswitch === true,
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Turns a Postgres error into something an operator can act on.
 *
 * The area index is the one constraint a user will hit by accident and be
 * baffled by — its raw message names an index, not the rule.
 */
export function describeDbError(error: unknown, fallback: string): string {
  const err = error as { code?: string; message?: string } | null;
  const message = err?.message ?? fallback;
  if (message.includes('batches_area_live_uniq')) {
    return 'Another live batch already owns that area. Complete or reject that batch first, or pick a different area.';
  }
  if (message.includes('batches_key_key')) {
    return 'That batch key is already taken.';
  }
  if (message.includes('batches_key_check')) {
    return 'Batch keys must be lowercase letters, digits, dot, dash or underscore (e.g. "b1").';
  }
  return message;
}
