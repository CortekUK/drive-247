import { DEFAULT_CONTACT_HERO } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { loadSection } from '@nw/lib/cms/server';
import { CenteredHeader } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the /contact opening: a "Contact us" label and
 * the operator's headline and line (`contact / hero`, same `data-cms` paths
 * as v1), centred like About, ending in a soft wave. The ways to reach them
 * come right after.
 */
export async function ContactHeroSection() {
  const hero = await loadSection('contact', 'hero', DEFAULT_CONTACT_HERO);
  const subtitle = hero.subtitle.trim();

  return (
    <CenteredHeader
      cms={cmsSection('contact.hero', 'Hero')}
      wave
      title={<Editable path="contact.hero.title">{hero.title}</Editable>}
      description={subtitle ? <Editable path="contact.hero.subtitle">{subtitle}</Editable> : undefined}
    />
  );
}
