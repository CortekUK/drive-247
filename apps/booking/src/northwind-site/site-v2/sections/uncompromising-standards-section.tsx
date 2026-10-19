import Image from "next/image";

import { DEFAULT_ABOUT_STORY } from "@nw/lib/cms/defaults";
import { htmlToParagraphs } from "@nw/lib/cms/html";
import { loadSection } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { SITE_CONTAINER } from "@nw/site-v2/kit";

/**
 * v2 of `components/sections/uncompromising-standards-section.tsx` — the
 * story band on /about. Same key (`about / about_story`); the rich text is
 * still rendered as plain paragraphs, never injected (see `lib/cms/html.ts`).
 */
export async function UncompromisingStandardsSection() {
  const story = await loadSection("about", "about_story", DEFAULT_ABOUT_STORY);
  const paragraphs = htmlToParagraphs(story.content);

  return (
    <section
      {...cmsSection("about.about_story", "Your story")}
      className={`${SITE_CONTAINER} grid items-center gap-8 pt-12 md:pt-16 lg:grid-cols-2 lg:gap-12`}
    >
      <div className="min-w-0">
        <h2 className="text-[24px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[28px]">
          <Editable path="about.about_story.title">{story.title}</Editable>
        </h2>
        <div className="mt-4 flex max-w-[520px] flex-col gap-3">
          {paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`} className="text-[15px] leading-relaxed text-pv-muted-fg">
              {paragraph}
            </p>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-pv-border bg-pv-muted">
        <Image
          src="/booking_landingpage/about-interior.jpg"
          alt="Premium vehicle interior"
          width={1400}
          height={1000}
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="aspect-[4/3] h-auto w-full object-cover"
        />
      </div>
    </section>
  );
}
