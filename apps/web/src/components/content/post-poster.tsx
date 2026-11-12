import Image from "next/image";
import Link from "next/link";
import type { PostWithMeta } from "@/content/posts";
import "./post-poster.css";

/**
 * A blog post as a poster: one photograph that carries its own title, with a line of
 * description sitting under it, outside the card. Each post has its own photograph, so
 * a row of them reads as different subjects, not as more product screens.
 *
 * The photographs are public domain (CC0, from StockSnap) and live in /public/v2/blog.
 */

export interface Poster {
  src: string;
  /** Where the subject sits, so the crop keeps it in view. */
  focus: string;
}

const POSTERS: Record<string, Poster> = {
  "turo-or-your-own-booking-site": { src: "/v2/blog/commission.jpg", focus: "50% 30%" },
  "signed-and-checked-before-pickup": { src: "/v2/blog/keys.jpg", focus: "62% 40%" },
  "weekend-and-holiday-pricing": { src: "/v2/blog/weekend.jpg", focus: "50% 45%" },
};

/** The posts that have a poster, in the order the landing page shows them. */
export const POSTER_SLUGS: readonly string[] = Object.keys(POSTERS);

/** The post's photograph, if it has one. */
export function posterFor(slug: string): Poster | undefined {
  return POSTERS[slug];
}

export function PostPoster({ post }: { post: PostWithMeta }) {
  const poster = POSTERS[post.slug];
  if (!poster) return null;

  return (
    <Link href={`/blog/${post.slug}`} className="pp">
      <div className="pp-poster">
        <Image
          src={poster.src}
          alt=""
          fill
          sizes="(min-width: 1000px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="pp-photo"
          style={{ objectPosition: poster.focus }}
        />
        {/* Phones only (post-poster.css): what the post is, at the top of the photo. */}
        <span className="pp-chip">{post.category}</span>
        <div className="pp-foot">
          <h3 className="pp-title">{post.title}</h3>
          <span className="pp-in">{post.readMinutes} min read</span>
        </div>
      </div>
      <div className="pp-under">
        <p className="pp-meta">
          <span className="pp-tag">{post.category}</span>
          <span>{post.readMinutes} min read</span>
        </p>
        <p className="pp-excerpt">{post.excerpt}</p>
      </div>
    </Link>
  );
}
