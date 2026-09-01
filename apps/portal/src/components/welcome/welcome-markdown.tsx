'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The document's typography.
 *
 * Markdown, not HTML — the announcements editor renders authored HTML through
 * `dangerouslySetInnerHTML`, and this document is longer, edited more often and
 * read by everyone, so it takes the format that cannot inject markup at all.
 * `remark-gfm` is what makes the comparison tables in the content render.
 *
 * Not a `prose` plugin either: the portal ships no typography classes, and the
 * pack needs a longer measure and a quieter rhythm than the rest of the app,
 * which is all tables and forms.
 */
export function WelcomeMarkdown({ children }: { children: string }) {
  return (
    <div className="text-[14.5px] leading-[1.7] text-foreground/85">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="text-lg font-semibold text-foreground mt-8 mb-3 first:mt-0">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="text-base font-semibold text-foreground mt-8 mb-3 first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-[15px] font-semibold text-foreground mt-7 mb-2 first:mt-0">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h5 className="text-[14px] font-semibold text-foreground mt-6 mb-2 first:mt-0">
              {children}
            </h5>
          ),
          p: ({ children }) => (
            <p className="my-3 max-w-[68ch] first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-3 max-w-[68ch] list-disc pl-5 space-y-1.5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 max-w-[68ch] list-decimal pl-5 space-y-1.5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 max-w-[68ch] border-l-2 border-primary/60 bg-muted/40 rounded-r-md py-2.5 px-4 text-foreground/80 [&>p]:my-0">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              {children}
            </code>
          ),
          hr: () => <hr className="my-7 border-border" />,
          // Wide tables scroll inside their own container so the page body
          // never scrolls sideways on a phone at the counter.
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-[13.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-primary/5 dark:bg-primary/10">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b px-3.5 py-2.5 text-left font-semibold text-foreground whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/60 px-3.5 py-2.5 align-top last:border-0">
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
