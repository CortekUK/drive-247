import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BuildScreenReplay } from "@/components/onboarding/dev/build-screen-replay";

/**
 * DEV ONLY: the signup build screen on a loop, for tuning its motion. It talks
 * to no server. Outside `next dev` the route does not exist.
 */
export const metadata: Metadata = {
  title: "Build screen replay",
  robots: { index: false, follow: false },
};

export default function SignupBuildReplayPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BuildScreenReplay />;
}
