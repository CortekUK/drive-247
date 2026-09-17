'use client';

import { useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  BLOCKING_LABEL,
  DISPLAY_LABEL,
  TONE_CLASSES,
  TONE_META,
  frequencyLabel,
  targetingLabel,
  type AdminAnnouncementRow,
  type AdminAnnouncementStats,
} from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { QUIET_BUTTON } from './form-field';
import { ToneIcon } from './tone-icon';

function plural(n: number, one: string, many: string): string {
  return n + ' ' + (n === 1 ? one : many);
}

/**
 * One announcement in the admin list. One line at `xl`; from `md` the title and
 * actions share a line with chips and reach below; on phones it stacks title,
 * chips and reach, then actions.
 */
export function AnnouncementRow({
  row,
  selectedTenantCount,
  stats,
  statsAvailable,
  handle,
  dragging,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  row: AdminAnnouncementRow;
  selectedTenantCount: number;
  /** undefined when stats loaded but this row has none yet (counts are zero). */
  stats: AdminAnnouncementStats | undefined;
  statsAvailable: boolean;
  handle: ReactNode;
  dragging?: boolean;
  onToggleActive: (row: AdminAnnouncementRow, next: boolean) => void;
  onEdit: (row: AdminAnnouncementRow) => void;
  onDelete: (row: AdminAnnouncementRow) => void;
}) {
  const isFeature = row.kind === 'feature';
  const second = (isFeature ? row.summary : row.body)?.replace(/\s*\n+\s*/g, ' ') ?? '';
  const targeting =
    targetingLabel(row.audience, row.segment_key, selectedTenantCount) +
    (row.audience === 'segment' && statsAvailable ? ' · ' + (stats?.audience_tenants ?? 0) + ' match now' : '');

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border border-border bg-card p-3 transition-shadow',
        dragging && 'shadow-lg ring-1 ring-primary/30',
      )}
      data-announcement-row={row.id}
    >
      <div className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
        {handle}
        <RowThumb row={row} />
        <div className={cn('min-w-0 flex-1', !row.is_active && 'opacity-60')}>
          <p className="truncate text-sm font-semibold text-foreground" title={row.title}>
            {row.title}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={second}>
            {second}
          </p>
        </div>
      </div>

      <div className="order-2 flex min-w-0 basis-full flex-col gap-1.5 md:order-3 xl:order-none xl:shrink-0 xl:basis-[380px]">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {!isFeature && row.tone && (
            <span
              className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
                TONE_CLASSES[row.tone].chip,
              )}
            >
              <ToneIcon tone={row.tone} className="h-3 w-3" aria-hidden />
              {TONE_META[row.tone].label}
            </span>
          )}
          {!isFeature && row.display && <Badge variant="secondary">{DISPLAY_LABEL[row.display]}</Badge>}
          {!isFeature && (
            <Badge variant={row.blocking === 'hard' ? 'destructive' : 'secondary'}>{BLOCKING_LABEL[row.blocking]}</Badge>
          )}
          <Badge variant="outline" className="min-w-0 max-w-full">
            <span className="truncate" title={targeting}>
              {targeting}
            </span>
          </Badge>
          <Badge variant="outline" className="whitespace-nowrap">
            {frequencyLabel(row.repeat_after_days, row.blocking)}
          </Badge>
        </div>
        <ReachLine row={row} stats={stats} available={statsAvailable} />
      </div>

      <div className="order-3 ml-auto flex shrink-0 items-center gap-1 md:order-2 xl:order-none">
        <Switch
          checked={row.is_active}
          onCheckedChange={(next) => onToggleActive(row, next)}
          aria-label="Active"
          title={row.is_active ? 'Active' : 'Inactive'}
          className="mr-2"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={QUIET_BUTTON}
          onClick={() => onEdit(row)}
          aria-label={'Edit ' + row.title}
        >
          <Pencil />
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 bg-transparent text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDelete(row)}
          aria-label={'Delete ' + row.title}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function RowThumb({ row }: { row: AdminAnnouncementRow }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (row.kind === 'system') {
    const tone = row.tone ?? 'info';
    return (
      <span
        aria-hidden
        className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[tone].chip)}
      >
        <ToneIcon tone={tone} className="h-5 w-5" />
      </span>
    );
  }
  if (!row.image_url || failed === row.image_url) {
    return (
      <span
        aria-hidden
        className="block h-12 w-12 shrink-0 rounded-lg bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.18),transparent_55%),linear-gradient(180deg,#f7f5f0,#ece8df)] ring-1 ring-foreground/10"
      />
    );
  }
  return (
    <img
      src={row.image_url}
      alt=""
      decoding="async"
      loading="lazy"
      className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-foreground/10"
      onError={() => setFailed(row.image_url)}
    />
  );
}

function ReachLine({
  row,
  stats,
  available,
}: {
  row: AdminAnnouncementRow;
  stats: AdminAnnouncementStats | undefined;
  available: boolean;
}) {
  if (!available) return <p className="text-xs text-muted-foreground">Reach unavailable</p>;
  const s = stats;
  const shownUsers = s?.shown_users ?? 0;
  const shownTenants = s?.shown_tenants ?? 0;
  const ctaUsers = s?.cta_users ?? 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="w-fit max-w-full cursor-help truncate text-left text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Seen by {plural(shownUsers, 'user', 'users')} in {plural(shownTenants, 'tenant', 'tenants')} ·{' '}
          {plural(ctaUsers, 'button click', 'button clicks')}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs space-y-0.5 text-xs">
        <p>Closed by {plural(s?.dismissed_users ?? 0, 'user', 'users')}</p>
        {row.kind === 'feature' && (
          <>
            <p>&ldquo;Don&apos;t show again&rdquo;: {plural(s?.dont_show_again_users ?? 0, 'user', 'users')}</p>
            <p>Card opened by {plural(s?.card_opened_users ?? 0, 'user', 'users')}</p>
          </>
        )}
        <p>
          Audience: {plural(s?.audience_tenants ?? 0, 'tenant', 'tenants')} ({s?.reachable_tenants ?? 0} reachable)
        </p>
        <p className="text-muted-foreground">Super admins are not counted.</p>
      </TooltipContent>
    </Tooltip>
  );
}
