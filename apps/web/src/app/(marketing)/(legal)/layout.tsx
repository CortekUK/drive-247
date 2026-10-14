import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

/*
 * v1 chrome for the legal pages. The landing page brings its own per version
 * (page.tsx), so the parent (marketing) layout no longer adds one.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main id="main" className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </>
  );
}
