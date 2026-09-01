import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBrand } from "./_components/auth-brand";
import { RedirectWhenSignedIn } from "./_components/redirect-when-signed-in";

/**
 * The shell every auth page sits in.
 *
 * Deliberately NOT the marketing chrome. `(booking)/layout.tsx` wraps its pages
 * in the navbar and footer — a full site menu, a fleet link, a "Book Now" CTA.
 * On a sign-in screen every one of those is a way to lose the person before
 * they finish, so this is one centred column and one way back to the site.
 *
 * The tenant's own logo sits at the top rather than the platform mark, because
 * a customer believes they are signing in to the rental company, not to
 * Drive247. See `AuthBrand`.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-brand-cream px-4 py-10 sm:px-6 sm:py-14">
      <RedirectWhenSignedIn />

      {/*
        `max-w-[420px]` is the whole column, not just the card: a wider form
        stretches the fields past a comfortable reading measure and makes a
        short page look empty. `justify-center` on a `flex-1` column keeps the
        card optically centred on a tall screen and simply scrolls on a short
        one, which is what a 360px phone with the keyboard open actually is.
      */}
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-7">
        <AuthBrand />

        <main>{children}</main>

        {/*
          `min-h-11` for the 44px touch floor, `-my-3.5` to give the height back
          to the layout so this stays a 16px line of caption text. Same trick,
          same reason, as `AuthLink`.
        */}
        <p className="text-center text-xs text-brand-text-subtle">
          <Link
            href="/"
            className="-my-3.5 inline-flex min-h-11 items-center align-baseline transition-colors hover:text-brand-text focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25"
          >
            Back to the website
          </Link>
        </p>
      </div>
    </div>
  );
}
