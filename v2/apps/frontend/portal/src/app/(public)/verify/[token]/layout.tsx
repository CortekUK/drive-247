import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ID Verification',
  robots: { index: false, follow: false },
};

/**
 * Minimal layout for the public QR-token mobile capture page. No
 * sidebar, no auth gate. Full height, centered content.
 */
export default function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      {children}
    </div>
  );
}
