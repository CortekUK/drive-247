'use client';

import { sanitizeHtml } from '@/lib/sanitize-html';

interface Props {
  html: string | null | undefined;
  className?: string;
}

export function AnnouncementBody({ html, className }: Props) {
  if (!html) return null;
  return (
    <div
      className={
        className ??
        'prose prose-sm dark:prose-invert max-w-none text-foreground/90 [&_a]:text-primary'
      }
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}
