'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type PreviewDevice = 'desktop' | 'phone';

/** The portal viewport the preview pretends to be. */
export const PREVIEW_CANVAS: Readonly<Record<PreviewDevice, { width: number; height: number }>> = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 360, height: 740 },
};

const SRC_DOC = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

/** Give up on the iframe and render inline if its document never becomes usable. */
const FRAME_TIMEOUT_MS = 3000;

/**
 * A scaled "portal viewport" for the live preview.
 *
 * The contract's class maps use breakpoints (`sm:`, `md:`, `xl:`) and viewport
 * units (`100vw`, `100dvh`). Rendered inline, those would answer to the ADMIN
 * window, so a phone preview would still lay out as desktop. An iframe is its
 * own viewport: the preview tree is portalled into its body at the real canvas
 * size, then the whole frame is scaled down to the column. The admin's
 * stylesheets are copied in, so the same Tailwind build styles both.
 */
export function PreviewStage({
  device,
  dark,
  title,
  children,
}: {
  device: PreviewDevice;
  dark: boolean;
  title: string;
  children: ReactNode;
}) {
  const canvas = PREVIEW_CANVAS[device];
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const copies = useRef(new Map<Element, Element>());
  const [scale, setScale] = useState(0);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [inline, setInline] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setScale(w > 0 ? Math.min(1, w / canvas.width) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas.width]);

  /**
   * Mirror the admin <head> styles into the frame. Existing copies are kept (a
   * re-added <link> would reload and flash), new or changed ones are synced and
   * copies whose original is gone are dropped, so dev-time style updates still
   * reach the preview.
   */
  const syncFrame = useCallback(() => {
    let doc: Document | null = null;
    try {
      doc = frameRef.current?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!doc || doc.URL !== 'about:srcdoc' || !doc.head || !doc.body) return false;

    const originals = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'));
    const present = new Set<Element>(originals);
    copies.current.forEach((copy, original) => {
      if (!present.has(original) || copy.ownerDocument !== doc) {
        copy.remove();
        copies.current.delete(original);
      }
    });
    for (const original of originals) {
      const copy = copies.current.get(original);
      if (!copy) {
        const clone = original.cloneNode(true) as Element;
        doc.head.appendChild(clone);
        copies.current.set(original, clone);
      } else if (original.tagName === 'STYLE' && copy.textContent !== original.textContent) {
        copy.textContent = original.textContent;
      }
    }

    const html = doc.documentElement;
    html.className = document.documentElement.className;
    html.classList.toggle('dark', dark);
    html.style.height = '100%';
    doc.body.className = cn(document.body.className, 'font-sans antialiased');
    doc.body.style.margin = '0';
    doc.body.style.height = '100%';
    doc.body.style.overflow = 'hidden';
    setBody((current) => (current === doc!.body ? current : doc!.body));
    return true;
  }, [dark]);

  // Light/Dark and size changes re-sync (the frame itself is not reloaded).
  useEffect(() => {
    if (!inline) syncFrame();
  }, [syncFrame, device, inline]);

  useEffect(() => {
    if (inline || body) return;
    const timer = window.setTimeout(() => {
      if (!syncFrame()) setInline(true);
    }, FRAME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [body, inline, syncFrame]);

  const onLoad = () => {
    if (!syncFrame()) setInline(true);
  };

  /**
   * A click in the preview moves focus into the frame's own document, whose key
   * events never reach the editor dialog. Hand Escape back to the frame element
   * in the admin document, where the dialog's Escape listener picks it up (and
   * asks "Discard changes?" when there are edits).
   */
  useEffect(() => {
    const doc = body?.ownerDocument;
    if (!doc || inline) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const frame = frameRef.current;
      if (!frame) return;
      event.preventDefault();
      frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: event.code, bubbles: true, cancelable: true }));
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [body, inline]);

  const scaled = { width: canvas.width * scale, height: canvas.height * scale };
  const canvasStyle = {
    width: canvas.width,
    height: canvas.height,
    transform: 'scale(' + scale + ')',
    transformOrigin: 'top left',
  };

  return (
    <div ref={wrapRef} className="w-full min-w-0">
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10"
        style={scaled}
        data-preview-device={device}
      >
        {inline ? (
          <div className={cn('absolute left-0 top-0 overflow-hidden', dark && 'dark')} style={canvasStyle}>
            {children}
          </div>
        ) : (
          <iframe
            ref={frameRef}
            title={title}
            srcDoc={SRC_DOC}
            onLoad={onLoad}
            width={canvas.width}
            height={canvas.height}
            className="absolute left-0 top-0 block border-0"
            style={canvasStyle}
          />
        )}
      </div>
      {inline && <p className="mt-2 text-center text-xs text-muted-foreground">Preview approximated</p>}
      {/* react-dom's types resolve the repo-root @types/react (18.x) while admin
          uses 19.x, so the child is re-typed for the call; at runtime it is the same node. */}
      {!inline && body && createPortal(children as Parameters<typeof createPortal>[0], body)}
    </div>
  );
}
