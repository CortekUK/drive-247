'use client';

/**
 * Notifications v2, SYSTEM set: the email preview — an inbox frame around the
 * EXACT document the test send delivers.
 *
 * The admin twin of the portal's `email-preview-gmail.tsx`, cut to what this
 * page needs (one desktop-inbox frame rather than three device views).
 *
 * The HTML comes in already rendered by `renderNotificationEmailHtml`, the same
 * file `notification-test-v2` runs on the server, so what is on screen is what
 * lands in the inbox. It is NEVER parsed or rewritten here: it goes into an
 * `<iframe srcdoc>` with `sandbox="allow-same-origin"` and never
 * `allow-scripts`, so nothing in a template can run. `allow-same-origin` is
 * only there so this component can measure the document's height and swallow
 * clicks on links inside it; without scripts it grants the email nothing.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const MIN_HEIGHT = 240;
const MAX_HEIGHT = 900;

/**
 * The document's real height, or 0 when there is nothing to measure yet (the
 * blank page an iframe shows before its srcdoc loads). Measured on the body,
 * not the root: the root is never shorter than the frame, so a frame measured
 * by it could only ever grow.
 */
export function measureEmailDocumentHeight(doc: Document | null | undefined): number {
  const body = doc?.body;
  if (!body) return 0;
  const height = Math.max(body.scrollHeight ?? 0, body.offsetHeight ?? 0);
  return Number.isFinite(height) && height > 0 ? Math.min(height, MAX_HEIGHT) : 0;
}

/** The sender line as an inbox shows it: "Drive 247 <noreply@drive-247.com>". */
export function senderLine(fromName: string, fromAddress: string): string {
  const name = String(fromName ?? '').trim();
  const address = String(fromAddress ?? '').trim();
  if (name && address) return `${name} <${address}>`;
  return name || address;
}

export interface EmailPreviewProps {
  /** The subject with variables already filled. */
  subject: string;
  /** The whole HTML document from `renderNotificationEmailHtml`, variables filled. */
  html: string;
  fromName: string;
  fromAddress: string;
  /** Who it is addressed to, in the example story. */
  toAddress: string;
  className?: string;
}

export function EmailPreview({ subject, html, fromName, fromAddress, toAddress, className }: EmailPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const heightRef = useRef(MIN_HEIGHT);
  const labelId = useId();

  const measure = useCallback(() => {
    const next = measureEmailDocumentHeight(frameRef.current?.contentDocument);
    if (next > 0 && next !== heightRef.current) {
      heightRef.current = next;
      setHeight(next);
    }
  }, []);

  /**
   * A click inside the preview must not navigate the dashboard away. Without
   * scripts in the frame the only way to stop it is to listen on the document
   * we can reach through allow-same-origin.
   */
  const handleLoad = useCallback(() => {
    measure();
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const swallow = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.closest?.('a')) event.preventDefault();
    };
    doc.addEventListener('click', swallow, true);
  }, [measure]);

  // A late webfont or image can change the height after load.
  useEffect(() => {
    const timer = setTimeout(measure, 200);
    return () => clearTimeout(timer);
  }, [measure, html]);

  const shownSubject = subject.trim() || '(no subject)';

  return (
    <div
      className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}
      data-email-preview=""
      aria-labelledby={labelId}
      role="group"
    >
      <div className="space-y-1 border-b border-border px-4 py-3">
        <p id={labelId} className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {shownSubject}
        </p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-email-from="">
          {senderLine(fromName, fromAddress)}
        </p>
        {toAddress && (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-email-to="">
            to {toAddress}
          </p>
        )}
      </div>
      <iframe
        ref={frameRef}
        title={`Email preview: ${shownSubject}`}
        srcDoc={html}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        data-email-body=""
        className="w-full border-0 bg-white"
        style={{ height }}
      />
    </div>
  );
}

export default EmailPreview;
