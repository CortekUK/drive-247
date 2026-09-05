import type { Metadata } from "next";

import { ForgotPasswordForm } from "../_components/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Send yourself a code and set a new password for your account.",
  // An auth page has nothing to offer a search engine, and indexing one invites
  // a phishing report against the operator's domain.
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
