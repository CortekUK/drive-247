import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import LegalPageShell from '@/components/legal/LegalPageShell';

// Server-rendered so reviewers / The Campaign Registry crawler see the full
// opt-in proof without executing JS. This page is the canonical, publicly
// verifiable consent record cited in every tenant's A2P 10DLC MESSAGE_FLOW.
export const dynamic = 'force-dynamic';

interface OptInTenant {
  app_name: string | null;
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  phone: string | null;
  twilio_phone_number: string | null;
}

async function getTenant(): Promise<OptInTenant | null> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    if (!tenantSlug) return null;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return null;
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data } = await supabase
      .from('tenants')
      .select('app_name, company_name, contact_email, contact_phone, phone, twilio_phone_number')
      .eq('slug', tenantSlug)
      .single();
    return (data as OptInTenant) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const name = tenant?.app_name || tenant?.company_name || 'Our Rentals';
  return {
    title: `SMS Messaging Terms | ${name}`,
    description: `How ${name} sends SMS text messages, how to opt in, message frequency, rates, and how to opt out (reply STOP).`,
  };
}

export default async function SmsOptInPage() {
  const tenant = await getTenant();
  const headersList = await headers();
  const tenantSlug = headersList.get('x-tenant-slug');
  const brand = tenant?.app_name || tenant?.company_name || 'this rental company';
  const email = tenant?.contact_email || null;
  const phone = tenant?.contact_phone || tenant?.phone || null;
  const twilioNumber = tenant?.twilio_phone_number || null;

  // Verbatim consent language — must stay identical to the checkbox shown on the
  // /booking form (apps/booking/src/app/booking/page.tsx). Reviewers cross-check this.
  const consentLanguage = `I agree to receive SMS text messages from ${brand} about my rental — booking confirmations, vehicle collection/pickup details, lockbox codes and e-signing links. Message & data rates may apply. Message frequency varies. Reply STOP to opt out, HELP for help. See our Privacy Policy and Terms. Consent is not a condition of rental.`;

  return (
    <LegalPageShell
      tenant={{ slug: tenantSlug, name: brand, contactEmail: email, contactPhone: phone }}
    >
      <section className="pt-12 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-3 text-foreground">
              SMS Messaging Terms
            </h1>
            <p className="text-muted-foreground mb-10 text-lg">
              How {brand} sends text messages, and how you control them.
            </p>

            <div className="space-y-8 text-[15px] leading-relaxed text-muted-foreground">
              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">Program description</h2>
                <p>
                  {brand} sends transactional SMS text messages to customers who book or enquire
                  about a vehicle rental. These messages relate to your rental only — booking
                  confirmations, reservation and status updates, vehicle pickup/collection details,
                  lockbox codes, e-signing links, trip and return reminders, payment notifications,
                  and customer support. We never send marketing or promotional text messages through
                  this program.
                </p>
                {twilioNumber && (
                  <p className="mt-3">
                    Messages will originate from{' '}
                    <strong className="text-foreground">{twilioNumber}</strong>.
                  </p>
                )}
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">How you opt in</h2>
                <p className="mb-4">
                  Consent is collected on our online booking form. After choosing a vehicle and
                  entering your contact details, you are shown an{' '}
                  <strong className="text-foreground">unchecked</strong> consent checkbox that you must
                  tick yourself. It is never pre-selected, and giving consent is{' '}
                  <strong className="text-foreground">not a condition</strong> of renting a vehicle.
                  The exact wording shown next to the checkbox is:
                </p>

                {/* Visual replica of the live booking-form consent checkbox */}
                <div className="flex flex-row items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px] border-2 border-primary" aria-hidden="true" />
                  <p className="text-sm text-foreground">{consentLanguage}</p>
                </div>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">Message frequency</h2>
                <p>
                  Message frequency varies and depends on your rental activity (for example, a
                  booking confirmation, pickup reminder, or a reply to a support question).
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">Cost</h2>
                <p>Message &amp; data rates may apply, charged by your mobile carrier.</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">How to opt out or get help</h2>
                <p>
                  You can cancel SMS messages at any time by replying{' '}
                  <strong className="text-foreground">STOP</strong> to any message. After you reply
                  STOP we will send one confirmation and then stop sending messages; reply{' '}
                  <strong className="text-foreground">START</strong> to opt back in. For help, reply{' '}
                  <strong className="text-foreground">HELP</strong>
                  {(email || phone) ? (
                    <>
                      {' '}or contact us
                      {email ? (
                        <> at <a href={`mailto:${email}`} className="text-accent underline">{email}</a></>
                      ) : null}
                      {phone ? <> on {phone}</> : null}
                    </>
                  ) : null}
                  .
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-foreground mb-3">Privacy</h2>
                <p>
                  We do not share, sell, or otherwise provide your mobile phone number, mobile
                  information, or SMS consent to any third parties, affiliates, or lead generators
                  for marketing or promotional purposes. Full details are in our{' '}
                  <Link href="/privacy" className="text-accent underline">Privacy Policy</Link> and{' '}
                  <Link href="/terms" className="text-accent underline">Terms of Service</Link>.
                </p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </LegalPageShell>
  );
}
