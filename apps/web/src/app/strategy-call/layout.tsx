import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export const metadata: Metadata = {
  title: "Book a Strategy Call — Drive247",
  description:
    "Get a free 20-minute strategy call with our founding team. We'll audit your setup, mock up your direct booking site, and give you a 7-day launch plan.",
  openGraph: {
    title: "Book a Strategy Call — Drive247",
    description:
      "Get a free 20-minute strategy call. Setup audit, live site preview, and a custom 7-day launch plan — whether you sign or not.",
    url: `${SITE_URL}/strategy-call`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Book a Strategy Call — Drive247",
    description:
      "Get a free 20-minute strategy call. Setup audit, live site preview, and a custom 7-day launch plan.",
  },
};

export default function StrategyCallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header — logo only */}
      <header className="border-b border-border/40">
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
          <ThemeToggle />
        </div>
      </header>

      <main>{children}</main>

      {/* Minimal footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground sm:px-6">
          <p>&copy; {new Date().getFullYear()} Cortek. All rights reserved.</p>
          <a
            href="mailto:support@drive-247.com"
            className="transition-colors hover:text-foreground"
          >
            support@drive-247.com
          </a>
        </div>
      </footer>
    </div>
  );
}
