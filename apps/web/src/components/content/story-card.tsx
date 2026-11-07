import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { StoryWithMeta } from "@/content/stories";
import "./content.css";

/** The operator's first letter, for the small mark beside their name. */
export function initialOf(name: string): string {
  return (name.match(/[a-z0-9]/i)?.[0] ?? "D").toUpperCase();
}

export function StoryCard({ story }: { story: StoryWithMeta }) {
  return (
    <Link href={`/customers/${story.slug}`} className="ct-card" data-tint={story.tint}>
      <div className="ct-panel">
        <span className="ct-op">
          <span className="ct-op-mark" aria-hidden>
            {initialOf(story.operator)}
          </span>
          {story.operator}
        </span>
        <span className="ct-figure">
          <span className="ct-figure-value">{story.highlight.value}</span>
          <span className="ct-figure-label">{story.highlight.label}</span>
        </span>
      </div>
      <div className="ct-body">
        <p className="ct-meta">
          <span>{story.location}</span>
          <span>{story.fleet}</span>
        </p>
        <h3 className="ct-card-title">{story.headline}</h3>
        <span className="ct-more">
          Read the story
          <ArrowRight strokeWidth={2} aria-hidden />
        </span>
      </div>
    </Link>
  );
}
