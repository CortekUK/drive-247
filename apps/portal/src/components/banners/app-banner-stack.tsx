/**
 * AppBannerStack — the mount point. Drop this where banners should appear.
 *
 * Split from `useAppBanners` so the registry stays a plain hook (testable
 * without a renderer) and this file stays a thin component with no logic of its
 * own.
 */
"use client";

import { BannerStack, type BannerStackProps } from "./banner-stack";
import { useAppBanners } from "./use-app-banners";

export type AppBannerStackProps = Omit<BannerStackProps, "banners">;

export function AppBannerStack(props: AppBannerStackProps) {
  const banners = useAppBanners();
  return <BannerStack banners={banners} {...props} />;
}
