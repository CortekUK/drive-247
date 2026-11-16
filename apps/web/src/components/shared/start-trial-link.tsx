"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { requestSignupOpen, SIGNUP_START_HREF } from "@/lib/open-signup";

/**
 * A "Start free trial" link that opens the signup form itself, not the plans.
 *
 * On the landing page the form opens in place on the recommended plan. Anywhere
 * else, or before the page has loaded, it is a plain link to `/?signup=start`,
 * which opens the same form when the landing page loads. A new tab or window
 * still works, because the href is real.
 */
export function StartTrialLink({ onClick, children, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (requestSignupOpen()) event.preventDefault();
  };
  return (
    <a {...rest} href={SIGNUP_START_HREF} onClick={handleClick}>
      {children}
    </a>
  );
}
