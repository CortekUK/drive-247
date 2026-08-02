"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b transition-all duration-300 ease-out ${
        scrolled
          ? "border-border/40 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60"
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/">
          <Image
            src="/logo-light.png"
            alt="Drive247"
            width={855}
            height={195}
            className="h-7 w-auto dark:hidden"
            priority
          />
          <Image
            src="/logo-dark.png"
            alt="Drive247"
            width={855}
            height={195}
            className="hidden h-7 w-auto dark:block"
            priority
          />
        </Link>

        <div className="flex items-center gap-3">
          {/* The header carries no nav links otherwise; this is the minimum needed
              to reach the pricing section (and the self-serve signup that starts
              there). It is a next/link to `/#pricing`, not a bare `#pricing`
              anchor, because this header also renders on /privacy, /security and
              /terms — where a hash-only href would be a dead link on the one
              nav item that leads to revenue. Hidden below `sm` so it never
              competes with the primary CTA on a phone. */}
          <Link
            href="/#pricing"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Pricing
          </Link>
          <ThemeToggle />
          <Button
            asChild
            size="sm"
            className="bg-indigo-600 px-5 text-sm font-normal text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <a href="/strategy-call">Book a strategy call</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
