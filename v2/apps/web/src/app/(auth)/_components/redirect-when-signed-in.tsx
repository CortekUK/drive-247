"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useCustomerAuth } from "@/contexts/CustomerAuthContext";

import { useNextPath } from "./next-path";

/**
 * Sends an already-signed-in customer where they were going.
 *
 * Mounted by the auth layout, so it covers all three pages: someone who signs
 * in on one tab and then opens a stale `/login` in another should not be shown
 * a form asking them to do it again.
 *
 * Renders nothing, and deliberately does NOT hide the form while it decides.
 * `isLoading` is true for the whole of the first paint on a signed-in visitor,
 * and a spinner in its place would mean every anonymous visitor — the
 * overwhelming majority — waits on a session lookup before they can start
 * typing. The redirect lands within a frame or two of the answer arriving.
 *
 * `replace`, not `push`: the auth page must not sit in the history behind the
 * portal, where Back would bounce the customer straight out of it.
 */
export function RedirectWhenSignedIn() {
  const { isAuthenticated, isLoading } = useCustomerAuth();
  const router = useRouter();
  const next = useNextPath();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    router.replace(next);
  }, [isLoading, isAuthenticated, next, router]);

  return null;
}
