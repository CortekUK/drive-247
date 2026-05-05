import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-brand-cream">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
