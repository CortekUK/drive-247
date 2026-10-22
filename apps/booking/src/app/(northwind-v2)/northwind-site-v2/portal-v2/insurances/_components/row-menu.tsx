'use client';

/**
 * The row's three actions — View, Download, Delete — behind one vertical
 * three-dot trigger (owner, Oct 22 2026: "not inline buttons"; "no dialog
 * here. Row actions only: view, download, delete"). Text items, no glyphs.
 *
 *   - View opens the document itself in a new tab, in the browser's PDF viewer.
 *   - Download saves it straight from the row.
 *   - Delete asks first; offered only where it can happen, and disabled with
 *     the reason otherwise, so the three actions keep their places on every row.
 *
 * A Bonzah policy with several PDFs (one per coverage) gets a View and a
 * Download submenu, one item per PDF; with none yet, both are disabled and say so.
 */

import type { SyntheticEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight, EllipsisVertical } from 'lucide-react-nw';

import { MOTION_ANCHORED } from '@nw/components/ui/motion';
import type { CustomerInsurancePolicy } from '@nw/hooks/use-customer-documents';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_GHOST_ICON_SM } from '@portal-v2-shared/button-styles';

import type { InsuranceRow } from './rows';

const CONTENT =
  'z-50 min-w-44 rounded-2xl border border-pv-border bg-pv-card p-1.5 text-pv-fg shadow-lg outline-none';

const ITEM =
  'flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] text-pv-fg outline-none ' +
  'transition-colors duration-200 data-[highlighted]:bg-pv-hover data-[state=open]:bg-pv-hover ' +
  'data-[disabled]:cursor-default data-[disabled]:text-pv-muted-fg data-[disabled]:opacity-70 motion-reduce:transition-none';

const stop = (event: SyntheticEvent) => event.stopPropagation();

export function RowMenu({
  row,
  onViewDocument,
  onViewPolicy,
  onDownloadDocument,
  onDownloadPolicy,
  onDelete,
  downloading,
  viewing,
}: {
  row: InsuranceRow;
  onViewDocument: () => void;
  onViewPolicy: (entry: CustomerInsurancePolicy['pdfIds'][number]) => void;
  onDownloadDocument: () => void;
  onDownloadPolicy: (entry: CustomerInsurancePolicy['pdfIds'][number]) => void;
  onDelete: () => void;
  downloading: boolean;
  viewing: boolean;
}) {
  const pdfs = row.kind === 'bonzah' ? row.policy.pdfIds : [];
  const canDownload = row.kind === 'upload' ? Boolean(row.document.storagePath) : pdfs.length > 0;
  const canDelete = row.kind === 'upload' && row.document.canDelete;
  const noPdfHint = !canDownload && row.kind === 'bonzah' ? 'No PDF yet' : null;
  const viewHint = viewing ? 'Opening…' : noPdfHint;
  const downloadHint = downloading ? 'Downloading…' : noPdfHint;
  const deleteHint =
    row.kind === 'bonzah' ? 'Bonzah policy' : canDelete ? null : 'Filed with a rental';

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${row.name}`}
          onClick={stop}
          onKeyDown={stop}
          className={cn(V2_BUTTON_GHOST_ICON_SM, 'text-pv-muted-fg')}
        >
          <EllipsisVertical aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          onClick={stop}
          className={cn(CONTENT, MOTION_ANCHORED)}
        >
          {pdfs.length > 1 ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={ITEM} disabled={viewing}>
                {viewing ? 'Opening…' : 'View'}
                <ChevronRight aria-hidden className="size-3.5 text-pv-muted-fg" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={6} onClick={stop} className={cn(CONTENT, MOTION_ANCHORED)}>
                  {pdfs.map((entry) => (
                    <DropdownMenu.Item key={entry.coverage} className={ITEM} onSelect={() => onViewPolicy(entry)}>
                      {entry.label} policy
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : (
            <DropdownMenu.Item
              className={ITEM}
              disabled={!canDownload || viewing}
              onSelect={() => (row.kind === 'upload' ? onViewDocument() : onViewPolicy(pdfs[0]))}
            >
              View
              {viewHint ? <span className="text-xs text-pv-muted-fg">{viewHint}</span> : null}
            </DropdownMenu.Item>
          )}

          {pdfs.length > 1 ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={ITEM} disabled={downloading}>
                {downloading ? 'Downloading…' : 'Download'}
                <ChevronRight aria-hidden className="size-3.5 text-pv-muted-fg" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={6} onClick={stop} className={cn(CONTENT, MOTION_ANCHORED)}>
                  {pdfs.map((entry) => (
                    <DropdownMenu.Item key={entry.coverage} className={ITEM} onSelect={() => onDownloadPolicy(entry)}>
                      {entry.label} policy
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : (
            <DropdownMenu.Item
              className={ITEM}
              disabled={!canDownload || downloading}
              onSelect={() => (row.kind === 'upload' ? onDownloadDocument() : onDownloadPolicy(pdfs[0]))}
            >
              Download
              {downloadHint ? <span className="text-xs text-pv-muted-fg">{downloadHint}</span> : null}
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-pv-border" />

          <DropdownMenu.Item
            className={cn(ITEM, canDelete && 'text-pv-danger data-[highlighted]:bg-pv-danger-light data-[highlighted]:text-pv-danger')}
            disabled={!canDelete}
            onSelect={onDelete}
          >
            Delete
            {deleteHint ? <span className="text-xs text-pv-muted-fg">{deleteHint}</span> : null}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
