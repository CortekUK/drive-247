// ── The education screens, one set per integration ────────────────────────────
//
// What an operator sees before an integration is active: three screens, a
// picture and a few words each, in Trax's voice (first person, no emojis),
// then the one button that starts. See `_screens.tsx` for the standard.
//
// EVERY CLAIM HERE IS ONE THE PANEL BEHIND IT CAN BACK. The sources are the
// header notes of each panel file — read them before changing a word. Where an
// integration is a preview (Inshur, CheckMyDriver), the last screen
// says so plainly and its button closes the dialog: there is nothing to start.
//
// Pictures are the app's own illustration set (components/illustrations-v2),
// reused where one tells the step's story. Bonzah and BoldSign are not
// listed: each runs its own screens (bonzah.tsx, boldsign.tsx) — BoldSign is
// always connected, so its two screens ARE its introduction.

import type { IntroSpec } from "./_screens";

import { BlockedDatesEmptyArt } from "@/components/illustrations-v2/scenes/blocked-dates";
import { PendingBookingsEmptyArt } from "@/components/illustrations-v2/scenes/pending-bookings";
import { RemindersEmptyArt } from "@/components/illustrations-v2/scenes/reminders";
import { PaymentsEmptyArt } from "@/components/illustrations-v2/scenes/payments";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";
import { OwnerPayoutsEmptyArt } from "@/components/illustrations-v2/scenes/owner-payouts";
import { QuotesEmptyArt } from "@/components/illustrations-v2/scenes/quotes";
import { InsurancesEmptyArt } from "@/components/illustrations-v2/scenes/insurances";
import { DocumentsEmptyArt } from "@/components/illustrations-v2/scenes/documents";
import { UsersEmptyArt } from "@/components/illustrations-v2/scenes/users";
import { MessagesEmptyArt } from "@/components/illustrations-v2/scenes/messages";
import { SupportEmptyArt } from "@/components/illustrations-v2/scenes/support";
import { EnquiriesEmptyArt } from "@/components/illustrations-v2/scenes/enquiries";
import { ExpensesEmptyArt } from "@/components/illustrations-v2/scenes/expenses";
import { CustomDomainArt } from "@/components/illustrations-v2/scenes/custom-domain";
import { LeadsEmptyArt } from "@/components/illustrations-v2/scenes/leads";
import { CustomersEmptyArt, VehiclesEmptyArt } from "@/components/illustrations-v2/empty-scenes";

export const INTEGRATION_INTROS: Record<string, IntroSpec> = {
  "Turo Sync": {
    cta: "Let's start",
    slides: [
      {
        art: BlockedDatesEmptyArt,
        title: "Your Turo trips, in one calendar.",
        body: "Turo Sync brings the trips you take on Turo into Drive247, so one calendar shows every booking you have — wherever it came from.",
      },
      {
        art: PendingBookingsEmptyArt,
        title: "No more double-booking.",
        body: "A Turo trip holds its car's dates here too, so the same car can't be sold on two platforms at once. Any trip can become an ordinary Drive247 rental.",
      },
      {
        art: SupportEmptyArt,
        title: "Your Turo password stays yours.",
        body: "A Chrome extension reads the Turo session already open in your browser. It never asks for your password, and never writes anything back to Turo.",
      },
    ],
  },

  "Stripe Connect": {
    cta: "Set up Stripe",
    slides: [
      {
        art: PaymentsEmptyArt,
        title: "Get paid for every booking.",
        body: "Stripe takes your customers' card payments when they book, then pays the money out to your bank account.",
      },
      {
        // The confusion this clears up: operators already pay Drive247
        // through Stripe, and assume that IS the connection. It is not.
        art: QuotesEmptyArt,
        title: "Two different things called Stripe.",
        body: "Your Drive247 subscription is billed by us, through our own Stripe — there's nothing for you to set up there. Stripe Connect is yours: it's where your customers' booking payments land.",
      },
      {
        art: InvoicesEmptyArt,
        title: "Deposits, held safely.",
        body: "I can hold a security deposit on the customer's card and release it after the rental. The money only moves if you need it.",
      },
      {
        art: OwnerPayoutsEmptyArt,
        title: "Set up once with Stripe.",
        body: "Sign in to Stripe or create an account, and confirm your business and bank details there. As soon as Stripe approves it, your bookings start paying into it.",
      },
    ],
  },

  Square: {
    cta: "Set up Square",
    slides: [
      {
        art: PaymentsEmptyArt,
        title: "Take payments through Square.",
        body: "Already run your business on Square? Your booking payments can go through your Square account instead of Stripe.",
      },
      {
        art: QuotesEmptyArt,
        title: "One payment provider at a time.",
        body: "Square replaces Stripe for your bookings. Switching is a one-time choice, so I'll show you exactly what changes and confirm with you before anything does.",
      },
      {
        art: OwnerPayoutsEmptyArt,
        title: "Connect your Square account.",
        body: "Sign in to Square and approve Drive247. Your booking payments then land in your Square balance.",
      },
    ],
  },

  Inshur: {
    preview: true,
    cta: "Got it",
    slides: [
      {
        art: InsurancesEmptyArt,
        title: "Cover between rentals.",
        body: "Inshur is fleet insurance that follows the car, not the booking — so a car sitting on your lot is covered the same as one that's out.",
      },
      {
        art: VehiclesEmptyArt,
        title: "Checked before you commit.",
        body: "Each car is checked against Inshur's rules before cover is created, and you choose whether you absorb the premium or the renter pays it.",
      },
      {
        art: RemindersEmptyArt,
        title: "Coming soon.",
        body: "Inshur isn't available yet. When it is, I'll keep the list of states you can write cover in up to date for you.",
      },
    ],
  },

  CheckMyDriver: {
    preview: true,
    cta: "Got it",
    slides: [
      {
        art: DocumentsEmptyArt,
        title: "Check every driver's licence.",
        body: "CheckMyDriver confirms a renter's licence is genuine, current and theirs — before the keys change hands.",
      },
      {
        art: UsersEmptyArt,
        title: "The renter does the work.",
        body: "They get a secure link and photograph their licence on their own phone. The answer — valid, invalid or expired — lands on their rental.",
      },
      {
        art: RemindersEmptyArt,
        title: "Coming soon.",
        body: "CheckMyDriver isn't available on your account yet. Nothing here connects today.",
      },
    ],
  },

  "Twilio Messages": {
    cta: "Connect Twilio",
    slides: [
      {
        art: MessagesEmptyArt,
        title: "Text your customers.",
        body: "Send booking confirmations, reminders and updates by SMS, from your own business number.",
      },
      {
        art: SupportEmptyArt,
        title: "They can text you back.",
        body: "Replies come straight into your Messages inbox, so the whole conversation stays in one place.",
      },
      {
        art: LeadsEmptyArt,
        title: "Your account, your number.",
        body: "Connect your Twilio account, then buy a number right here or use one you already have. I check it's set up before a customer gets a text.",
      },
    ],
  },

  "Twilio Calling": {
    cta: "Set up calling",
    slides: [
      {
        art: SupportEmptyArt,
        title: "Never miss a customer's call.",
        body: "Calls to your Twilio number ring through to your real phone, wherever you are.",
      },
      {
        art: MessagesEmptyArt,
        title: "Voicemail when you're busy.",
        body: "If nobody picks up, the caller can leave a voicemail instead of hanging up.",
      },
      {
        art: EnquiriesEmptyArt,
        title: "Recordings and a short summary.",
        body: "Calls can be recorded, and I write a short summary of each one. No Twilio number yet? You can buy one right here.",
      },
    ],
  },

  Tesla: {
    cta: "Connect Tesla",
    slides: [
      {
        art: VehiclesEmptyArt,
        title: "Bill Supercharging automatically.",
        body: "Every hour I pull your Teslas' charging sessions and match each one to the rental that was running at the time.",
      },
      {
        art: ExpensesEmptyArt,
        title: "Charge it or waive it.",
        body: "Each session lands on the rental as a Supercharger charge, ready for you to bill the customer or let go.",
      },
      {
        art: InvoicesEmptyArt,
        title: "Connect your Tesla account.",
        body: "Sign in to Tesla and allow access to your cars' charging history, then pick which cars I should watch.",
      },
    ],
  },

  "Custom Domain": {
    cta: "Set up my domain",
    slides: [
      {
        art: CustomDomainArt,
        title: "Your own web address.",
        body: "Customers book at a domain you own — like yourrentals.com — instead of a Drive247 address.",
      },
      {
        art: CustomersEmptyArt,
        title: "Your portal, there too.",
        body: "Your team signs in at portal. in front of the same domain, so everything carries your name.",
      },
      {
        art: SupportEmptyArt,
        // The self-serve story (Ghulam, Oct 2): the operator adds two records
        // themselves and never hands over access. Demoed on northwind via
        // custom-domain-demo.tsx; other tenants' panel is still the manual
        // handoff until the Vercel-backed function is built.
        title: "Connect it in a few minutes.",
        body: "Tell me your domain, then add two records where you bought it. You stay in charge — nobody needs your password or access — and I'll let you know the moment it's live.",
      },
    ],
  },

  Xero: {
    cta: "Connect Xero",
    slides: [
      {
        art: InvoicesEmptyArt,
        title: "Your bookings, in Xero.",
        body: "Invoices and payments from Drive247 go to Xero, so your books follow your business without retyping.",
      },
      {
        art: ExpensesEmptyArt,
        title: "Choose where things land.",
        body: "You pick which Xero accounts your sales and payments are recorded against.",
      },
      {
        art: PaymentsEmptyArt,
        title: "Connect with Xero.",
        body: "Sign in to Xero and approve Drive247. I'll show you what's been sent and anything that's waiting.",
      },
    ],
  },

  Zoho: {
    cta: "Connect Zoho",
    slides: [
      {
        art: ExpensesEmptyArt,
        title: "Your bookings, in Zoho Books.",
        body: "Invoices and payments from Drive247 go to Zoho Books, so your accounts follow your business without retyping.",
      },
      {
        art: InvoicesEmptyArt,
        title: "Choose where things land.",
        body: "You confirm which Zoho accounts your sales and payments are recorded against before anything is sent.",
      },
      {
        art: PaymentsEmptyArt,
        title: "Connect with Zoho.",
        body: "Sign in to Zoho and approve Drive247. I'll show you what's been sent and anything that's waiting.",
      },
    ],
  },
};
