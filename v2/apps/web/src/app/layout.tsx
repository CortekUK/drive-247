import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Drive247 — Rent the exact car you see",
    template: "%s · Drive247",
  },
  description:
    "Premium digital car rental. Every vehicle is digitally inspected and safety-certified before pickup.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} font-sans`}>{children}</body>
    </html>
  );
}
