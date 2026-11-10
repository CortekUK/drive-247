import Link from "next/link";
import Image from "next/image";
import { STORIES } from "@/content/stories";
import { FooterWater } from "./footer-water";
import "./footer.css";

/* `/#...` rather than `#...`: the legal pages share this footer. */
const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Trax", href: "/#trax" },
      { label: "Integrations", href: "/#integrations" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Book a demo", href: "/strategy-call" },
      { label: "Start free trial", href: "/#pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/#bl-title" },
      // Only while a story exists: the samples never reach the live site.
      ...(STORIES.length > 0 ? [{ label: "Customer stories", href: "/#st-title" }] : []),
    ],
  },
];

const LEGAL = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Security", href: "/security" },
];

export function Footer() {
  return (
    <footer className="ft overflow-hidden">
      <FooterWater />
      <div className="ft-top mx-auto w-full max-w-[1500px] px-5 pt-16 sm:px-10 sm:pt-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)]">
          <div>
            <Link href="/" aria-label="Drive247 home" className="ft-logo inline-block">
              {/* The footer is dark in both themes, so it always carries the logo made for dark. */}
              <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="h-8 w-auto" />
            </Link>
            <p className="ft-muted mt-5 max-w-sm text-[15px] leading-relaxed">
              The all-in-one platform for independent car rental businesses: bookings, payments, agreements and keys.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h4 className="ft-head text-base font-semibold">{column.title}</h4>
                <ul className="ft-list mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className="ft-link ft-muted text-[15px] transition-colors duration-200 ease-out">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="ft-muted mt-16 flex flex-wrap items-center justify-between gap-4 text-sm sm:mt-24">
          <p>&copy; {new Date().getFullYear()} Drive247. All rights reserved.</p>
          <p className="ft-legal">
            {LEGAL.map((link, i) => (
              <span key={link.href}>
                {i > 0 && " · "}
                <Link href={link.href} className="transition-colors duration-200 ease-out">
                  {link.label}
                </Link>
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* SVG so `textLength` fits it edge to edge in any font: the legal pages use another. Solid, in the brand's indigo. */}
      <svg className="ft-word" viewBox="0 -8 1000 186" aria-hidden>
        <text x="4" y="176" textLength="992" lengthAdjust="spacingAndGlyphs" fontSize="240" fontWeight="800">
          DRIVE247
        </text>
      </svg>
    </footer>
  );
}
