import { notFound } from "next/navigation";

/**
 * An address the new Northwind design has no page for gets a 404 inside the
 * new design, not the original design's 404. Without this, the (legacy)
 * catch-all would answer /northwind-site/<unknown>.
 */
export default function NorthwindNotFound() {
  notFound();
}
