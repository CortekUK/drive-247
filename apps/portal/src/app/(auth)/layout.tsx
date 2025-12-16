"use client";

import { DynamicThemeProvider } from "@/components/shared/layout/dynamic-theme-provider";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DynamicThemeProvider>{children}</DynamicThemeProvider>;
}
