'use client';

import { useState, type ReactNode } from 'react';
import { Copy, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
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
import { frequencyNote } from '@/lib/announcements/all-tenants-confirm';
import { canShowAgain, reachSummary, showAgainBlockedReason, type RowPending } from '@/lib/announcements/row-actions';
import { cn } from '@/lib/utils';
import { QUIET_BUTTON } from './form-field';
import { ToneIcon } from './tone-icon';

/** The row's small icon actions (with QUIET_BUTTON): one size, muted ink, and a visibly unavailable state. */
const ICON_ACTION =
  'h-9 w-9 text-muted-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground dark:aria-disabled:hover:bg-transparent';

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
  statsCountSuperAdmins = true,
  handle,
  dragging,
  pending,
  duplicatingId,
  onToggleActive,
  onEdit,
  onDelete,
  onShowAgain,
  onDuplicate,
}: {
  row: AdminAnnouncementRow;
  selectedTenantCount: number;
  /** undefined when stats loaded but this row has none yet (counts are zero). */
  stats: AdminAnnouncementStats | undefined;
  statsAvailable: boolean;
  /** false: the stats are staff only (older stats function). */
  statsCountSuperAdmins?: boolean;
  handle: ReactNode;
  dragging?: boolean;
  /** A write for this row that is still in flight. */
  pending?: RowPending | null;
  /** The row whose duplicate is being prepared (images copying), if any: one at a time. */
  duplicatingId?: string | null;
  onToggleActive: (row: AdminAnnouncementRow, next: boolean) => void;
  onEdit: (row: AdminAnnouncementRow) => void;
  onDelete: (row: AdminAnnouncementRow) => void;
  onShowAgain: (row: AdminAnnouncementRow) => void;
  onDuplicate: (row: AdminAnnouncementRow) => void;
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
        <ReachLine row={row} stats={stats} available={statsAvailable} superAdminsCounted={statsCountSuperAdmins} />
      </div>

      <div className="order-3 ml-auto flex shrink-0 items-center gap-1 md:order-2 xl:order-none">
        <Switch
          checked={row.is_active}
          onCheckedChange={(next) => onToggleActive(row, next)}
          disabled={pending === 'show-again' || pending === 'asking'}
          aria-busy={pending === 'asking' ? true : undefined}
          aria-label="Active"
          title={row.is_active ? 'Active' : 'Inactive'}
          className="mr-2"
        />
        {canShowAgain(row) ? (
          <ShowAgainButton row={row} pending={pending} onShowAgain={onShowAgain} />
        ) : (
          // Hard items always show, so there is nothing to show again; keep the actions aligned. The slot
          // still spins while the row's All tenants question waits for the tenant count.
          <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center">
            {pending === 'asking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </span>
        )}
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
        <DuplicateButton row={row} duplicatingId={duplicatingId ?? null} onDuplicate={onDuplicate} />
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

/**
 * aria-disabled rather than disabled: the button stays focusable and hoverable,
 * so its tooltip can say why it is unavailable.
 */
function ShowAgainButton({
  row,
  pending,
  onShowAgain,
}: {
  row: AdminAnnouncementRow;
  pending: RowPending | null | undefined;
  onShowAgain: (row: AdminAnnouncementRow) => void;
}) {
  const blocked = showAgainBlockedReason(row, pending);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(QUIET_BUTTON, ICON_ACTION)}
          aria-label={'Show ' + row.title + ' again to everyone who closed it'}
          aria-disabled={blocked ? true : undefined}
          onClick={() => {
            if (!blocked) onShowAgain(row);
          }}
        >
          {pending === 'show-again' || pending === 'asking' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {blocked ?? 'Show again to everyone who closed it'}
      </TooltipContent>
    </Tooltip>
  );
}

function DuplicateButton({
  row,
  duplicatingId,
  onDuplicate,
}: {
  row: AdminAnnouncementRow;
  duplicatingId: string | null;
  onDuplicate: (row: AdminAnnouncementRow) => void;
}) {
  const mine = duplicatingId === row.id;
  const blocked = mine ? 'Copying images…' : duplicatingId !== null ? 'Another duplicate is being prepared.' : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(QUIET_BUTTON, ICON_ACTION)}
          aria-label={'Duplicate ' + row.title}
          aria-disabled={blocked ? true : undefined}
          aria-busy={mine || undefined}
          onClick={() => {
            if (!blocked) onDuplicate(row);
          }}
        >
          {mine ? <Loader2 className="animate-spin" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {blocked ?? 'Duplicate'}
      </TooltipContent>
    </Tooltip>
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
  superAdminsCounted,
}: {
  row: AdminAnnouncementRow;
  stats: AdminAnnouncementStats | undefined;
  available: boolean;
  superAdminsCounted: boolean;
}) {
  const reach = available ? reachSummary(row, stats, superAdminsCounted) : null;
  const note = frequencyNote(row);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="w-fit max-w-full cursor-help text-left text-xs leading-5 text-muted-foreground underline decoration-dotted underline-offset-4 [overflow-wrap:anywhere] hover:text-foreground"
        >
          {reach ? reach.headline : 'Reach unavailable'}
          {reach?.superAdminNote && (
            <>
              {' '}
              <span className="whitespace-nowrap">{reach.superAdminNote}</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs space-y-0.5 text-xs">
        {reach ? (
          reach.details.map((line, i) => (
            <p key={i} className={cn(i === reach.details.length - 1 && reach.endsWithFootnote && 'pt-1 text-muted-foreground')}>
              {line}
            </p>
          ))
        ) : (
          <p>The view and click counts could not be loaded.</p>
        )}
        {/* Every row says what its frequency means; for "Once" that is why people who closed it no longer see it. */}
        <p data-frequency-note className="!mt-1.5 border-t border-border pt-1.5 leading-5">
          {note.lead}
          {note.showAgain && (
            <>
              {' '}
              {note.showAgain.before}
              <span className="inline-flex items-baseline gap-1 whitespace-nowrap font-semibold">
                <RotateCcw className="h-3 w-3 shrink-0 self-center" aria-hidden />
                Show again
              </span>
              {note.showAgain.after}
            </>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
