import type { Metadata } from "next";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import DevPanel from "@/components/DevPanel";

export const metadata: Metadata = {
  title: "Cortek Drive - Multi-Tenant Rental Management Platform",
  description: "Grow faster with bespoke rental management systems powered by Cortek",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>
        <NextTopLoader color="#3b82f6" height={2} showSpinner={false} />
        {children}
        <DevPanel />
      </body>
    </html>
  );
}
