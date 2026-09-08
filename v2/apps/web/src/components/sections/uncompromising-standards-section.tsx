import Image from "next/image";

import { DEFAULT_ABOUT_STORY } from "@/lib/cms/defaults";
import { htmlToParagraphs } from "@/lib/cms/html";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * The founder's-note band on /about — the portal's `about / about_story`.
 *
 * That field is rich text from the portal's Tiptap editor, stored as raw HTML.
 * It is rendered as TEXT paragraphs, never injected: see `lib/cms/html.ts` for
 * why (stored XSS, and a rich-text `<table>` would destroy this fixed
 * two-column layout at 360px).
 *
 * The founder attribution below has no CMS field and stays a design constant.
 */
export async function UncompromisingStandardsSection() {
  const story = await loadSection("about", "about_story", DEFAULT_ABOUT_STORY);
  const paragraphs = htmlToParagraphs(story.content);

  return (
    <section {...cmsSection("about.about_story", "Your story")} className="bg-white">
      <div className="container-page grid grid-cols-1 items-center gap-10 py-12 lg:grid-cols-2 lg:gap-16 lg:py-20">
        <div className="flex flex-col gap-6">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
            <Editable path="about.about_story.title">{story.title}</Editable>
          </h2>

          <div className="flex max-w-[480px] flex-col gap-4">
            {paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 24)}`}
                className="text-sm leading-relaxed text-brand-text-soft sm:text-base"
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/*
            A signed founder's statement used to sit here — "Founder Drive 247",
            "Jhon Doe", and a handwritten signature graphic — hardcoded, so it
            appeared on EVERY tenant's About page. It named our company as the
            author of their story and attributed it to a person who does not
            exist, above a signature none of them wrote.

            There is no founder field in the About spec (`cms-spec.ts` has
            `title`, `founded_year` and `content`), so there is nothing real to
            put in its place, and inventing one for each tenant is the bug. The
            story copy above IS the operator's own words; it stands unsigned
            until a signature field exists to fill honestly.
          */}
        </div>

        <div className="relative overflow-hidden rounded-[18px]">
          <Image
            src="/booking_landingpage/about-interior.jpg"
            alt="Premium vehicle interior"
            width={1400}
            height={1000}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-auto w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}
