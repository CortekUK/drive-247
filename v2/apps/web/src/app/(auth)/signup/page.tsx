import type { Metadata } from "next";

import { SignupForm } from "../_components/signup-form";

export const metadata: Metadata = {
  title: "Create an account",
  description:
    "Create an account to book vehicles and manage your rentals in one place.",
  // An auth page has nothing to offer a search engine, and indexing one invites
  // a phishing report against the operator's domain.
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return <SignupForm />;
}
