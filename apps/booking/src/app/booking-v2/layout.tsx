import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Drive247 — Drive More. Live More.",
  description: "Premium vehicles. Transparent pricing.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
