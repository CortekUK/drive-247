
import { PostPoster, POSTER_SLUGS } from "@/components/content/post-poster";
import { ALL_POSTS } from "@/content/posts";
import "@/components/content/content.css";
import { Accent, SectionHeading } from "./section-heading";
import { BlogRail } from "./blog-rail";

const FEATURED = POSTER_SLUGS.flatMap((slug) => ALL_POSTS.filter((post) => post.slug === slug)).slice(0, 3);

/* From the blog: three posts on three different subjects, each opening its own page. */
export function BlogSection() {
  return (
    <section className="ct-section bl-section" aria-labelledby="bl-title" data-line-lane="left">
      <div className="ct-inner">
        <div className="ct-head ct-head-left">
          <div>
            <SectionHeading
              id="bl-title"
              align="left"
              title={
                <>
                  From the <Accent>Blog</Accent>
                </>
              }
              sub={
                <>
                  Guides for running and growing a rental business.
                </>
              }
            />
          </div>
        </div>
        {/* A grid on tablet and desktop; on a phone a rail to swipe through (blog-rail.tsx). */}
        <BlogRail label="Posts from the blog">
          {FEATURED.map((post) => (
            <PostPoster key={post.slug} post={post} />
          ))}
        </BlogRail>
      </div>
    </section>
  );
}
