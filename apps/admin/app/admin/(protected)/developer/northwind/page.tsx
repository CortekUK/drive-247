'use client';

/** Developer → Northwind Onboarding: first-run, the tour and the demo journey, sent to the open Northwind tab. */

import { Rocket } from 'lucide-react';
import { DeveloperHeader } from '@/components/admin/developer/developer-header';
import { NorthwindCard } from '@/components/admin/developer/northwind-card';

export default function NorthwindOnboardingPage() {
  return (
    <>
      <DeveloperHeader
        icon={Rocket}
        title="Northwind Onboarding"
        description="Replay the first-run experience on the Northwind canary."
      />
      <NorthwindCard />
    </>
  );
}
