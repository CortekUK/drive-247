import { Instrument_Serif } from "next/font/google";

import { Footer } from "@/components/layout/footer";
import { LandingTheme } from "@/components/shared/landing-theme";

// The cursive face the articles use for a marked phrase.
const cursive = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-cursive", display: "swap" });

/*
 * A blog article: the landing page's look, but no navigation bar. The article carries
 * its own small strip (the logo and a way back), so nothing sits over the reading.
 */
export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return (
    <LandingTheme>
      <div className={cursive.variable}>
        <main id="main">{children}</main>
        <Footer />
      </div>
    </LandingTheme>
  );
}
