/*
 * Chrome (header, footer) lives with each landing version in page.tsx, so v2
 * can bring its own instead of inheriting v1's.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
