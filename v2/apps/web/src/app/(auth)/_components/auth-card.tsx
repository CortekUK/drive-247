import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The card every auth page sits in.
 *
 * Same recipe as the booking panel — `rounded-[18px]`, a 1px
 * `brand-border-soft` hairline, white on the cream page, no shadow — so the
 * sign-in screen reads as the same product as the page the visitor came from.
 *
 * The heading is an `<h1>`: an auth page has exactly one subject, and the
 * layout above deliberately does not claim the level.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  /** One sentence under the title. Optional — some steps are self-explanatory. */
  description?: ReactNode;
  children: ReactNode;
  /** The cross-link out of this page: "New here? Create an account". */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-brand-border-soft bg-white px-5 py-6 sm:px-7 sm:py-8",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h1 className="text-xl font-medium tracking-[-0.02em] text-brand-text sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="text-sm leading-relaxed text-brand-text-soft">
            {description}
          </p>
        ) : null}
      </div>

      <div className="mt-6">{children}</div>

      {footer ? (
        <div className="mt-6 border-t border-brand-border-soft pt-5 text-center text-sm text-brand-text-soft">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The in-prose link style for auth copy.
 *
 * `min-h-11` is the 44px touch floor, and `-my-3` gives that height back to the
 * layout so the sentence around it does not grow: 44px tall to a thumb, 20px
 * tall to the line box. A bare text link is ~20px, and a 20px target in the
 * middle of a sentence is the classic mobile miss — these links are the ONLY
 * way between sign-in and sign-up, so missing one is a dead end.
 *
 * `inline-flex` rather than `inline-block` because the box has to be able to
 * centre its text inside the taller hit area; `align-baseline` keeps it sitting
 * on the same line as the prose either side of it, which inline-flex would
 * otherwise align by its own bottom margin edge.
 */
export function AuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-my-3 inline-flex min-h-11 items-center align-baseline font-medium text-brand-forest underline underline-offset-4 transition-colors",
        "hover:text-brand-forest-deep focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25",
        className,
      )}
    >
      {children}
    </Link>
  );
}
