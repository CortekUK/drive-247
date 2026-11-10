import { notFound } from "next/navigation";

import { loadBlogEnabled, loadBlogPosts } from "@nw/lib/cms/server";
import { Template2BlogIndex } from "@nw/template-2/blog-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — the blog's index (/template-2/blog). Same gating as site-v2: switched off is a 404. */

export const metadata = { title: "Blog" };

export default async function Template2BlogRoute() {
  const [enabled, posts] = await Promise.all([loadBlogEnabled(), loadBlogPosts()]);
  if (!enabled) notFound();
  return (
    <>
      <Template2BlogIndex posts={posts} />
      <Template2PageClosing />
    </>
  );
}
