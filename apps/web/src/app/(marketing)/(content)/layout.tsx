import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { LandingTheme } from "@/components/shared/landing-theme";

/*
 * The blog and customer stories: the landing page's look and chrome, with the header's
 * pill showing from the top (there is no hero to scroll past) and linking back to the
 * landing page's sections.
 */
export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return (
    <LandingTheme>
      <Header pillPage />
      <main id="main">{children}</main>
      <Footer />
    </LandingTheme>
  );
}
