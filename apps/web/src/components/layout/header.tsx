"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { HeaderCta } from "./header-cta";

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
          <ThemeToggle />
          {/* "Book a strategy call", or "Dashboard" once the server confirms
              this caller already has a live portal. */}
          <HeaderCta />
        </div>
      </div>
    </header>
  );
}
