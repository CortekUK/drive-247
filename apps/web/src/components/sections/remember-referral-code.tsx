"use client";

import { useEffect } from "react";
import { readReferralCodeFromDocument, writeReferralCodeInDocument } from "@/lib/referral-cookie";

/**
 * Keeps the code the referral banner is showing, for a visitor who landed on
 * /?ref=CODE without passing through /r/{code} (which sets the cookie itself).
 * The signup dialog reads the cookie, because the Google and Stripe redirects
 * drop the query string. The most recent link wins.
 */
export function RememberReferralCode({ code }: { code: string }) {
  useEffect(() => {
    if (readReferralCodeFromDocument() !== code) writeReferralCodeInDocument(code);
  }, [code]);
  return null;
}
