import type { Metadata } from "next";

import { SignupV2 } from "@nw/auth-v2/signup-v2";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create an account to book vehicles and manage your rentals in one place.",
  // An auth page has nothing to offer a search engine.
  robots: { index: false, follow: false },
};

export default function SignupV2Page() {
  return <SignupV2 />;
}
