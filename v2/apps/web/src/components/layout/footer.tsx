import { Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import Link from "next/link";

import { CONTACT_INFO, FOOTER_LINKS } from "@/lib/constants";

const SOCIALS = [
  { Icon: Youtube, href: "#", label: "YouTube" },
  { Icon: Instagram, href: "#", label: "Instagram" },
  { Icon: Facebook, href: "#", label: "Facebook" },
  { Icon: Twitter, href: "#", label: "X" },
];

export function Footer() {
  return (
    <footer className="bg-brand-forest-darker text-white/80">
      <div className="container-page py-16 lg:py-20">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading} className="space-y-4">
              <h3 className="text-sm font-medium text-white/60">{heading}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/85 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/60">Contact us</h3>
            <ul className="space-y-3 text-sm text-white/85">
              <li>
                <a
                  href={`mailto:${CONTACT_INFO.email}`}
                  className="transition-colors hover:text-white"
                >
                  {CONTACT_INFO.email}
                </a>
              </li>
              <li>
                <a
                  href={`tel:${CONTACT_INFO.phone.replace(/[^+\d]/g, "")}`}
                  className="transition-colors hover:text-white"
                >
                  {CONTACT_INFO.phone}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-white/60">
            © 2026 Copyright. All Right Reserved
          </p>
          <ul className="flex items-center gap-4">
            {SOCIALS.map(({ Icon, href, label }) => (
              <li key={label}>
                <Link
                  href={href}
                  aria-label={label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/85 transition-colors hover:border-white/40 hover:text-white"
                >
                  <Icon className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
