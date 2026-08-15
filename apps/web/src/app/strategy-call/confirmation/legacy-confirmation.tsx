import Link from "next/link";
import { ArrowLeft, CalendarClock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const PREPARATION_ITEMS = [
  "Your current booking process",
  "Fleet details and vehicle types",
  "Your website, domain or current booking link if you have one",
  "Any questions about launching direct bookings",
  "Your biggest issue with marketplaces, payments or customer management",
];

export function LegacyConfirmation() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      <section className="pb-10 pt-12 text-center sm:pt-16">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
          <CalendarClock className="size-7 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tighter sm:text-4xl">
          Prepare for your Drive247 strategy call
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          If you have just selected a time, your GHL calendar invite is the
          source of truth for the booking. Use this page to get ready for the
          conversation.
        </p>
      </section>

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
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
                  <Check className="size-2.5 text-indigo-600 dark:text-indigo-400" />
                </span>
                <span className="text-sm leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pb-12">
        <div className="rounded-xl border bg-card p-6 text-center">
          <h2 className="text-base font-bold tracking-tight">
            Need to update or reschedule?
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Use the link in your calendar invite or contact us.
          </p>
          <div className="mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="bg-indigo-600 text-white hover:bg-indigo-700">
              <Link href="/">
                <ArrowLeft />
                Back to Drive247
              </Link>
            </Button>
            <a
              href="mailto:support@drive-247.com"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Contact support
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
