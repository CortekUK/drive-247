import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Drive247 Admin Portal',
  description: 'Super admin dashboard for Drive247',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
