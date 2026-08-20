import { Inter, Plus_Jakarta_Sans } from "next/font/google";

/**
 * booking-v2 typefaces. Kept in their own module because `next/font` loaders
 * must be called at module scope, and the landing is mounted from two places —
 * the /booking-v2 route and the tenant home page — which must share one font
 * instance rather than each requesting its own.
 */
export const d7Display = Plus_Jakarta_Sans({
  subsets: ["latin"], weight: ["600", "700", "800"],
  variable: "--font-display", display: "swap",
});

export const d7Ui = Inter({
  subsets: ["latin"], weight: ["400", "500", "600", "700"],
  variable: "--font-ui", display: "swap",
});
