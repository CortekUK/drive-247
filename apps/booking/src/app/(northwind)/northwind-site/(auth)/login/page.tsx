import type { Metadata } from "next";

import { LoginForm } from "../_components/login-form";

/**
 * A server component wrapping a client form.
 *
 * The split exists so this route can carry its own `metadata` — a page that is
 * `"use client"` cannot export it, and all three auth routes would otherwise
 * share one title from the layout.
 */
export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to manage your bookings, documents and payments.",
  // An auth page has nothing to offer a search engine, and indexing one invites
  // a phishing report against the operator's domain.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginForm />;
}
