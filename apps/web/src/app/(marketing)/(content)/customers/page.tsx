import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContentCta } from "@/components/content/content-cta";
import { StoryCard } from "@/components/content/story-card";
import { STORIES } from "@/content/stories";
import "@/components/content/content.css";

export const metadata: Metadata = {
  title: "Customer stories — Drive247",
  description: "How independent rental operators run their businesses on Drive247.",
  alternates: { canonical: "/customers" },
};

export default function CustomersPage() {
  // Only samples so far, and samples never reach production: no page until a real one exists.
  if (STORIES.length === 0) notFound();

  return (
    <div className="ct-page">
      <div className="ct-inner">
        <h1 className="ct-page-title font-medium tracking-tighter">
          Customer <span className="ct-brand">stories</span>
        </h1>
        <p className="ct-sub">How independent operators run their rental businesses on Drive247.</p>
        <div className="ct-grid">
          {STORIES.map((story) => (
            <StoryCard key={story.slug} story={story} />
          ))}
        </div>
        <ContentCta />
      </div>
    </div>
  );
}
