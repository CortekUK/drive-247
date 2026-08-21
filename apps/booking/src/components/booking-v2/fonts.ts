import { Inter, Playfair_Display } from "next/font/google";

/**
 * Two faces, sharply divided: a high-contrast editorial serif carries every
 * headline, a quiet grotesque carries everything else — labels, body copy and
 * the numbers inside the product mockups.
 */
export const serif = Playfair_Display({
  subsets: ["latin"], weight: ["400", "500", "600"],
  variable: "--font-serif", display: "swap",
});

export const sans = Inter({
  subsets: ["latin"], weight: ["400", "500", "600"],
  variable: "--font-sans", display: "swap",
});
