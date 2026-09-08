import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { LegalDocument } from "@/lib/legal/legal-documents-server";

/**
 * A legal document authored by a super admin, rendered from markdown.
 *
 * Only mounted when `fetchLegalDocument` returned a published row. With no row
 * — no table yet, an outage, nothing published — the pages fall back to the
 * documents compiled into the bundle, so this never renders an empty shell.
 *
 * MARKDOWN, NOT HTML. The body is authored in apps/admin by a super admin and
 * stored as `body_md`, matching `welcome_pack_sections`. Storing HTML would put
 * a sanitiser between the author and the page and make the trust model of this
 * table "whatever the admin app happened to escape"; markdown has no script
 * vector to begin with, and `react-markdown` does not render raw HTML unless a
 * plugin is added to make it (none is, deliberately).
 *
 * The element map is a narrower copy of `WelcomeMarkdown` in apps/portal, tuned
 * for a long legal document read end to end rather than a help article skimmed:
 * a wider measure, numbered clauses that stay legible when nested, and no
 * image or code handling, because neither belongs in a policy.
 */
export function PublishedLegalDocument({ doc }: { doc: LegalDocument }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-20">
      <header className="mb-10">
        <h1 className="text-[32px] leading-[1.1] font-bold tracking-tighter text-balance sm:text-[40px]">
          {doc.title}
        </h1>

        {/* Version and date sit together and are always shown. A policy without
            a visible version is one nobody can refer to in a dispute, and the
            version here is the same string the admin editor warns about when it
            drifts from what checkout records against a signup. */}
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {doc.effectiveDate && <span>Effective {doc.effectiveDate}</span>}
          {doc.effectiveDate && <span aria-hidden="true">·</span>}
          <span>Version {doc.version}</span>
        </p>
      </header>

      <div className="text-[15px] leading-[1.75] text-foreground/85">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // `h1` maps to `h2`: the document's own title is the page's only
            // `h1`, and a second one would leave the outline with two roots.
            h1: ({ children }) => (
              <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground first:mt-0">
                {children}
              </h2>
            ),
            h2: ({ children }) => (
              <h3 className="mt-10 mb-3 text-lg font-semibold text-foreground first:mt-0">
                {children}
              </h3>
            ),
            h3: ({ children }) => (
              <h4 className="mt-8 mb-2 text-base font-semibold text-foreground first:mt-0">
                {children}
              </h4>
            ),
            p: ({ children }) => (
              <p className="my-4 first:mt-0 last:mb-0">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="my-4 list-disc space-y-2 pl-6 marker:text-muted-foreground">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="my-4 list-decimal space-y-2 pl-6 marker:text-muted-foreground">
                {children}
              </ol>
            ),
            li: ({ children }) => <li className="pl-1">{children}</li>,
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-indigo-600 underline underline-offset-4 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                // Authored content can link anywhere, so external links get the
                // usual protection rather than trusting the author to add it.
                {...(href?.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-5 border-l-2 border-border pl-4 text-muted-foreground">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-10 border-border" />,
            table: ({ children }) => (
              // Legal documents carry fee and retention tables; on a phone they
              // scroll in their own box rather than widening the page.
              <div className="my-6 overflow-x-auto">
                <table className="w-full border-collapse text-sm">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-border bg-muted/50 px-3 py-2 text-left font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-3 py-2 align-top">{children}</td>
            ),
          }}
        >
          {doc.bodyMd}
        </ReactMarkdown>
      </div>
    </article>
  );
}
