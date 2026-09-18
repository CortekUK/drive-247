import { SiteShell } from "@/components/custom-booking-page/site-shell";
import { TermsView } from "@/components/custom-booking-page/views";
import { getCbpSeed } from "../seed";

export default async function Page() {
  return (
    <SiteShell seed={await getCbpSeed()}>
      <TermsView />
    </SiteShell>
  );
}
