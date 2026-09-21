import { SiteShell } from "@/components/custom-booking-page/site-shell";
import { BookView } from "@/components/custom-booking-page/book-view";
import { getCbpSeed } from "../seed";

export default async function Page() {
  return (
    <SiteShell seed={await getCbpSeed()}>
      <BookView />
    </SiteShell>
  );
}
