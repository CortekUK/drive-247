import type { Metadata } from "next";

import { Template2CarPage } from "@nw/template-2/car-page";

/**
 * Template 2 ("Glass") — one car and booking it (/template-2/booking/<id>).
 * Thin, because `params` is a Promise and the page is a live client form.
 */

export const metadata: Metadata = {
  title: "Book a car",
  description: "Choose your dates, add what you need, and see the full price before you pay.",
};

export default async function Template2CarRoute({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return <Template2CarPage vehicleId={vehicleId} />;
}
