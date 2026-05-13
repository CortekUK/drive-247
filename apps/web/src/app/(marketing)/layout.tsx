import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function MarketingLayout({
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
