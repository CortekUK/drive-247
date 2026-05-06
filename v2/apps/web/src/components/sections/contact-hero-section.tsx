import {
  Facebook,
  Instagram,
  ShieldCheck,
  Twitter,
  Youtube,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ContactForm } from "@/components/forms/contact-form";

const SOCIALS = [
  { Icon: Youtube, href: "#", label: "YouTube" },
  { Icon: Instagram, href: "#", label: "Instagram" },
  { Icon: Facebook, href: "#", label: "Facebook" },
  { Icon: Twitter, href: "#", label: "X" },
];

export function ContactHeroSection() {
  return (
    <section className="relative isolate bg-brand-cream">
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

      <div className="container-page relative grid grid-cols-1 gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-stretch lg:gap-x-16 lg:py-16">
        {/* LEFT — Hero text block; stretches to row height so Follow us can sit at the bottom */}
        <div className="flex flex-col gap-8 lg:h-full">
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-white/90 px-4 py-2 text-[12px] leading-tight text-brand-text shadow-sm ring-1 ring-brand-border-soft backdrop-blur-sm">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-amber/30">
              <ShieldCheck className="size-3 text-brand-text" strokeWidth={2} />
            </span>
            24/7 Roadside Assistance included with every verified rental.
          </div>

          <div className="flex max-w-[520px] flex-col gap-4">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
              What can we help you with?
            </h1>
            <p className="text-sm leading-relaxed text-brand-text-soft sm:text-base">
              Whether you have questions about a specific vehicle’s vitals or
              need assistance with a custom booking, our fleet specialists are
              here to help.
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
            <ul className="flex items-center gap-3">
              {SOCIALS.map(({ Icon, href, label }) => (
                <li key={label}>
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

        {/* RIGHT — Form. Pulled down so it splits ~50/50 between the hero and
            the Contact Details section below (top half in hero, bottom half overlaps). */}
        <div
          id="contact-form"
          className="relative z-10 w-full self-start lg:mt-56 lg:mb-[-260px] xl:mt-64 xl:mb-[-300px]"
        >
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
