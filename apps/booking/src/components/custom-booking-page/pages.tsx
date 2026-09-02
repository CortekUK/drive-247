"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon, StarIcon } from "./icons";
import { Reveal } from "./reveal";
import { cmsIcon, VehicleCard } from "./home";
import { CBP, type CbpContent } from "./use-site-content";

/** Shown in place of a section the operator has not populated yet. */
function Empty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="cbp-card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-[14px] text-[var(--body)]">{children}</p>
    </div>
  );
}

/* ========================================================================== */
/* ABOUT                                                                      */
/* ========================================================================== */

export function AboutPage({ c }: { c: CbpContent }) {
  const hasStory = c.about.paragraphs.length > 0;
  return (
    <section className="cbp-wrap py-14 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <Reveal>
          {c.about.title && <h2 className="cbp-h2">{c.about.title}</h2>}
          <span className="mt-3 block h-1 w-14 rounded-full bg-[linear-gradient(95deg,var(--grad-from),var(--grad-to))]" />
          {hasStory ? (
            <div className="mt-6 flex flex-col gap-4">
              {c.about.paragraphs.map((p, i) => (
                <p key={i} className="cbp-body">{p}</p>
              ))}
            </div>
          ) : (
            <p className="cbp-body mt-6">
              {c.tagline || `${c.name} rents vehicles${c.address ? ` in ${c.address}` : ""}.`}
            </p>
          )}
        </Reveal>

        {c.stats.length > 0 && (
          <Reveal delay={80}>
            <ul className="grid grid-cols-2 gap-4">
              {c.stats.slice(0, 4).map(s => (
                <li key={s.label} className="cbp-card cbp-lift flex flex-col items-center gap-2 p-6 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon name={cmsIcon(s.icon)} className="h-5 w-5" />
                  </span>
                  <span className="cbp-num mt-1 block text-[22px] font-extrabold leading-none text-[var(--ink)]">{s.value}</span>
                  <span className="block text-[11.5px] capitalize text-[var(--body)]">{s.label.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>

      {c.whyChoose.items.length > 0 && (
        <div className="mt-14">
          <Reveal className="text-center">
            <h2 className="cbp-h2">{c.whyChoose.title || `Why Choose ${c.name}`}</h2>
          </Reveal>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.whyChoose.items.map((i, idx) => (
              <Reveal as="li" key={i.title} delay={(idx % 3) * 70}>
                <div className="cbp-card cbp-lift flex h-full flex-col items-center gap-3 p-6 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon name={cmsIcon(i.icon)} className="h-5 w-5" />
                  </span>
                  <h3 className="text-[14.5px] font-bold text-[var(--ink)]">{i.title}</h3>
                  {i.copy && <p className="text-[13px] leading-relaxed text-[var(--body)]">{i.copy}</p>}
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      )}

      {c.rentalTerms.length > 0 && (
        <Reveal className="mt-14">
          <h2 className="cbp-h2 text-center">Rental Terms</h2>
          <ul className="mx-auto mt-8 grid max-w-[52rem] grid-cols-2 gap-4 sm:grid-cols-3">
            {c.rentalTerms.map(t => (
              <li key={t.label} className="cbp-card p-5 text-center">
                <span className="cbp-label block">{t.label}</span>
                <span className="cbp-num mt-1.5 block text-[15px] font-bold text-[var(--ink)]">{t.value}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </section>
  );
}

/* ========================================================================== */
/* FLEET & PRICING                                                            */
/* ========================================================================== */

export function FleetPage({ c }: { c: CbpContent }) {
  const [cat, setCat] = useState("");
  const shown = useMemo(
    () => (cat ? c.vehicles.filter(v => v.category === cat) : c.vehicles),
    [c.vehicles, cat],
  );

  return (
    <section className="cbp-wrap py-14 sm:py-16">
      {c.categories.length > 0 && (
        <Reveal className="mb-8 flex flex-wrap justify-center gap-2">
          <FilterChip on={!cat} onClick={() => setCat("")}>All vehicles</FilterChip>
          {c.categories.map(k => (
            <FilterChip key={k} on={cat === k} onClick={() => setCat(k)}>{k}</FilterChip>
          ))}
        </Reveal>
      )}

      {c.fleetLoading ? (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <li key={i} className="cbp-card overflow-hidden">
              <div className="cbp-skeleton aspect-[4/3] w-full !rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <div className="cbp-skeleton h-4 w-4/5" /><div className="cbp-skeleton h-3 w-2/5" />
              </div>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <Empty icon="car">No vehicles are listed yet. Please check back soon.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {shown.map((v, i) => (
            <Reveal as="li" key={v.id} delay={Math.min(i, 7) * 50} className="min-w-0">
              <VehicleCard v={v} c={c} />
            </Reveal>
          ))}
        </ul>
      )}

      {c.fleetPage.inclusions.length > 0 && (
        <Reveal className="mt-14">
          <h2 className="cbp-h2 text-center">What&apos;s Included</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.fleetPage.inclusions.map(i => (
              <li key={i.title} className="cbp-card flex h-full flex-col items-center gap-2.5 p-5 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon name={cmsIcon(i.icon)} className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[13.5px] font-bold text-[var(--ink)]">{i.title}</span>
                {i.copy && <span className="text-[12.5px] leading-relaxed text-[var(--body)]">{i.copy}</span>}
              </li>
            ))}
          </ul>
        </Reveal>
      )}

      <Reveal className="mt-12 text-center">
        <Link href={`${CBP}#booking`} className="cbp-btn cbp-btn-primary">
          {c.hero.bookCta} <Icon name="arrow" className="cbp-arrow h-4 w-4" />
        </Link>
      </Reveal>
    </section>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
        on
          ? "bg-[linear-gradient(95deg,var(--grad-from),var(--grad-to))] text-white shadow-[var(--shadow-brand)]"
          : "border border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ========================================================================== */
/* REVIEWS                                                                    */
/* ========================================================================== */

export function ReviewsPage({ c }: { c: CbpContent }) {
  const avg = c.reviews.length
    ? (c.reviews.reduce((s, r) => s + r.stars, 0) / c.reviews.length).toFixed(1)
    : null;

  return (
    <section className="cbp-wrap py-14 sm:py-16">
      {c.reviews.length === 0 ? (
        <Empty icon="star">No reviews have been published yet.</Empty>
      ) : (
        <>
          {avg && (
            <Reveal className="mb-10 flex flex-col items-center gap-2">
              <span className="flex gap-1 text-[var(--star)]">
                {Array.from({ length: 5 }, (_, i) => <StarIcon key={i} className="h-5 w-5" />)}
              </span>
              <p className="cbp-num text-[26px] font-extrabold text-[var(--ink)]">{avg} / 5</p>
              <p className="text-[13px] text-[var(--body)]">
                from {c.reviews.length} {c.reviews.length === 1 ? "review" : "reviews"}
              </p>
            </Reveal>
          )}

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.reviews.map((r, i) => (
              <Reveal as="li" key={r.id} delay={(i % 3) * 70}>
                <figure className="cbp-card cbp-lift flex h-full flex-col gap-3 p-5">
                  <Icon name="quote" className="h-6 w-6 shrink-0 text-[var(--line)]" />
                  <span className="flex gap-0.5 text-[var(--star)]" aria-label={`${r.stars} out of 5`}>
                    {Array.from({ length: r.stars }, (_, s) => <StarIcon key={s} />)}
                  </span>
                  <blockquote className="text-[13.5px] leading-relaxed text-[var(--body)]">{r.review}</blockquote>
                  <figcaption className="mt-auto flex items-center gap-3 pt-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[12px] font-bold text-[var(--brand)]">
                      {r.author.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-[var(--ink)]">{r.author}</span>
                      {r.company && <span className="block truncate text-[11.5px] text-[var(--meta)]">{r.company}</span>}
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ========================================================================== */
/* CONTACT                                                                    */
/* ========================================================================== */

/**
 * Contact details plus the enquiry form. The form posts through the app's
 * existing `submitContactEnquiry` path in `lib/tenantQueries`, so enquiries
 * land in the same table the operator already reads in the portal.
 */
export function ContactPage({
  c, onSubmit,
}: {
  c: CbpContent;
  onSubmit: (v: { name: string; email: string; phone: string; message: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await onSubmit(form);
      setSent(true);
      setForm({ name: "", email: "", phone: "", message: "" });
    } finally {
      setSending(false);
    }
  };

  const details = [
    c.phoneHref && { icon: "phone", label: "Call us", value: c.phoneDisplay!, href: `tel:${c.phoneHref}` },
    c.email && { icon: "mail", label: "Email us", value: c.email, href: `mailto:${c.email}` },
    c.address && { icon: "pin", label: "Visit us", value: c.address, href: c.mapsUrl },
    c.hours && { icon: "clock", label: "Opening hours", value: c.hours, href: null },
  ].filter(Boolean) as { icon: string; label: string; value: string; href: string | null }[];

  return (
    <section className="cbp-wrap py-14 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14">
        <Reveal>
          <ul className="flex flex-col gap-4">
            {details.map(d => (
              <li key={d.label} className="cbp-card flex items-center gap-4 p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-md)] bg-[linear-gradient(150deg,var(--grad-from),var(--grad-to))] text-white">
                  <Icon name={d.icon} className="h-[19px] w-[19px]" />
                </span>
                <span className="min-w-0">
                  <span className="cbp-label block">{d.label}</span>
                  {d.href ? (
                    <a
                      href={d.href}
                      target={d.href.startsWith("http") ? "_blank" : undefined}
                      rel={d.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="mt-0.5 block break-words text-[15px] font-bold text-[var(--ink)] transition-colors hover:text-[var(--brand)]"
                    >
                      {d.value}
                    </a>
                  ) : (
                    <span className="mt-0.5 block break-words text-[15px] font-bold text-[var(--ink)]">{d.value}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {c.weeklyHours.length > 0 && (
            <div className="cbp-card mt-4 p-5">
              <p className="cbp-label mb-3">Opening hours</p>
              <ul className="flex flex-col gap-1.5">
                {c.weeklyHours.map(h => (
                  <li key={h.day} className="flex items-center justify-between text-[13px]">
                    <span className="text-[var(--body)]">{h.day}</span>
                    <span className="cbp-num font-semibold text-[var(--ink)]">{h.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Reveal>

        <Reveal delay={80}>
          <form onSubmit={submit} className="cbp-card p-6 sm:p-7">
            <h2 className="cbp-h3">Send an enquiry</h2>
            <p className="mt-1 text-[13px] text-[var(--body)]">
              Tell us what you need and we&apos;ll get back to you.
            </p>

            {sent && (
              <p className="mt-5 flex items-center gap-2 rounded-[var(--r-sm)] bg-[var(--brand-soft)] px-4 py-3 text-[13px] font-semibold text-[var(--brand-ink)]">
                <Icon name="checkCircle" className="h-4 w-4 shrink-0" />
                Thanks — your enquiry has been sent.
              </p>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Labelled label="Your name" required>
                <input required value={form.name} onChange={set("name")} className="cbp-field" placeholder="Full name" />
              </Labelled>
              <Labelled label="Email" required>
                <input required type="email" value={form.email} onChange={set("email")} className="cbp-field" placeholder="you@example.com" />
              </Labelled>
              <Labelled label="Phone" className="sm:col-span-2">
                <input type="tel" value={form.phone} onChange={set("phone")} className="cbp-field" placeholder="Optional" />
              </Labelled>
            </div>

            <label className="mt-4 block">
              <span className="cbp-label mb-1.5 block">Message</span>
              <span className="cbp-field-shell !items-start">
                <textarea
                  required rows={4} value={form.message} onChange={set("message")}
                  className="cbp-field resize-y" placeholder="How can we help?"
                />
              </span>
            </label>

            <button type="submit" disabled={sending} className="cbp-btn cbp-btn-primary mt-5 w-full">
              {sending ? "Sending…" : "Send enquiry"}
              {!sending && <Icon name="arrow" className="cbp-arrow h-4 w-4" />}
            </button>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Labelled({
  label, required, className = "", children,
}: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="cbp-label mb-1.5 block">
        {label}{required && <span className="text-[var(--brand)]"> *</span>}
      </span>
      <span className="cbp-field-shell">{children}</span>
    </label>
  );
}

/* ========================================================================== */
/* LEGAL                                                                      */
/* ========================================================================== */

/**
 * Privacy and Terms. The body is the operator's own rich text from the portal
 * CMS, rendered as authored — the same content the existing `/privacy` and
 * `/terms` pages serve, so the two can never diverge.
 */
export function LegalPage({ html, fallbackHref }: { html: string | null; fallbackHref: string }) {
  return (
    <section className="cbp-wrap py-14 sm:py-16">
      {html ? (
        <Reveal className="cbp-card mx-auto max-w-[52rem] p-6 sm:p-9">
          <div
            className="cbp-legal text-[14px] leading-relaxed text-[var(--body)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </Reveal>
      ) : (
        <div className="mx-auto max-w-[52rem]">
          <Empty icon="doc">
            This policy has not been published yet.{" "}
            <Link href={fallbackHref} className="cbp-link !inline-flex align-baseline">View the current version</Link>
          </Empty>
        </div>
      )}
    </section>
  );
}
