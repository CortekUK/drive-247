import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
