import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  Mail,
  ClipboardCheck,
  MessageSquare,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Call booked — Drive247",
  description:
    "Your strategy call is confirmed. We'll prepare a tailored 7-day launch plan for your rental operation before the call.",
  openGraph: {
    title: "Call booked — Drive247",
    description:
      "Your strategy call is confirmed. We'll prepare a tailored 7-day launch plan for your rental operation.",
    url: `${SITE_URL}/strategy-call/confirmation`,
  },
};

const EXPECTATION_CARDS = [
  {
    icon: Mail,
    title: "Check your email",
    text: "You'll receive the calendar invite and call details shortly. Please accept the invite so it's saved to your calendar.",
  },
  {
    icon: ClipboardCheck,
    title: "We'll prepare beforehand",
    text: "We'll review your fleet size, current booking source, platform and launch goals before the call.",
  },
  {
    icon: MessageSquare,
    title: "Bring your questions",
    text: "We'll cover payments, bookings, agreements, customer flow and how to reduce marketplace dependency.",
  },
];

const PREPARATION_ITEMS = [
  "Your current booking process",
  "Fleet details and vehicle types",
  "Your website, domain or current booking link if you have one",
  "Any questions about launching direct bookings",
  "Your biggest issue with marketplaces, payments or customer management",
];

const CALL_COVERS = [
  "Where your current setup is costing time or margin",
  "How your direct booking system would be structured",
  "What needs to happen to launch with Drive247 in 7 days",
];

export default function ConfirmationPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      {/* Hero confirmation */}
      <section className="pb-10 pt-12 sm:pt-16">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
            <CheckCircle2 className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
          </div>

          <h1 className="mt-4 text-3xl font-extrabold tracking-tighter sm:text-4xl">
            Your 7-day direct booking launch call is booked
          </h1>

          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            We&apos;ll review your answers before the call so we can map out
            the clearest route to launching your own direct booking system.
          </p>
        </div>
      </section>

      {/* Expectation cards */}
      <section className="pb-10">
        <div className="grid gap-3 sm:grid-cols-3">
          {EXPECTATION_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border bg-card p-5"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                <card.icon className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold tracking-tight">
                {card.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {card.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Preparation section */}
      <section className="pb-10">
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-base font-bold tracking-tight">
            To get the most from the call
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Have these ready if possible:
          </p>
          <ul className="mt-4 space-y-2.5">
            {PREPARATION_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                  <Check className="h-2.5 w-2.5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <span className="text-sm leading-snug">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What we'll cover */}
      <section className="pb-10">
        <h2 className="mb-4 text-center text-base font-bold tracking-tight">
          What we&apos;ll cover
        </h2>
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
          {CALL_COVERS.map((item, i) => (
            <div key={i} className="flex items-start gap-3 bg-card p-4">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600/[0.08] text-[11px] font-bold text-indigo-600 dark:bg-indigo-400/[0.1] dark:text-indigo-400">
                {i + 1}
              </span>
              <p className="text-sm leading-snug">{item}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reassurance */}
      <section className="pb-10">
        <p className="mx-auto max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
          No pressure, no generic demo. The call is designed to give you a
          clear route to launching your own direct booking system.
        </p>
      </section>

      {/* CTA */}
      <section className="pb-12">
        <div className="rounded-xl border bg-card p-6 text-center">
          <h2 className="text-base font-bold tracking-tight">
            Need to update or reschedule?
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            If you need to update your answers or reschedule, use the link in
            your calendar invite or contact us.
          </p>

          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              className="bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              <Link href="/">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back to Drive247
              </Link>
            </Button>
            <a
              href="mailto:support@drive-247.com"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact support
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
