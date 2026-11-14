"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { HeaderCta } from "./header-cta";

const PILL_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Trax", href: "#trax" },
  { label: "Pricing", href: "#pricing" },
];

/**
 * `overHero` is for the landing page, whose hero fills the first screen with its own
 * logo and buttons: a floating glass pill takes over as soon as those scroll away,
 * and the theme toggle lives at the bottom-left of the screen instead.
 *
 * `pillPage` is the same pill on a page with no hero (the blog, customer stories): it
 * shows from the top, and its section links go back to the landing page.
 *
 * `floatingTrial` (with `overHero`) drops the pill entirely: once the hero scrolls away
 * the landing page keeps a single "Start free trial" button at the bottom right
 * instead (Ghulam, 2026-11-07). Switching back is removing the prop.
 */
export function Header({
  overHero = false,
  pillPage = false,
  floatingTrial = false,
}: {
  overHero?: boolean;
  pillPage?: boolean;
  floatingTrial?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [pill, setPill] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 50);
      setPill(window.scrollY > 60);
      // The pill is about to hide: its menu must not stay open behind the hero.
      if (window.scrollY <= 60 && !pillPage) setMenuOpen(false);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pillPage]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!pillRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (overHero && floatingTrial && !pillPage) {
    return (
      <>
        {/* The pill's place in the flow, kept: the hero is drawn 4rem up into it
            (.hg-hero margin-top), so without this the hero would lose its top. */}
        <div aria-hidden className="h-16" />
        {/* No floating "Start free trial" button, on phones or desktop (user, 2026-11-14:
            "remove the try it out button completely"). */}
      </>
    );
  }

  if (overHero || pillPage) {
    const shown = pill || pillPage;
    // On a page without the landing sections, "#pricing" has to mean "/#pricing".
    const home = pillPage ? "/" : "";
    return (
      <>
        <header
          aria-hidden={!shown || undefined}
          inert={!shown || undefined}
          className={`sticky top-2 z-50 flex h-16 w-full items-center px-4 transition-all duration-200 ease-out sm:px-6 ${
            shown ? "" : "pointer-events-none -translate-y-3 opacity-0"
          }`}
        >
          <div ref={pillRef} className="relative mx-auto grid h-[52px] w-full max-w-7xl grid-cols-[1fr_auto] items-center rounded-full border border-white/60 bg-white/70 pl-5 pr-2 max-[359px]:pl-3 max-[359px]:pr-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_0_0_1px_rgb(20_10_90/0.08),0_12px_40px_rgb(13_8_70/0.18)] backdrop-blur-xl backdrop-saturate-150 lg:grid-cols-[1fr_auto_1fr] dark:border-white/15 dark:bg-black/50 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_12px_40px_rgb(0_0_0/0.3)]">
            <Link href="/" className="justify-self-start max-xl:flex max-xl:h-11 max-xl:items-center">
              <Image src="/logo-light.png" alt="Drive247" width={855} height={195} className="h-6 w-auto max-[359px]:h-5 dark:hidden" priority />
              <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="hidden h-6 w-auto max-[359px]:h-5 dark:block" priority />
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
              {PILL_LINKS.map((link) => (
                <a key={link.href} href={`${home}${link.href}`} className="text-sm text-foreground/70 transition-colors duration-200 ease-out hover:text-foreground max-xl:flex max-xl:h-11 max-xl:items-center">
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-4 justify-self-end max-sm:gap-1 max-lg:gap-2">
              <HeaderCta
                label="Start free trial"
                href={`${home}#pricing`}
                className="rounded-full bg-primary px-5 text-sm font-normal text-primary-foreground hover:bg-primary/90 max-xl:h-11 max-[359px]:px-3 max-[359px]:text-xs"
              />
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                aria-controls="pill-menu"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors duration-200 ease-out hover:text-foreground lg:hidden"
              >
                {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
              </button>
            </div>

            {/* The links the pill has no room for below the wide layout. */}
            {menuOpen && (
              <nav
                id="pill-menu"
                aria-label="Menu"
                className="absolute inset-x-0 top-full mt-2 flex max-h-[calc(100svh-5rem)] flex-col overflow-y-auto rounded-2xl border bg-card p-2 lg:hidden"
              >
                {PILL_LINKS.map((link) => (
                  <a key={link.href} href={`${home}${link.href}`} onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-foreground/80 transition-colors duration-200 ease-out hover:bg-muted hover:text-foreground">
                    {link.label}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </header>
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
          {/* "Start free trial", or "Dashboard" once the server confirms
              this caller already has a live portal. */}
          <HeaderCta label="Start free trial" href="/#pricing" />
        </div>
      </div>
    </header>
    </>
  );
}
