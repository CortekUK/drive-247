"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { HeaderCta } from "./header-cta";

const PILL_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Trax", href: "#trax" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

/**
 * `overHero` is for the landing page, whose hero fills the first screen with its own
 * logo and buttons: a floating glass pill takes over as soon as those scroll away,
 * and the theme toggle lives at the bottom-left of the screen instead.
 */
export function Header({ overHero = false }: { overHero?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [pill, setPill] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 50);
      setPill(window.scrollY > 60);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (overHero) {
    return (
      <>
        <header
          aria-hidden={!pill || undefined}
          inert={!pill || undefined}
          className={`sticky top-2 z-50 flex h-16 w-full items-center px-4 transition-all duration-200 ease-out sm:px-6 ${
            pill ? "" : "pointer-events-none -translate-y-3 opacity-0"
          }`}
        >
          <div className="mx-auto grid h-[52px] w-full max-w-7xl grid-cols-[1fr_auto] items-center rounded-full border border-white/60 bg-white/70 pl-5 pr-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_0_0_1px_rgb(20_10_90/0.08),0_12px_40px_rgb(13_8_70/0.18)] backdrop-blur-xl backdrop-saturate-150 lg:grid-cols-[1fr_auto_1fr] dark:border-white/15 dark:bg-black/50 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_12px_40px_rgb(0_0_0/0.3)]">
            <Link href="/" className="justify-self-start">
              <Image src="/logo-light.png" alt="Drive247" width={855} height={195} className="h-6 w-auto dark:hidden" priority />
              <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="hidden h-6 w-auto dark:block" priority />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
              {PILL_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="text-sm text-foreground/70 transition-colors duration-200 ease-out hover:text-foreground">
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-4 justify-self-end">
              <a href="/strategy-call" className="hidden text-sm text-foreground/70 transition-colors duration-200 ease-out hover:text-foreground sm:block">
                Book a demo
              </a>
              <HeaderCta
                label="Start free trial"
                href="#pricing"
                className="rounded-full bg-primary px-5 text-sm font-normal text-primary-foreground hover:bg-primary/90"
              />
            </div>
          </div>
        </header>
        <div className="fixed bottom-4 left-4 z-50 rounded-full border bg-card p-1">
          <ThemeToggle />
        </div>
      </>
    );
  }

  return (
    <>
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
    </>
  );
}
