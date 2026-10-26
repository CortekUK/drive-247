import { DEFAULT_ABOUT_STORY } from "@nw/lib/cms/defaults";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { htmlToParagraphs } from "@nw/lib/cms/html";
import { loadSection } from "@nw/lib/cms/server";
import { cn } from "@nw/lib/utils";
import { AboutArt } from "@nw/site-v2/illustrations/page-scenes";
import { EYEBROW, SITE_H2, SITE_WIDE } from "@nw/site-v2/kit";

/**
 * Northwind booking site v2 — the operator's story on /about (`about /
 * about_story`): their shop drawn on the left (the office, a car out front,
 * someone holding out the keys) and the story on the right — an "Our story"
 * label with "since 2019" when they gave a founding year, their heading, the
 * first paragraph large and the rest under it. The rich text becomes plain
 * paragraphs, never injected HTML (`lib/cms/html.ts`).
 *
 * It sits on the About page's tinted backdrop (`AboutBackdrop`), so it has no
 * surface of its own.
 */
export async function AboutStory() {
  const story = await loadSection("about", "about_story", DEFAULT_ABOUT_STORY);
  const [lead, ...rest] = htmlToParagraphs(story.content);
  const since = story.founded_year?.trim();

  return (
    <section
      {...cmsSection("about.about_story", "Your story")}
      aria-labelledby="about-story-title"
      className={cn(SITE_WIDE, "grid items-center gap-10 pt-6 md:pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16")}
    >
      <div data-reveal className="rounded-[28px] bg-pv-card p-6 sm:p-10">
        <AboutArt className="mx-auto h-auto w-full max-w-[520px]" />
      </div>

      <div data-reveal style={{ "--d": "100ms" } as React.CSSProperties}>
        <span className={cn(EYEBROW, "bg-pv-card")}>
          Our story
          {since ? (
            <>
              <span aria-hidden className="text-pv-muted-fg">·</span>
              {"since "}
              <Editable path="about.about_story.founded_year">{since}</Editable>
            </>
          ) : null}
        </span>
        <h2 id="about-story-title" className={cn(SITE_H2, "mt-5")}>
          <Editable path="about.about_story.title">{story.title}</Editable>
        </h2>
        {lead ? <p className="mt-5 text-[17px] leading-relaxed text-pv-fg/85 sm:mt-6 sm:text-[18px] md:text-[20px]">{lead}</p> : null}
        {rest.map((paragraph, index) => (
          <p
            key={`${index}-${paragraph.slice(0, 24)}`}
            className="mt-4 text-[16px] leading-relaxed text-pv-muted-on-tint"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}
