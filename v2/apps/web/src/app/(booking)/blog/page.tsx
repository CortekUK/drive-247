import Link from "next/link";
import { notFound } from "next/navigation";

import { CtaBanner } from "@/components/sections/cta-banner";
import { loadBlogEnabled, loadBlogPosts } from "@/lib/cms/server";

export const metadata = { title: "Blog" };

/** "2026-09-09" -> "9 September 2026". */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * The blog index.
 *
 * Gated on `tenants.blog_enabled`, the toggle behind "Show blog on website" in
 * the portal: an operator who has switched the blog off gets a 404 here rather
 * than an empty page, because the toggle is a decision not to have a blog at
 * all. Posts are filtered to `status = 'published'` in the query, so a draft
 * stays the operator's working copy.
 */
export default async function BlogIndexPage() {
  const [enabled, posts] = await Promise.all([loadBlogEnabled(), loadBlogPosts()]);
  if (!enabled) notFound();

  return (
    <>
      <section className="bg-white">
        <div className="container-page py-12 lg:py-20">
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
            News &amp; guides
          </h1>

          {posts.length === 0 ? (
            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-brand-text-soft sm:text-base">
              Nothing published yet — check back soon.
            </p>
          ) : (
            <ul className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => {
                const date = formatDate(post.publishedAt);
                return (
                  <li key={post.id}>
                    <Link href={`/blog/${post.slug}`} className="group block">
                      {post.featuredImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.featuredImageUrl}
                          alt=""
                          className="mb-4 aspect-[16/10] w-full rounded-2xl object-cover"
                        />
                      )}
                      <h2 className="text-lg font-semibold leading-snug tracking-tight text-brand-text group-hover:underline">
                        {post.title}
                      </h2>
                      {post.excerpt && (
                        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-brand-text-soft">
                          {post.excerpt}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-brand-text-soft">
                        {[
                          date,
                          post.authorName,
                          post.readingTimeMinutes
                            ? `${post.readingTimeMinutes} min read`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      <CtaBanner />
    </>
  );
}
