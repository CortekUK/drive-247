"use client";

/**
 * Agreements v2: the agreement's PDF, drawn straight onto the page — no
 * browser PDF viewer, no toolbar, no file name, no zoom bar (Oct 1 2026: "show
 * it straight away"). Each page is a white sheet on the muted backdrop, drawn
 * with pdf.js onto a canvas.
 *
 * Every page is sized so the WHOLE page fits the box (the first page is seen
 * entire on opening); further pages follow below it and the box scrolls.
 * Pages are drawn at the screen's pixel ratio so text stays sharp, and are
 * redrawn when the box is resized.
 *
 * pdf.js is loaded on first use (it is large), with its worker from the same
 * CDN `lib/pdf-to-image.ts` already uses.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type Load = { status: "loading" } | { status: "ready"; pdf: PDFDocumentProxy } | { status: "error" };

/**
 * The backdrop the pages sit on: a soft accent wash, the tenant's `--primary`
 * (the same family as the featured cards' ground), fading across the box.
 * Shared with the dialog's own document column so the loading state and the
 * HTML preview sit on the same ground.
 */
export const AGREEMENT_PAGE_BACKDROP_V2 =
  "bg-gradient-to-br from-primary/20 via-primary/[0.07] to-primary/15 dark:from-primary/25 dark:via-primary/[0.08] dark:to-primary/20";

/** Breathing room around a page inside the box, in CSS pixels. */
const GUTTER = 24;

export function AgreementPdfPagesV2({ url, title }: { url: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoad({ status: "loading" });
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("fetch");
        const data = await response.arrayBuffer();
        doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        setLoad({ status: "ready", pdf: doc });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
      if (doc) void doc.destroy();
    };
  }, [url]);

  // The box's size, settled: a resize redraws every page, so it waits a beat.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={`h-full w-full overflow-y-auto ${AGREEMENT_PAGE_BACKDROP_V2}`} aria-label={title} role="document">
      {load.status === "loading" || !box ? (
        <div className="flex h-full items-center justify-center" role="status">
          <Loader2 className="size-7 animate-spin text-primary motion-reduce:animate-none" aria-label="Loading the agreement" />
        </div>
      ) : load.status === "error" ? (
        <div className="flex h-full items-center justify-center p-6" role="alert">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto size-6 text-destructive" />
            <p className="mt-2 text-sm font-medium text-foreground">The pages could not be drawn</p>
            <p className="mt-1 text-sm text-muted-foreground">Use New tab to open the PDF instead.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4" style={{ padding: GUTTER }}>
          {Array.from({ length: load.pdf.numPages }, (_, i) => (
            <PdfPage key={i} pdf={load.pdf} number={i + 1} box={box} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({ pdf, number, box }: { pdf: PDFDocumentProxy; number: number; box: { w: number; h: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cssSize, setCssSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      // The whole page inside the box, less the gutter on each side.
      const fit = Math.max(
        0.1,
        Math.min((box.w - GUTTER * 2) / natural.width, (box.h - GUTTER * 2) / natural.height),
      );
      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;
      const viewport = page.getViewport({ scale: fit * dpr });
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      setCssSize({ w: natural.width * fit, h: natural.height * fit });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      task = page.render({ canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        // Cancelled by a newer draw (a resize): nothing to do.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, number, box.w, box.h]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Page ${number} of ${pdf.numPages}`}
      className="block shrink-0 rounded-sm bg-white ring-1 ring-black/10"
      style={cssSize ? { width: cssSize.w, height: cssSize.h } : { width: 0, height: 0 }}
    />
  );
}
