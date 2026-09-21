import { SiteShell } from "@/components/custom-booking-page/site-shell";
import { BookView } from "@/components/custom-booking-page/book-view";
import { getCbpSeed } from "../seed";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  // The vehicle type picked on the home page's booking bar, if any.
  const { type } = await searchParams;
  const initialType = typeof type === "string" && type.trim() ? type.trim() : undefined;
  return (
    <SiteShell seed={await getCbpSeed()}>
      <BookView initialType={initialType} />
    </SiteShell>
  );
}
