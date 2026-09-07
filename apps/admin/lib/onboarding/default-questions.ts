/**
 * The question set the portal asks TODAY, mirrored for the admin editor.
 *
 * GENERATED from apps/portal/src/lib/first-run-questions.ts — the live source
 * of truth, and the list the wizard falls back to when the database has nothing
 * to give it.
 *
 * WHY IT EXISTS. Before `first_run_questions` is created, this page would
 * otherwise open on an empty screen with an "Add question" button — which reads
 * as "there are no questions", when in fact five are being asked right now.
 * Prefilling shows the real set, so the first save edits what operators
 * actually see instead of replacing it with whatever someone typed.
 *
 * A STARTING POINT, not the source of truth: once rows exist in the table they
 * win and this constant is never read again. Every entry here has no `id`,
 * because they are unsaved drafts until someone presses Save.
 */

export interface DefaultQuestion {
  question_key: string;
  kind: 'single' | 'multi' | 'text';
  prompt: string;
  help: string;
  placeholder: string;
  options: { value: string; label: string }[];
  is_required: boolean;
  sort_order: number;
  is_published: boolean;
}

export const DEFAULT_FIRST_RUN_QUESTIONS: DefaultQuestion[] = [
  {
    "question_key": "fleet_size",
    "kind": "single",
    "prompt": "How many vehicles are you starting with?",
    "help": "You can add or remove vehicles at any time — this just helps us set the right defaults.",
    "placeholder": "",
    "options": [
      {
        "value": "1-2",
        "label": "1 – 2 vehicles"
      },
      {
        "value": "3-5",
        "label": "3 – 5 vehicles"
      },
      {
        "value": "6-10",
        "label": "6 – 10 vehicles"
      },
      {
        "value": "11-25",
        "label": "11 – 25 vehicles"
      },
      {
        "value": "25+",
        "label": "More than 25"
      }
    ],
    "is_required": true,
    "sort_order": 10,
    "is_published": true
  },
  {
    "question_key": "primary_location",
    "kind": "text",
    "prompt": "Where do you rent from?",
    "help": "The city or airport most of your pickups happen in.",
    "placeholder": "e.g. Denver, CO",
    "options": [],
    "is_required": true,
    "sort_order": 20,
    "is_published": true
  },
  {
    "question_key": "vehicle_types",
    "kind": "multi",
    "prompt": "What kind of vehicles do you rent?",
    "help": "Pick everything that applies.",
    "placeholder": "",
    "options": [
      {
        "value": "economy",
        "label": "Economy & compact"
      },
      {
        "value": "sedan",
        "label": "Sedans"
      },
      {
        "value": "suv",
        "label": "SUVs & crossovers"
      },
      {
        "value": "luxury",
        "label": "Luxury & exotic"
      },
      {
        "value": "ev",
        "label": "Electric vehicles"
      },
      {
        "value": "van",
        "label": "Vans & minibuses"
      },
      {
        "value": "truck",
        "label": "Trucks & commercial"
      }
    ],
    "is_required": true,
    "sort_order": 30,
    "is_published": true
  },
  {
    "question_key": "takes_payments_today",
    "kind": "single",
    "prompt": "How do you take payment today?",
    "help": "Tells us how much of the payments setup to walk you through.",
    "placeholder": "",
    "options": [
      {
        "value": "stripe",
        "label": "Card payments, through Stripe"
      },
      {
        "value": "other_processor",
        "label": "Card payments, through another processor"
      },
      {
        "value": "manual",
        "label": "Cash, bank transfer or in person"
      },
      {
        "value": "not_yet",
        "label": "I'm not taking bookings yet"
      }
    ],
    "is_required": true,
    "sort_order": 40,
    "is_published": true
  },
  {
    "question_key": "referral_source",
    "kind": "single",
    "prompt": "How did you hear about Drive247?",
    "help": "Optional — but it genuinely helps us.",
    "placeholder": "",
    "options": [
      {
        "value": "search",
        "label": "Google or another search engine"
      },
      {
        "value": "social",
        "label": "Social media"
      },
      {
        "value": "word_of_mouth",
        "label": "Another operator told me"
      },
      {
        "value": "event",
        "label": "An industry event"
      },
      {
        "value": "other",
        "label": "Somewhere else"
      }
    ],
    "is_required": false,
    "sort_order": 50,
    "is_published": true
  }
];
