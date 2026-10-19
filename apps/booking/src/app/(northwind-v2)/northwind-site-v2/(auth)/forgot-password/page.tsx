import type { Metadata } from "next";

import { ForgotPasswordV2 } from "@nw/auth-v2/forgot-password-v2";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Send yourself a code and set a new password for your account.",
  // An auth page has nothing to offer a search engine.
  robots: { index: false, follow: false },
};

export default function ForgotPasswordV2Page() {
  return <ForgotPasswordV2 />;
}
