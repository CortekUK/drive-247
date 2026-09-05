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

          <div className="mt-2 flex flex-col gap-1">
            <p className="text-sm font-medium text-brand-text-soft">
              Founder Drive 247
            </p>
            <p className="text-sm text-brand-text-soft">Jhon Doe</p>
            <FounderSignature />
          </div>
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

function FounderSignature() {
  return (
    <svg
      width="80"
      height="40"
      viewBox="0 0 80 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="mt-2 text-brand-text-soft"
    >
      <path
        d="M4 28 C 6 22, 10 14, 14 18 C 16 22, 12 28, 16 32 C 20 28, 24 16, 28 22 C 32 28, 32 18, 36 22 C 40 28, 42 22, 46 26 C 50 30, 56 18, 62 24 C 66 28, 60 36, 56 32"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
