import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PostCard } from "@/components/content/post-card";
import { ALL_POSTS } from "@/content/posts";
import "@/components/content/content.css";
import { Accent, SectionHeading } from "./section-heading";

/* From the blog: the three newest posts, each opening its own page under /blog. */
export function BlogSection() {
  return (
    <section className="ct-section" aria-labelledby="bl-title">
      <div className="ct-inner">
        <div className="ct-head">
          <div>
            <SectionHeading
              id="bl-title"
              title={
                <>
                  From the <Accent>blog</Accent>
                </>
              }
              sub={
                <>
                  Guides for running and growing a rental business.
                </>
              }
            />
          </div>
          <Link href="/blog" className="ct-all">
            All posts
            <ArrowRight strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <div className="ct-grid">
          {ALL_POSTS.slice(0, 3).map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      </div>
    </section>
  );
}
