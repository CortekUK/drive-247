import { Manrope } from "next/font/google";
import "./landing-theme.css";

// The portal v2 typeface (apps/portal/src/app/layout.tsx), for this page only.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

/*
 * The live landing page in the Northwind portal's look. Everything is scoped to
 * this one wrapper (see landing-theme.css), so the pages that share globals.css,
 * and the signup dialog that portals to <body>, keep their own theme.
 * `pv2-tokens` is the class that switches on the portal's shared token values.
 */
export function LandingTheme({ children }: { children: React.ReactNode }) {
  return <div className={`${manrope.variable} lp-v2 pv2-tokens`}>{children}</div>;
}
