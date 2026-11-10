import Image from "next/image";
import Link from "next/link";
import type { StoryWithMeta } from "@/content/stories";
import "./post-poster.css";

/**
 * A customer story as a poster, the same card the blog uses: one photograph carrying
 * the headline, with the operator and their one figure sitting under it.
 */
export function StoryPoster({ story }: { story: StoryWithMeta }) {
  return (
    <Link href={`/customers/${story.slug}`} className="pp">
      <div className="pp-poster">
        <Image
          src={story.photo.src}
          alt=""
          fill
          sizes="(min-width: 1000px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="pp-photo"
          style={{ objectPosition: story.photo.focus }}
        />
        <h3 className="pp-title">{story.headline}</h3>
      </div>
      <div className="pp-under">
        <p className="pp-meta">
          <span className="pp-tag">{story.operator}</span>
          <span>{story.location}</span>
          <span>{story.fleet}</span>
        </p>
        <p className="pp-excerpt">
          <strong className="pp-figure">{story.highlight.value}</strong> {story.highlight.label}
        </p>
      </div>
    </Link>
  );
}
