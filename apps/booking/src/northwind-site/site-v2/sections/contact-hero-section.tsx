import Link from 'next/link';

import { DEFAULT_CONTACT_HERO, DEFAULT_SITE_SOCIAL } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { loadSection } from '@nw/lib/cms/server';
import { socialLinks } from '@nw/lib/cms/social';
import { PageIntro } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the /contact intro. The current hero's sources
 * (`contact / hero` for the words, `site-settings / social` for the icons) and
 * the same `data-cms` paths, so the portal's visual editor edits both versions.
 *
 * The background photo, the roadside pill and the "Inquire" button are gone:
 * a v2 page opens with its title and one muted line. The form is not here
 * either — it sits beside the details in `contact-details-section.tsx`.
 */
export async function ContactHeroSection() {
  const [hero, social] = await Promise.all([
    loadSection('contact', 'hero', DEFAULT_CONTACT_HERO),
    loadSection('site-settings', 'social', DEFAULT_SITE_SOCIAL),
  ]);

  const socials = socialLinks(social);

  return (
    <div {...cmsSection('contact.hero', 'Hero')}>
      <PageIntro
        eyebrow="Contact"
        title={<Editable path="contact.hero.title">{hero.title}</Editable>}
        description={<Editable path="contact.hero.subtitle">{hero.subtitle}</Editable>}
        actions={
          socials.length > 0 ? (
            <ul aria-label="Follow us" className="flex flex-wrap items-center gap-2">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <Link
                    href={href}
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-full border border-pv-border bg-pv-card text-pv-fg transition-colors duration-200 ease-out hover:border-pv-primary/40 hover:text-pv-primary motion-reduce:transition-none"
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null
        }
      />
    </div>
  );
}
