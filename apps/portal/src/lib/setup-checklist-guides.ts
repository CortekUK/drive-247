/**
 * The short written guides behind the setup checklist's "read" button — the
 * pages the dashboard's book-style reader turns through
 * (components/dashboard-v2/checklist-guide-reader.tsx).
 *
 * ⚠️ CHECKED AGAINST THE CODE ON 2026-09-16. Every point below was traced to
 * the portal, booking app and edge-function source as they stood that day
 * (repo code only, no production access). These features move: when
 * auto-extension, installments, pay-as-you-go or Bonzah change — a default, a
 * cron, a gate in the create form, a Settings label — RE-CHECK THE MATCHING
 * GUIDE BEFORE SHIPPING THE CHANGE, and move `CHECKLIST_GUIDES_CHECKED_ON`
 * forward. A guide that describes last quarter's behaviour is worse than none:
 * the operator reads it once and then trusts it.
 *
 * WHY THIS IS NOT A LINK TO SETTINGS. "We keep settings to settings; we don't
 * educate about features in settings" — many of the details an operator trips
 * on (when a renewal pauses, why a policy is waiting, what closing a rental
 * stops) are not settings at all and never will be. So the checklist row's
 * second button opens these pages, and never routes to /settings.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *  - Evidence. Each point was checked against file:line references; those stay
 *    in the review notes, not in the bundle.
 *  - Behaviour that could not be confirmed from the repo (deployed cron state,
 *    production-only triggers), and known bugs — a guide states what an
 *    operator can rely on, not what the code happens to do wrong today.
 *
 * Keyed by the same permanent `key` as `SETUP_CHECKLIST_ITEMS` in
 * lib/setup-checklist.ts. A row whose key has no guide here falls back to its
 * external written guide URL, if it has one.
 *
 * Wording rule for edits: one idea per point, short enough to read at a glance
 * on a phone-width page, no internal names (tables, columns, functions).
 */

export interface ChecklistGuidePage {
  heading: string;
  points: readonly string[];
}

export interface ChecklistGuide {
  /** Matches `SetupChecklistItem.key`. */
  key: string;
  /** The feature's name, as the row shows it. */
  title: string;
  pages: readonly ChecklistGuidePage[];
}

/** The day every point below was last traced to the code. */
export const CHECKLIST_GUIDES_CHECKED_ON = '2026-09-16';

export const SETUP_CHECKLIST_GUIDES: readonly ChecklistGuide[] = [
  {
    key: 'auto_extension',
    title: 'Auto-extension',
    pages: [
      {
        heading: 'What it is and when to use it',
        points: [
          'A rental that renews every week or month, with the customer paying before each new period begins.',
          'Suits drivers with no set return date. It is the opposite of pay as you go, which bills afterwards.',
          'Turn it on in Settings, Pricing and payments, Auto-extension. It can only be chosen when a rental is created.',
          'Set the end date one period out. The cycle is read from those dates, so by default a 28-day month renews weekly.',
        ],
      },
      {
        heading: 'How each renewal is paid',
        points: [
          'At the end of each period, less your lead time, the renewal is charged to the saved card or emailed as a payment link.',
          'With no saved card, the renewal is emailed as a link. If you take deposits as card holds, these rentals never have one.',
          'The end date moves forward only once a renewal is paid. Renewals run until the rental closes or hits any period limit you set.',
          "Credit on the customer's account is applied first. A renewal it fully covers sends no charge and no email.",
        ],
      },
      {
        heading: 'Pauses, reminders and deposits',
        points: [
          'Unpaid renewal links get a reminder email about every 2 days, up to 3 per renewal by default.',
          'By default, renewals pause when a link is still unpaid 48 hours after the latest email, or a card fails 3 times.',
          'Paying the outstanding link resumes renewals. Resuming by hand leaves it unpaid, so the rental can pause again.',
          'Auto-extension rentals never get a deposit card hold. A deposit you charge as a payment is still billed.',
        ],
      },
    ],
  },
  {
    key: 'installments',
    title: 'Installments',
    pages: [
      {
        heading: 'What it is and when to use it',
        points: [
          'Customers split a longer rental into scheduled card payments instead of paying it all at checkout.',
          'Pay in full is always offered. Weekly plans need a rental of 7 days or more, monthly plans 30 days or more.',
          'Weekly plans can take 1 or 2 payments a week, and monthly plans 1 payment a month.',
          'The number of payments comes from the rental length, and is never fewer than two.',
        ],
      },
      {
        heading: 'How the plan is built and paid',
        points: [
          'At checkout the customer sees the schedule, then pays the upfront fees plus the first installment.',
          'Their card is saved at checkout, and each later installment is charged to it automatically once it is due.',
          'Installments are equal amounts; the last one absorbs any rounding difference.',
          'From their online account, customers can pay an installment early or pay off the rest, using their saved card.',
        ],
      },
      {
        heading: 'When an installment payment fails',
        points: [
          'When a charge fails, the customer is emailed one link that pays every overdue installment at once.',
          'The card is tried again no sooner than 24 hours later, for all overdue installments together.',
          'If the card asks the customer to confirm the payment three times in a row, the plan switches to manual collection.',
          'A plan with no saved card also goes manual. Manual plans are never card-charged; the customer pays by link or you record it.',
        ],
      },
      {
        heading: 'Turning it on',
        points: [
          'Turn on Enable Installments in Settings, Pricing and payments, Installments. That switch saves straight away.',
          'Then switch on the weekly or monthly plan and press Save changes, or customers still pay in full.',
          'Pay-as-you-go rentals cannot use an installment plan.',
          'Installments need Stripe. They are switched off for accounts that take payments through Square.',
        ],
      },
    ],
  },
  {
    key: 'payg',
    title: 'Pay as you go',
    pages: [
      {
        heading: 'What it is and when to use it',
        points: [
          'The customer pays for each day they keep the car, instead of paying for the whole rental upfront.',
          'Suits open-ended rentals. There is no return date, so a pay-as-you-go rental cannot be extended.',
          'You set a weekly or monthly rate, and the daily charge is that rate divided by 7 or by 30.',
          'Turn it on in Settings, Pricing and payments, Pay as you go, then choose it when creating a rental.',
        ],
      },
      {
        heading: 'How daily charges build up',
        points: [
          "Every 24 hours, one day's rent plus tax and service fee is added to what the customer owes.",
          'Days count from the start time you enter, never from before the rental was created.',
          'Charges only post while the rental is Active. If it becomes Active late, the days since the start are caught up.',
          'Weekend and holiday surcharges are not added to pay-as-you-go daily charges.',
        ],
      },
      {
        heading: 'How the customer pays',
        points: [
          'Nothing is taken from a card automatically. The customer pays by link, or you record the payment yourself.',
          'Reminder emails carry a link for the full balance and repeat every 4 days by default while money is owed.',
          "Each new reminder cancels the previous reminder's link, unless the customer is part-way through paying it.",
          'Customers can also see their charges and pay from their online account.',
        ],
      },
      {
        heading: 'Limits that cause questions',
        points: [
          'Installment plans cannot be used on pay-as-you-go rentals, and Bonzah cover is not offered when creating one.',
          'Charges stop after 90 days by default, and a critical alert asks you to close the rental.',
          'Closing the rental stops daily charges and automatic reminders, even if money is still owed.',
          'Turning off reminder emails in Settings stops the automatic ones on every pay-as-you-go rental.',
        ],
      },
    ],
  },
  {
    key: 'bonzah',
    title: 'Bonzah insurance',
    pages: [
      {
        heading: 'What it is',
        points: [
          'Bonzah sells rental car cover to your customers. The premium is added to what they pay you when they book.',
          "Choose from Collision Damage Waiver, Renter's Contingent Liability, Supplemental Liability and Personal Accident; Supplemental needs Renter's Contingent too.",
          "Policies are written for the state in the pickup address. If none can be read, the renter's home state is used.",
          "Bonzah won't cover some cars, like any BMW, Porsche or Mercedes AMG. The automatic check can miss one.",
        ],
      },
      {
        heading: 'How a policy is issued and paid',
        points: [
          'Online bookings get their policy once the customer pays; rentals you create get one at once. Both use your Bonzah balance.',
          'If your balance is too low, the booking and its premium charge go ahead but the policy waits. Top up, then retry.',
          'Cover cannot start today. The earliest start is tomorrow, Pacific time.',
          'Rentals longer than 30 days get back-to-back policies of up to 30 days each.',
        ],
      },
      {
        heading: 'Cover gaps that catch people out',
        points: [
          'Extensions need their own cover, bought in the extend dialog before the day the current cover ends, Pacific time.',
          "Bonzah's terms say a lapse cannot be filled afterwards, so cover has to run without a break.",
          "Auto-extension renewals never add cover on their own, so it ends after the first period. Pay as you go can't have cover.",
          'No single policy can be cancelled. Cancelling the whole rental asks Bonzah to cancel its policies, and Bonzah can refuse.',
        ],
      },
      {
        heading: 'Setting it up and keeping it running',
        points: [
          'Apply from the Bonzah card on the Integrations page. Bonzah reviews you, sends a login and switches the account live.',
          'Customers see cover while booking only when Offer insurance at checkout is on and Bonzah has made you live.',
          'If policies stop issuing, press Test connection on the Bonzah card. A rejected login usually means a password change at Bonzah.',
          'Watch the Bonzah balance on the same card and top up early; policies stop issuing when it runs out.',
        ],
      },
    ],
  },
];

/**
 * The guide for a checklist row, or `null` when none has been written.
 *
 * A linear `find` over an array rather than an object lookup on purpose: the
 * key can come from a database row, and `GUIDES['constructor']` on a plain
 * object would hand back a function instead of "no guide".
 */
export function checklistGuideFor(key: string | null | undefined): ChecklistGuide | null {
  if (!key) return null;
  return SETUP_CHECKLIST_GUIDES.find((guide) => guide.key === key) ?? null;
}
