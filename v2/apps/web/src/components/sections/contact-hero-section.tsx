import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ContactForm } from "@/components/forms/contact-form";
import { DEFAULT_CONTACT_HERO, DEFAULT_SITE_SOCIAL } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { socialLinks } from "@/lib/cms/social";

/**
 * The /contact hero. Copy from `contact / hero`, social row from
 * `site-settings / social`.
 *
 * The roadside-assistance pill and the "Inquire About a Vehicle" button are
 * design constants — the portal's contact page has no field for either. The
 * form itself is `components/forms/contact-form.tsx`, which this agent does not
 * own, so `contact / contact_form` is reported unmapped rather than half-wired.
 */
export async function ContactHeroSection() {
  const [hero, social] = await Promise.all([
    loadSection("contact", "hero", DEFAULT_CONTACT_HERO),
    loadSection("site-settings", "social", DEFAULT_SITE_SOCIAL),
  ]);

  const socials = socialLinks(social);

  return (
    <section className="relative isolate -mt-[88px] bg-brand-cream">
      {/* Background image clipped to its own absolute wrapper so the form can overflow the section */}
      <div className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
        <Image
          src="/booking_landingpage/contact-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/55 to-brand-cream"
        />
      </div>

      <div className="container-page relative grid grid-cols-1 gap-10 pb-12 pt-[120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-stretch lg:gap-x-16 lg:pb-16 lg:pt-[160px]">
        {/* LEFT — Hero text block; stretches to row height so Follow us can sit at the bottom */}
        <div className="flex flex-col gap-8 lg:h-full">
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-white/90 px-4 py-2 text-[12px] leading-tight text-brand-text shadow-sm ring-1 ring-brand-border-soft backdrop-blur-sm">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-amber/30">
              <ShieldCheck className="size-3 text-brand-text" strokeWidth={2} />
            </span>
            24/7 Roadside Assistance included with every verified rental.
          </div>

          <div className="flex max-w-[520px] flex-col gap-4">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
              {hero.title}
            </h1>
            <p className="text-sm leading-relaxed text-brand-text-soft sm:text-base">
              {hero.subtitle}
            </p>
          </div>

          <Link
            href="#contact-form"
            className="inline-flex w-fit items-center justify-center rounded-full bg-brand-forest px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Inquire About a Vehicle
          </Link>

          <div className="flex items-center gap-4 lg:mt-auto lg:pt-8">
            <span className="text-[13px] text-brand-text-soft">Follow us:</span>
            <ul className="flex flex-wrap items-center gap-3">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <Link
                    href={href}
                    aria-label={label}
                    className="inline-flex size-8 items-center justify-center rounded-full bg-brand-text text-white transition-opacity hover:opacity-85"
                  >
                    <Icon className="size-3.5" strokeWidth={2} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* RIGHT — Form (desktop only). Pulled down so it splits ~50/50 between
            the hero and the Contact Details section below. On mobile the form
            renders after Contact Details (see ContactDetailsSection). */}
        <div
          id="contact-form"
          className="relative z-10 hidden w-full self-start lg:mt-56 lg:mb-[-260px] lg:block xl:mt-64 xl:mb-[-300px]"
        >
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
