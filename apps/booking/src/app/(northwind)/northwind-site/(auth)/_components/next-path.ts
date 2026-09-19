"use client";

import { useEffect, useState } from "react";

/**
 * Where a visitor goes after signing in, and how that destination is kept safe.
 *
 * The portal sends people here as `/login?next=/portal/bookings/123`, and the
 * value comes straight off the URL bar — so it is attacker-controlled, and an
 * unchecked `router.replace(next)` is a textbook open redirect: a link to
 * `…/login?next=https://evil.example/login` phishes a customer through a page
 * that really is the operator's, and lands them on one that is not.
 *
 * `sanitizeNextPath` therefore accepts ONE shape — a same-origin absolute path
 * — and falls back to the portal for everything else. It is pure and exported
 * so the rule can be read and tested on its own.
 */

export const DEFAULT_AFTER_AUTH = "/portal";

/** The query parameter the portal and the auth pages agree on. */
export const NEXT_PARAM = "next";

export function sanitizeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_AFTER_AUTH;

  // Must be an absolute path on this origin.
  if (!raw.startsWith("/")) return DEFAULT_AFTER_AUTH;

  /*
    "//evil.example" is protocol-relative — browsers treat it as a different
    ORIGIN, not a path. "/\evil.example" and "/\\evil.example" are the same
    trick: several browsers normalise a backslash to a forward slash before
    parsing, so both reach the same place.
  */
  if (/^\/[/\\]/.test(raw)) return DEFAULT_AFTER_AUTH;

  // A control character can smuggle a newline into a header or truncate the
  // path during normalisation. Nothing legitimate carries one.
  // Written with explicit code points so the range cannot be mangled by an
  // editor that renders the characters themselves.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_AFTER_AUTH;

  // Never bounce a signed-in customer straight back to an auth page: that is a
  // loop, and it is what a stale `next` from a previous attempt looks like.
  const path = raw.split(/[?#]/)[0];
  if (["/login", "/signup", "/forgot-password"].includes(path)) {
    return DEFAULT_AFTER_AUTH;
  }

  return raw;
}

/**
 * The sanitised `?next=` for this page load.
 *
 * Read from `window.location` inside an effect rather than with
 * `useSearchParams`, which is the convention already set by
 * `vehicle-booking-page` — it keeps these routes free of a Suspense boundary
 * they would otherwise need at build time. The first render returns the default,
 * which is correct: it is where a visitor with no `next` is going anyway.
 */
export function useNextPath(): string {
  const [next, setNext] = useState(DEFAULT_AFTER_AUTH);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(NEXT_PARAM);
    setNext(sanitizeNextPath(raw));
  }, []);

  return next;
}

/**
 * Carry the destination across the login ⇄ signup hop.
 *
 * Without this a visitor who was sent to `/login?next=/portal/bookings/123`,
 * realised they had no account, and signed up instead would land on the portal
 * home having lost the page they were actually trying to reach.
 */
export function withNext(href: string, next: string): string {
  if (next === DEFAULT_AFTER_AUTH) return href;
  return `${href}?${NEXT_PARAM}=${encodeURIComponent(next)}`;
}
