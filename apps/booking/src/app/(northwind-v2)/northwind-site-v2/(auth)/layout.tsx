import { Manrope } from "next/font/google";

/**
 * Northwind sign-in v2 — the auth screens in the operator portal v2's design
 * language. No site header or footer: on a sign-in screen every link is a way
 * to lose the person before they finish. Components in src/northwind-site/auth-v2/.
 */

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default function AuthV2Layout({ children }: { children: React.ReactNode }) {
  return <div className={manrope.variable}>{children}</div>;
}
