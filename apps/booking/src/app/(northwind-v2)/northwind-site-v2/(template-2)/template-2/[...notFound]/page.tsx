import { notFound } from "next/navigation";

/** An address Template 2 has no page for 404s inside Template 2's frame (see ./not-found.tsx). */
export default function Template2NotFound() {
  notFound();
}
