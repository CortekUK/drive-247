import { DEFAULT_ABOUT_HERO } from "@nw/lib/cms/defaults";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { loadSection } from "@nw/lib/cms/server";
import { CenteredHeader } from "@nw/site-v2/kit";

/**
 * Northwind booking site v2 — the About page's opening: an "About us" label
 * and the operator's headline and line (`about / hero`, editable in place).
 * It melts into the page along a soft curved edge, above the story band's arc.
 */
export async function AboutIntro() {
  const hero = await loadSection("about", "hero", DEFAULT_ABOUT_HERO);
  const subtitle = hero.subtitle.trim();

  return (
    <CenteredHeader
      cms={cmsSection("about.hero", "Hero")}
      wave="arch"
      title={<Editable path="about.hero.title">{hero.title}</Editable>}
      description={subtitle ? <Editable path="about.hero.subtitle">{subtitle}</Editable> : undefined}
    />
  );
}
