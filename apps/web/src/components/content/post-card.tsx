import Link from "next/link";
import type { PostWithMeta } from "@/content/posts";
import { formatDate } from "@/content/types";
import { CoverShot } from "./cover-shot";
import "./content.css";

export function PostCard({ post }: { post: PostWithMeta }) {
  return (
    <Link href={`/blog/${post.slug}`} className="ct-card">
      <div className="ct-cover">
        <CoverShot cover={post.cover} sizes="(min-width: 1000px) 33vw, (min-width: 640px) 50vw, 100vw" />
      </div>
      <div className="ct-body">
        <p className="ct-meta">
          <span className="ct-tag">{post.category}</span>
          <span>{post.readMinutes} min read</span>
        </p>
        <h3 className="ct-card-title">{post.title}</h3>
        <p className="ct-excerpt">{post.excerpt}</p>
        <p className="ct-date">{formatDate(post.date)}</p>
      </div>
    </Link>
  );
}
