"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/layout/brand-mark";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NAV_LINKS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="relative z-30">
      <div className="container-page flex items-center justify-between gap-3 py-6">
        <BrandMark />

        <nav aria-label="Primary" className="hidden flex-1 lg:block">
          <ul className="flex items-center justify-center">
            {NAV_LINKS.map((link, index) => {
              const isActive =
                link.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(link.href);
              return (
                <li
                  key={link.href}
                  className={index === 0 ? "" : "pl-8"}
                >
                  <Link
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "text-[13px] leading-[19.5px] tracking-[0.325px] transition-colors",
                      isActive
                        ? "text-brand-text"
                        : "text-brand-text-soft hover:text-brand-text",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-2 lg:gap-4">
          {/*
            The account entry point is deliberately a text link, not a second
            pill. Two filled pills side by side read as two equal-weight offers
            and the booking CTA stops being the obvious next step; the quiet
            link keeps one primary action in the header.

            It carries `min-h-11` so the touch target clears 44px even though
            the visible text is 13px — the box grows, the type does not, so the
            header's optical rhythm is unchanged.
          */}
          <Link
            href="/login"
            className="hidden min-h-11 items-center rounded-full px-2 text-[13px] leading-[19.5px] tracking-[0.325px] text-brand-text-soft transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25 lg:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/booking"
            className="hidden items-center justify-center rounded-full bg-brand-forest-deep px-6 py-[10px] text-[13px] leading-[19.5px] text-white shadow-[0px_1px_1px_rgba(0,0,0,0.05)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest-deep/35 lg:inline-flex"
          >
            Book a Car
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
