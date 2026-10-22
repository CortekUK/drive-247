import type { Metadata } from "next";
import Link from "next/link";
import { Manrope } from "next/font/google";
import { ArrowLeft, ArrowRight } from "lucide-react";
import "@/components/landing-v4/landing-v4.css";
import "./not-found.css";

/*
 * The site's 404, in the landing page's own design (landing-v4): Manrope, the
 * brand purple #442DD7, pill buttons, and the soft-blob-and-line art the
 * sections use, kept to the corners. A big "404" whose zero is a steering
 * wheel, a short line, the way home, and links to the main sections.
 */
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Page not found · Drive247",
  robots: { index: false },
};

const LINKS = [
  { href: "/#x-showcase", label: "The portal" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#x-pricing", label: "Pricing" },
  { href: "/#x-faq", label: "FAQ" },
];

/** A steering wheel, drawn as the "0" of 404. */
function Wheel() {
  return (
    <svg className="nf-wheel" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="50" />
      <circle cx="60" cy="60" r="13" />
      <path d="M12 52 C 30 46 44 47 49 55" />
      <path d="M108 52 C 90 46 76 47 71 55" />
      <path d="M60 73 V 110" />
    </svg>
  );
}

export default function NotFound() {
  return (
    <div className={`l4 nf ${manrope.variable}`}>
      {/* line art in two corners, as on the landing page's sections */}
      <svg className="nf-art l" viewBox="0 0 520 1000" preserveAspectRatio="xMinYMin slice" aria-hidden="true">
        <path className="fill" d="M0 0 H300 C 320 90 240 150 170 168 C 100 186 56 240 0 252 Z" />
        <path className="line" d="M-20 228 C 80 200 150 128 240 116 S 390 64 440 -20" />
        <path className="line" d="M-20 194 C 60 206 128 160 182 92 S 252 -10 296 -30" />
      </svg>
      <svg className="nf-art r" viewBox="0 0 520 1000" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <path className="fill" d="M540 760 C 470 750 410 776 372 830 C 334 884 280 914 206 926 C 150 936 128 966 128 1010 H540 Z" />
        <path className="line" d="M80 1030 C 160 950 214 856 302 828 S 440 842 540 796" />
        <path className="line" d="M150 1030 C 226 972 248 886 334 864 S 466 884 540 838" />
      </svg>

      <header className="nf-top">
        <Link href="/" aria-label="Drive247 home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-light.png" alt="Drive247" />
        </Link>
        <a className="l4-btn primary" href="/strategy-call">
          Book a demo
        </a>
      </header>

      <main className="nf-main">
        <span className="l4-kick">Page not found</span>
        <p className="nf-code" aria-label="404">
          <span>4</span>
          <Wheel />
          <span>4</span>
        </p>
        <h1 className="l4-h2">This road doesn&rsquo;t go anywhere</h1>
        <p className="l4-lead">
          The page you were looking for has moved, or never existed. Let&rsquo;s get you back on track.
        </p>
        <div className="nf-ctas">
          <Link className="l4-btn primary lg" href="/">
            <ArrowLeft size={16} />
            Back to home
          </Link>
          <a className="l4-btn outline lg" href="/strategy-call">
            Book a demo
            <ArrowRight size={16} />
          </a>
        </div>
        <nav className="nf-links" aria-label="Popular pages">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
