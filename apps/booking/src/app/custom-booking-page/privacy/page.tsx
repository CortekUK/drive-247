import { SiteShell } from "@/components/custom-booking-page/site-shell";
import { PrivacyView } from "@/components/custom-booking-page/views";
import { getCbpSeed } from "../seed";

export default async function Page() {
  return (
    <SiteShell seed={await getCbpSeed()}>
      <PrivacyView />
    </SiteShell>
  );
}
