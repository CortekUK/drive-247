import { PageSkeleton } from "@nw/template-2/skeletons";

/** Shown the moment a link to this page is clicked, until the page is ready. */
export default function Loading() {
  return <PageSkeleton layout="grid" />;
}
