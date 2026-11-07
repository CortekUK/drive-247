import type { Metadata } from "next";

import { ContentCta } from "@/components/content/content-cta";
import { PostCard } from "@/components/content/post-card";
import { ALL_POSTS } from "@/content/posts";
import "@/components/content/content.css";

export const metadata: Metadata = {
  title: "Blog — Drive247",
  description: "Guides for running and growing an independent car rental business.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <div className="ct-page">
      <div className="ct-inner">
        <h1 className="ct-page-title font-medium tracking-tighter">
          The Drive247 <span className="ct-brand">blog</span>
        </h1>
        <p className="ct-sub">Practical notes on bookings, money and growth, from the team building Drive247.</p>
        <div className="ct-grid">
          {ALL_POSTS.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
        <ContentCta />
      </div>
    </div>
  );
}
