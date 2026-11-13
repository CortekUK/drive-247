"use client";

import { useEffect } from "react";
import { captureAdClick } from "@/lib/meta-tracking";

/** Remembers the ad a visitor arrived from (see lib/meta-tracking.ts). Renders nothing. */
export function AdClickCapture() {
  useEffect(() => {
    captureAdClick();
  }, []);
  return null;
}
