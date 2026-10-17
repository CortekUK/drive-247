import { notFound } from "next/navigation";

/** An address v2 has no page for 404s inside v2, not in another design's catch-all. */
export default function NorthwindV2NotFound() {
  notFound();
}
