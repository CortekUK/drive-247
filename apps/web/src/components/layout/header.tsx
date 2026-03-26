"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NAV_LINKS, CALENDLY_URL } from "@/lib/constants";
import { useActiveSection } from "@/hooks/use-active-section";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const activeSection = useActiveSection();

  // Change 5: Scroll-based background shift
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll(); // check initial position
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

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => {
            const sectionId = link.href.replace("#", "");
            const isActive = activeSection === sectionId;
            return (
              <a
                key={link.href}
                href={link.href}
                className={`relative text-sm font-medium transition-colors ${
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
                {/* Active dot indicator */}
                <span
                  className={`absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-indigo-600 transition-all duration-200 dark:bg-indigo-400 ${
                    isActive ? "scale-100 opacity-100" : "scale-0 opacity-0"
                  }`}
                />
              </a>
            );
          })}
          <ThemeToggle />
          {/* Change 4: CTA button glow */}
          <Button
            asChild
            size="sm"
            className="bg-indigo-600 px-5 text-sm font-normal text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
              Book a strategy call
            </a>
          </Button>
        </nav>

        {/* Mobile controls */}
        <div className="flex items-center gap-3 md:hidden">
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Change 1: Animated mobile nav */}
      <nav
        id="mobile-nav"
        className={`overflow-hidden transition-all duration-300 ease-out md:hidden ${
          mobileOpen
            ? "max-h-96 border-t border-border/40 opacity-100"
            : "max-h-0 border-t-0 opacity-0"
        }`}
      >
        <div
          className={`px-4 pb-4 pt-2 transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-y-0" : "-translate-y-4"
          }`}
        >
          {NAV_LINKS.map((link) => {
            const sectionId = link.href.replace("#", "");
            const isActive = activeSection === sectionId;
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
              </a>
            );
          })}
          {/* Change 4: CTA button glow (mobile) */}
          <Button
            asChild
            size="sm"
            className="mt-3 w-full bg-indigo-600 text-sm font-normal text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
              Book a strategy call
            </a>
          </Button>
        </div>
      </nav>
    </header>
  );
}
