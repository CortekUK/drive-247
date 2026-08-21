import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Drive247 — Move Better.",
  description: "The all-in-one platform to run your rental business with clarity, control and confidence.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
