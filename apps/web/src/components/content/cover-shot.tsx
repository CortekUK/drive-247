import Image from "next/image";
import type { Cover } from "@/content/types";
import "./content.css";

/**
 * A real product screen inside a cover. The light and dark captures are both
 * rendered and the theme hides one, so there is no swap after the page loads.
 * Decorative: the title next to it says what the post is.
 */
export function CoverShot({ cover, sizes }: { cover: Cover; sizes: string }) {
  return (
    <div className="ct-shot">
      <Image src={cover.src} alt="" fill sizes={sizes} className="dark:hidden" />
      <Image src={cover.dark} alt="" fill sizes={sizes} className="hidden dark:block" />
    </div>
  );
}
