import { Facebook, Instagram, Linkedin, Twitter, Youtube } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { SocialLinksContent } from "./types";

export interface SocialLink {
  key: string;
  label: string;
  href: string;
  Icon: LucideIcon;
}

/**
 * Order the Figma footer/hero rows use. TikTok has no lucide glyph and is
 * deliberately absent rather than rendered as a wrong icon.
 */
const ORDER: ReadonlyArray<{ key: keyof SocialLinksContent; label: string; Icon: LucideIcon }> = [
  { key: "youtube", label: "YouTube", Icon: Youtube },
  { key: "instagram", label: "Instagram", Icon: Instagram },
  { key: "facebook", label: "Facebook", Icon: Facebook },
  { key: "twitter", label: "X", Icon: Twitter },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
];

/**
 * The shipped design shows four social icons. They point at `#` because the
 * prototype had nowhere to send anyone; keeping them is the fallback, so a
 * tenant who has not filled in `site-settings / social` sees the same row they
 * see today rather than losing it.
 */
const PLACEHOLDERS: readonly SocialLink[] = ORDER.slice(0, 4).map(
  ({ key, label, Icon }) => ({ key, label, href: "#", Icon }),
);

/** Configured networks only, in design order; the placeholder row when none. */
export function socialLinks(content: SocialLinksContent): readonly SocialLink[] {
  const configured = ORDER.flatMap(({ key, label, Icon }) => {
    const href = content[key].trim();
    return href === "" ? [] : [{ key, label, href, Icon }];
  });

  return configured.length > 0 ? configured : PLACEHOLDERS;
}
