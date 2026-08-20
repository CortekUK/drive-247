"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useState } from "react";
import { NAV } from "./d7-data";
import { Icon, Logo } from "./d7-icons";
import { ThemeToggle } from "./d7-theme";
import { Magnetic } from "./d7-ui";

/**
 * Sticky header. Transparent over the hero, then condenses into a glass bar
 * once the page scrolls — the active-link pill is a shared layout element so
 * it slides between items rather than cutting.
 */
export function D7Nav({ appName, logoUrl, phone, bookCta = "Book Now" }: {
  appName: string; logoUrl: string | null; phone: string | null; bookCta?: string;
}) {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("Home");
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", v => setStuck(v > 24));

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed inset-x-0 top-0 z-50 transition-[background,box-shadow,backdrop-filter] duration-500
                    ${stuck ? "d7-glass border-b border-[var(--line)] shadow-[0_10px_34px_-26px_rgba(23,16,72,.5)]" : "bg-transparent"}`}>
        <div className="d7-wrap flex h-[74px] items-center justify-between gap-4">
          <a href="#top" aria-label={`${appName} home`} className="shrink-0">
            <Magnetic strength={0.18}><Logo name={appName} logoUrl={logoUrl} /></Magnetic>
          </a>

          {/* centre links */}
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map(item => (
              <a key={item.label} href={item.href}
                onClick={() => setActive(item.label)}
                onMouseEnter={() => setActive(item.label)}
                className="relative rounded-full px-3.5 py-2 text-[14px] font-medium text-[var(--body)] transition-colors hover:text-[var(--ink)]">
                {active === item.label && (
                  <motion.span layoutId="d7-nav-pill" aria-hidden
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-[var(--v-lt)]" />
                )}
                <span className={`relative z-10 ${active === item.label ? "font-semibold text-[var(--v)]" : ""}`}>
                  {item.label}
                </span>
              </a>
            ))}
          </nav>

          {/* right controls */}
          <div className="flex items-center gap-2.5">
            <a href="/portal"
              className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--white)] px-4 py-2.5
                         text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--shadow)]
                         transition hover:-translate-y-0.5 hover:border-[var(--v)]/40 hover:text-[var(--v)] sm:flex">
              <Icon name="user" className="h-4 w-4" /> Login
            </a>
            <a href="/contact"
              className="hidden items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--white)] px-4 py-2.5
                         text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--shadow)]
                         transition hover:-translate-y-0.5 hover:border-[var(--v)]/40 hover:text-[var(--v)] md:flex">
              <Icon name="chat" className="h-4 w-4" /> Enquiry
            </a>
            <ThemeToggle />
            {phone && (
              <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} aria-label={`Call ${appName}`}
                className="d7-btn grid h-11 w-11 place-items-center rounded-[13px] text-white
                           [background:var(--grad)] shadow-[var(--shadow-v)] transition hover:-translate-y-0.5">
                <Icon name="phone" className="h-[18px] w-[18px]" />
              </a>
            )}
            <button onClick={() => setOpen(v => !v)} aria-label="Open menu" aria-expanded={open}
              className="grid h-11 w-11 place-items-center rounded-[13px] border border-[var(--line)]
                         bg-[var(--v-lt)] text-[var(--v)] transition hover:bg-[var(--white)]">
              <Icon name={open ? "close" : "menu"} className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </motion.header>

      {/* mobile / overflow sheet */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-[var(--navy)]/35 backdrop-blur-[2px]" />
            <motion.nav
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="fixed right-0 top-0 z-50 flex h-full w-[min(340px,86vw)] flex-col gap-1 border-l
                         border-[var(--line)] bg-[var(--bg)] p-6 pt-[86px] shadow-[-30px_0_70px_-40px_rgba(0,0,0,.6)]">
              {NAV.map((item, i) => (
                <motion.a key={item.label} href={item.href} onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + i * 0.045, ease: [0.16, 1, 0.3, 1] }}
                  className="d7-dis border-b border-[var(--line-2)] py-3.5 text-[19px] tracking-[-.02em]
                             text-[var(--ink)] transition hover:pl-2 hover:text-[var(--v)]">
                  {item.label}
                </motion.a>
              ))}
              <div className="mt-6 grid gap-2.5">
                <a href="#booking" onClick={() => setOpen(false)}
                  className="d7-btn rounded-full px-5 py-3 text-center text-[14px] font-semibold text-white [background:var(--grad)]">
                  {bookCta}
                </a>
                <a href="/portal"
                  className="rounded-full border border-[var(--line)] px-5 py-3 text-center text-[14px] font-semibold text-[var(--ink)]">
                  Login
                </a>
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
