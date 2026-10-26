/**
 * Northwind booking site v2 — the blog: the index's post cards and the article
 * page. Server components; the routes (app/(northwind-v2)/…/(site)/blog) do the
 * loading and the gating exactly as v1's do, and hand the rows in.
 *
 * The article is a readable column (720px) rather than the page width, with v2
 * type for each block `htmlToBlocks` finds. Text only, never injected HTML.
 */

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Newspaper } from 'lucide-react-nw';

import type { BlogPostFull, BlogPostSummary } from '@nw/lib/cms/queries';
import { cn } from '@nw/lib/utils';

import { CARD_INTERACTIVE, EmptyState, PageHeader, SITE_CONTAINER, SITE_WIDE } from '../kit';
import { htmlToBlocks, type PostBlock } from './html-blocks';

/** "2026-09-09" -> "9 September 2026", as v1's blog pages print it. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** Date · author · read time, whichever of the three the post has. */
function metaLine(post: BlogPostSummary): string {
  return [
    formatDate(post.publishedAt),
    post.authorName,
    post.readingTimeMinutes ? `${post.readingTimeMinutes} min read` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ─────────────────────────────── index ──────────────────────────────────── */

export function BlogIndexV2({ posts }: { posts: BlogPostSummary[] }) {
  return (
    <div className="pv2-enter">
      <PageHeader title="News and guides" description="Updates from us, and plain advice on renting and driving." />

      <section className={cn(SITE_WIDE, 'pt-2')}>
        {posts.length === 0 ? (
          <EmptyState
            icon={<Newspaper aria-hidden className="size-5" />}
            title="Nothing published yet"
            description="We have not posted anything here yet. Check back soon."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {posts.map((post) => (
              <li key={post.id} className="flex">
                <PostCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PostCard({ post }: { post: BlogPostSummary }) {
  const meta = metaLine(post);
  return (
    <Link href={`/blog/${post.slug}`} className={cn(CARD_INTERACTIVE, 'group flex w-full flex-col p-3')}>
      {post.featuredImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
        <img
          src={post.featuredImageUrl}
          alt=""
          loading="lazy"
          className="aspect-[16/10] w-full rounded-xl bg-pv-muted object-cover"
        />
      ) : (
        <div aria-hidden className="grid aspect-[16/10] w-full place-items-center rounded-xl bg-pv-tint text-pv-primary">
          <Newspaper className="size-6" />
        </div>
      )}
      <div className="flex flex-1 flex-col px-2 pb-2 pt-4">
        {meta ? <p className="text-xs text-pv-muted-fg">{meta}</p> : null}
        <h2 className="mt-1.5 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-pv-fg">{post.title}</h2>
        {post.excerpt ? (
          <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-pv-muted-fg">{post.excerpt}</p>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-medium text-pv-link">
          Read the post
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </div>
    </Link>
  );
}

/* ────────────────────────────── article ─────────────────────────────────── */

/** The reading measure: wide enough for an image, narrow enough for prose. */
const COLUMN = 'mx-auto w-full max-w-[720px]';

export function BlogArticleV2({ post }: { post: BlogPostFull }) {
  const meta = metaLine(post);
  const blocks = htmlToBlocks(post.content);

  return (
    <article className={cn(SITE_CONTAINER, 'pv2-enter pt-8 md:pt-12')}>
      <div className={COLUMN}>
        <Link
          href="/blog"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-pv-muted-fg transition-colors duration-200 hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All posts
        </Link>

        <header className="mt-4">
          <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.035em] text-pv-fg md:text-[44px]">
            {post.title}
          </h1>
          {meta ? <p className="mt-3 text-sm text-pv-muted-fg">{meta}</p> : null}
        </header>
      </div>

      {post.featuredImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
        <img
          src={post.featuredImageUrl}
          alt=""
          className="mx-auto mt-8 aspect-[16/9] w-full max-w-[960px] rounded-2xl border border-pv-border bg-pv-muted object-cover"
        />
      ) : null}

      <div className={cn(COLUMN, 'mt-8 md:mt-10')}>
        {blocks.map((block, index) => (
          <ArticleBlock key={index} block={block} />
        ))}
      </div>
    </article>
  );
}

/** One block of the body. Spacing lives on each block so the first never pushes the column down. */
function ArticleBlock({ block }: { block: PostBlock }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 className="mb-3 mt-10 text-[24px] font-bold leading-[1.2] tracking-[-0.025em] text-pv-fg first:mt-0">
          {block.text}
        </h2>
      ) : (
        <h3 className="mb-2 mt-8 text-[19px] font-semibold leading-snug tracking-[-0.015em] text-pv-fg first:mt-0">
          {block.text}
        </h3>
      );
    case 'paragraph':
      return <p className="mb-5 text-[16px] leading-[1.75] text-pv-fg/85 md:text-[17px]">{block.text}</p>;
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          className={cn(
            'mb-6 space-y-2 pl-6 text-[16px] leading-[1.7] text-pv-fg/85 marker:text-pv-muted-fg md:text-[17px]',
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
        <blockquote className="my-8 border-l-2 border-pv-primary pl-5">
          {block.paragraphs.map((text, index) => (
            <p key={index} className="text-[18px] font-medium leading-[1.6] text-pv-fg [&+p]:mt-3">
              {text}
            </p>
          ))}
        </blockquote>
      );
    case 'code':
      return (
        <pre className="mb-6 overflow-x-auto rounded-xl border border-pv-border bg-pv-muted p-4 font-mono text-[13px] leading-relaxed text-pv-fg">
          <code>{block.text}</code>
        </pre>
      );
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          className="my-8 w-full rounded-xl border border-pv-border bg-pv-muted object-cover"
        />
      );
    case 'rule':
      return <hr className="my-10 border-pv-border" />;
  }
}
