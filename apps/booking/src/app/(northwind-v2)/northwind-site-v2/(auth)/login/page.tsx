import type { Metadata } from "next";

import { LoginV2 } from "@nw/auth-v2/login-v2";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your bookings, documents and payments.",
  // An auth page has nothing to offer a search engine.
  robots: { index: false, follow: false },
};

export default function LoginV2Page() {
  return <LoginV2 />;
}
