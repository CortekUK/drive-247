"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Menu, X } from "lucide-react";

/*
 * The nav on phones and tablets (below 1060px, where the section links no
 * longer fit in the bar): a menu button that opens a full-screen sheet with
 * the logo and a close button on top and the section links centred, one per
 * row with a hairline between them, and the two calls to action at the foot.
 * Picking a link closes the sheet and lets the page scroll to the section.
 * The sheet is portalled to the page root (.l4, for its fonts and tokens), out
 * of the bar: the bar's backdrop-filter would otherwise make it the sheet's
 * containing block and shrink the sheet to the bar.
 */
const noSubscribe = () => () => {};

export function NavMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  // the page root on the client, nothing on the server (so the sheet renders after hydration)
  const host = useSyncExternalStore(noSubscribe, () => document.querySelector(".l4"), () => null);

  // the page stays still behind the sheet; Escape closes it
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" className="l4-burger" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu />
      </button>
      {host && createPortal(
      <div className={`l4-sheet${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu" aria-hidden={!open}>
        <div className="top">
          <img src="/logo-light.png" alt="Drive247" />
          <button type="button" className="l4-burger" aria-label="Close menu" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            <X />
          </button>
        </div>
        <nav aria-label="Sections">
          {links.map((l, i) => (
            <a key={l.href} href={l.href} style={{ ["--i" as string]: i }} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="foot">
          <a className="l4-btn outline lg" href="#x-pricing" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
            See pricing
          </a>
          <a className="l4-btn primary lg" href="/strategy-call" tabIndex={open ? 0 : -1}>
            Book a demo
            <ArrowRight size={16} />
          </a>
        </div>
      </div>,
      host,
      )}
    </>
  );
}
