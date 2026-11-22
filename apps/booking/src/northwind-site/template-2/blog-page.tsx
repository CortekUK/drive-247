import Link from 'next/link';
import { ArrowLeft, ArrowRight, Newspaper } from 'lucide-react-nw';

import type { BlogPostFull, BlogPostSummary } from '@nw/lib/cms/queries';
import { cn } from '@nw/lib/utils';
import { htmlToBlocks, type PostBlock } from '@nw/site-v2/blog/html-blocks';
import { t2Href } from '@nw/template-2/links';

/**
 * Template 2 ("Glass") — the blog: the index of posts and one post. Server
 * components; the routes do the loading and the gating exactly as site-v2's
 * do (blog switched off, or no such published post, is a 404) and hand the
 * rows in.
 *
 * A post is read on the same near-white sheet as the legal pages, one
 * readable column (720px), with each block `htmlToBlocks` finds set in the
 * site's type. Text only, never injected HTML.
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const PAGE = 'mx-auto w-full max-w-[1320px] px-3 pt-[84px] sm:px-5 sm:pt-[96px]';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';
const SHEET = 'rounded-[26px] bg-white/80 shadow-[inset_0_1px_0_#fff,0_18px_40px_-30px_rgb(13_12_29/0.45)]';
const COLUMN = 'mx-auto w-full max-w-[720px]';

/** "2026-09-09" gives "9 September 2026". */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** The date, the author and the read time, whichever the post has. */
function Meta({ post, className }: { post: BlogPostSummary; className?: string }) {
  const parts = [formatDate(post.publishedAt), post.authorName, post.readingTimeMinutes ? `${post.readingTimeMinutes} min read` : null].filter(
    (part): part is string => !!part,
  );
  if (parts.length === 0) return null;
  return (
    <p className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[13.5px] text-[var(--g2-ink-soft)]', className)}>
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </p>
  );
}

/* ─────────────────────────────── index ──────────────────────────────────── */

export function Template2BlogIndex({ posts }: { posts: BlogPostSummary[] }) {
  return (
    <div className="pb-3">
      <section aria-labelledby="g2-blog-title" className={PAGE}>
        <div className={PANE}>
          <header className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10">
            <h1 id="g2-blog-title" className="text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] sm:text-[56px] lg:text-[64px]">
              News and guides.
            </h1>
            <p className="mx-auto mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
              Updates from us, and plain advice on renting and driving.
            </p>
          </header>

          {posts.length === 0 ? (
            <div className="g2-well g2-tray flex flex-col items-center rounded-[30px] px-6 py-12 text-center sm:py-14">
              <p className="text-[24px] font-semibold tracking-[-0.035em] text-[var(--g2-ink)]">Nothing published yet</p>
              <p className="mt-3 max-w-[30rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)]">
                There are no posts here yet. In the meantime, every car and its price is one click away.
              </p>
              <Link href={t2Href('/fleet')} className={cn('g2-cta mt-7 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold', FOCUS)}>
                See our cars
                <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
              </Link>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <li key={post.id} className="flex">
                  <Link
                    href={t2Href(`/blog/${post.slug}`)}
                    className={cn('g2-well g2-tray group flex w-full flex-col rounded-[28px] p-2 transition-colors duration-200 hover:bg-white/60', FOCUS)}
                  >
                    {post.featuredImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
                      <img src={post.featuredImageUrl} alt="" loading="lazy" className="aspect-[16/10] w-full rounded-[22px] bg-white/60 object-cover" />
                    ) : (
                      <span aria-hidden className="grid aspect-[16/10] w-full place-items-center rounded-[22px] bg-white/55 text-[var(--g2-accent-ink)]">
                        <Newspaper className="size-6" />
                      </span>
                    )}
                    <span className="flex flex-1 flex-col px-3 pb-3 pt-4">
                      <Meta post={post} />
                      <span className="mt-1.5 block text-[18px] font-semibold leading-snug tracking-[-0.02em] text-[var(--g2-ink)]">{post.title}</span>
                      {post.excerpt ? (
                        <span className="mt-2 line-clamp-3 block text-[14.5px] leading-relaxed text-[var(--g2-ink-soft)]">{post.excerpt}</span>
                      ) : null}
                      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[14px] font-semibold text-[var(--g2-accent-ink)]">
                        Read the post
                        <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/* ────────────────────────────── article ─────────────────────────────────── */

export function Template2BlogArticle({ post }: { post: BlogPostFull }) {
  const blocks = htmlToBlocks(post.content);
  return (
    <div className="pb-3">
      <article aria-labelledby="g2-post-title" className={PAGE}>
        <div className={PANE}>
          <header className="px-2 pb-6 pt-3 sm:px-3 sm:pb-8 sm:pt-4">
            <Link
              href={t2Href('/blog')}
              className={cn('inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium text-[var(--g2-ink-soft)] transition-colors hover:bg-white/60 hover:text-[var(--g2-ink)]', FOCUS)}
            >
              <ArrowLeft aria-hidden className="size-4" />
              All posts
            </Link>
            <div className="mx-auto max-w-[820px] pt-4 text-center sm:pt-6">
              <h1 id="g2-post-title" className="text-[32px] font-semibold leading-[1.06] tracking-[-0.04em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[48px]">
                {post.title}
              </h1>
              <Meta post={post} className="mt-3 justify-center" />
            </div>
          </header>

          <div className={cn(SHEET, 'overflow-hidden')}>
            {post.featuredImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
              <img src={post.featuredImageUrl} alt="" className="aspect-[16/9] max-h-[520px] w-full object-cover" />
            ) : null}
            <div className="px-5 py-8 sm:px-10 sm:py-12">
              <div className={COLUMN}>
                {blocks.map((block, index) => (
                  <ArticleBlock key={index} block={block} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

/** One block of the body. Spacing lives on each block so the first never pushes the column down. */
function ArticleBlock({ block }: { block: PostBlock }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 className="mb-3 mt-10 text-[24px] font-semibold leading-[1.2] tracking-[-0.03em] text-[var(--g2-ink)] first:mt-0">{block.text}</h2>
      ) : (
        <h3 className="mb-2 mt-8 text-[19px] font-semibold leading-snug tracking-[-0.02em] text-[var(--g2-ink)] first:mt-0">{block.text}</h3>
      );
    case 'paragraph':
      return <p className="mb-5 text-[16px] leading-[1.75] text-[var(--g2-ink)]/85 md:text-[17px]">{block.text}</p>;
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          className={cn(
            'mb-6 space-y-2 pl-6 text-[16px] leading-[1.7] text-[var(--g2-ink)]/85 marker:text-[var(--g2-accent-ink)] md:text-[17px]',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              {item}
            </li>
          ))}
        </ListTag>
      );
    }
    case 'quote':
      return (
        <blockquote className="my-8 rounded-[20px] rounded-bl-[6px] bg-[color-mix(in_oklab,var(--g2-accent)_7%,#fff)] px-6 py-5">
          {block.paragraphs.map((text, index) => (
            <p key={index} className="text-[18px] font-medium leading-[1.6] text-[var(--g2-ink)] [&+p]:mt-3">
              {text}
            </p>
          ))}
        </blockquote>
      );
    case 'code':
      return (
        <pre className="mb-6 overflow-x-auto rounded-[16px] bg-[rgb(13_12_29/0.04)] p-4 font-mono text-[13px] leading-relaxed text-[var(--g2-ink)]">
          <code>{block.text}</code>
        </pre>
      );
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
        <img src={block.src} alt={block.alt} loading="lazy" className="my-8 w-full rounded-[18px] bg-white/60 object-cover" />
      );
    case 'rule':
      return <hr className="my-10 border-[rgb(13_12_29/0.08)]" />;
  }
}
