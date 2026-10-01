"use client";

/**
 * Agreements v2 — Template Studio's right sidebar (Oct 1 2026).
 *
 * TOP: the agreement's pages, small, for getting around. Each thumbnail is the
 * live preview's own sheet (the same A4 page the PDF draws), cloned and scaled
 * down, windowed to one page's height; click one to jump there. Pages are A4
 * heights of the content area (842 pt less the renderer's 50 pt margins), as
 * the preview is one continuous sheet.
 *
 * The signer fields and your signatures live in the signing dock at the foot
 * of the document (./signing-dock-v2), where they are dropped.
 */

import { useEffect, useState, type ReactNode } from "react";

/** Kept for the editor's import; sections are no longer listed. */
export interface OutlineSection {
  index: number;
  level: 1 | 2 | 3;
  text: string;
  page: number;
}

/** Thumbnail width in CSS pixels. */
const THUMB_W = 132;

interface SheetSnapshot {
  /** The preview sheet's markup, already sanitised by the preview. */
  html: string;
  /** Its width on screen, which its container-query units are sized from. */
  width: number;
  /** One page of content, in the sheet's own pixels. */
  pageBody: number;
  pages: number;
}

function snapshot(previewRoot: HTMLElement | null): SheetSnapshot | null {
  const sheet = previewRoot?.querySelector<HTMLElement>(".agr-sheet");
  if (!sheet || sheet.clientWidth === 0) return null;
  const width = sheet.clientWidth;
  const pad = (width * 50) / 595;
  const pageBody = (width * 842) / 595 - pad * 2;
  const pages = Math.max(1, Math.ceil(Math.max(0, sheet.scrollHeight - pad * 2) / pageBody));
  return { html: sheet.outerHTML, width, pageBody, pages };
}

export function AgreementOutlinePane({
  previewRoot,
  content,
  onJumpToPage,
  actions,
  heading,
}: {
  /** The sidebar's heading (the studio puts the template's name here). */
  heading?: ReactNode;
  /** Beside the "Pages" heading (the studio's Cancel and Save). */
  actions?: ReactNode;
  /** The preview's element: its sheet is what the thumbnails show. */
  previewRoot: HTMLElement | null;
  /** The document as written: re-snapshots on change. */
  content: string;
  /** Scroll the agreement to page `index` (0-based). */
  onJumpToPage: (index: number, pages: number) => void;
}) {
  const [sheet, setSheet] = useState<SheetSnapshot | null>(null);

  useEffect(() => {
    if (!previewRoot) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSheet(snapshot(previewRoot)));
    };
    // The preview redraws a beat after the content changes (debounced).
    const timer = setTimeout(run, 300);
    const observer = new ResizeObserver(run);
    observer.observe(previewRoot);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [previewRoot, content]);

  return (
    <section aria-label="Pages" className="flex min-h-0 flex-1 flex-col">
      {/* On top of the sidebar: the template's name (the studio's heading). */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">{heading}</div>
        {actions}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {sheet ? (
          <ol className="flex flex-col items-center gap-4">
            {Array.from({ length: sheet.pages }, (_, i) => (
              <li key={i} className="flex flex-col items-center gap-1.5">
                <PageThumb sheet={sheet} index={i} onClick={() => onJumpToPage(i, sheet.pages)} />
                <span className="text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mx-auto animate-pulse rounded-md bg-muted" style={{ width: THUMB_W, height: (THUMB_W * 842) / 595 }} />
        )}
      </div>

    </section>
  );
}

/**
 * One page, small: the preview sheet at its real width (so its container-query
 * sizing is identical), scaled down, and shifted up to this page's window.
 */
function PageThumb({ sheet, index, onClick }: { sheet: SheetSnapshot; index: number; onClick: () => void }) {
  const scale = THUMB_W / sheet.width;
  const pageH = (sheet.width * 842) / 595;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to page ${index + 1}`}
      className="group relative block overflow-hidden rounded-md bg-white ring-1 ring-black/10 transition-shadow duration-200 ease-out hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      style={{ width: THUMB_W, height: pageH * scale }}
    >
      <div
        aria-hidden="true"
        className="agr-preview-v2 pointer-events-none absolute top-0 left-0 origin-top-left"
        style={{
          width: sheet.width,
          containerType: "inline-size",
          transform: `scale(${scale}) translateY(${-index * sheet.pageBody}px)`,
        }}
        dangerouslySetInnerHTML={{ __html: sheet.html }}
      />
    </button>
  );
}
