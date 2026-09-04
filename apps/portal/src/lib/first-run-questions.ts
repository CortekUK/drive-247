/**
 * The first-run wizard's questions — THE single place to edit them.
 *
 * Everything else about the wizard is generic: `first-run-wizard.tsx` renders
 * whatever is in `FIRST_RUN_QUESTIONS`, one question per step, and stores the
 * answers as a JSON object keyed by `id`. So changing the questions is an edit
 * to this array and nothing else — no JSX to touch, no migration to write, no
 * columns to add. Reordering, adding a sixth, dropping one, changing a prompt
 * or an option list are all one-file changes.
 *
 * PLACEHOLDERS. These five are a reasonable first guess at what is worth asking
 * a brand-new car-rental operator, pending the real list. Swap them freely.
 *
 * If you DO swap them, bump `FIRST_RUN_QUESTION_SET_VERSION`. Answers are
 * stored as `{ [question id]: answer }` in one jsonb column, so a row written
 * against an older list is only interpretable if we recorded which list it was
 * answering. The version is written alongside the answers; nothing reads it
 * yet, and that is fine — it costs nothing now and is unrecoverable later.
 *
 * Adding a question does NOT make the wizard reappear for tenants who already
 * finished it. That is deliberate: the persisted row means "this operator has
 * been through onboarding", not "this operator has answered question set N".
 * Re-asking would need an explicit decision, not an accident of editing a list.
 */

/** One selectable answer. `value` is what lands in the database. */
export interface FirstRunOption {
  value: string;
  label: string;
  /** Optional second line under the label. */
  hint?: string;
}

interface FirstRunQuestionBase {
  /**
   * Stable key for this question in the stored answers object.
   *
   * Treat it as permanent once shipped — renaming an id orphans every answer
   * already collected under the old one.
   */
  id: string;
  /** The question itself, shown as the step heading. */
  prompt: string;
  /** Optional supporting line under the prompt. */
  help?: string;
  /** When true, Next stays disabled until the question is answered. */
  required: boolean;
}

export type FirstRunQuestion =
  | (FirstRunQuestionBase & {
      /** Pick exactly one. */
      kind: 'single';
      options: readonly FirstRunOption[];
    })
  | (FirstRunQuestionBase & {
      /** Pick any number. */
      kind: 'multi';
      options: readonly FirstRunOption[];
    })
  | (FirstRunQuestionBase & {
      /** Free text, one line. */
      kind: 'text';
      placeholder?: string;
    });

/** A single question's answer: one value, several values, or free text. */
export type FirstRunAnswer = string | string[];

/** The whole set of answers, keyed by question id. */
export type FirstRunAnswers = Record<string, FirstRunAnswer>;

/**
 * Bump whenever the question list below changes in a way that changes what an
 * answer MEANS — a new question, a removed one, a reworded prompt, a changed
 * option value. Purely additive prompts/help text do not need it.
 */
export const FIRST_RUN_QUESTION_SET_VERSION = 1;

export const FIRST_RUN_QUESTIONS: readonly FirstRunQuestion[] = [
  {
    id: 'fleet_size',
    kind: 'single',
    prompt: 'How many vehicles are you starting with?',
    help: 'You can add or remove vehicles at any time — this just helps us set the right defaults.',
    required: true,
    options: [
      { value: '1-2', label: '1 – 2 vehicles' },
      { value: '3-5', label: '3 – 5 vehicles' },
      { value: '6-10', label: '6 – 10 vehicles' },
      { value: '11-25', label: '11 – 25 vehicles' },
      { value: '25+', label: 'More than 25' },
    ],
  },
  {
    id: 'primary_location',
    kind: 'text',
    prompt: 'Where do you rent from?',
    help: 'The city or airport most of your pickups happen in.',
    required: true,
    placeholder: 'e.g. Denver, CO',
  },
  {
    id: 'vehicle_types',
    kind: 'multi',
    prompt: 'What kind of vehicles do you rent?',
    help: 'Pick everything that applies.',
    required: true,
    options: [
      { value: 'economy', label: 'Economy & compact' },
      { value: 'sedan', label: 'Sedans' },
      { value: 'suv', label: 'SUVs & crossovers' },
      { value: 'luxury', label: 'Luxury & exotic' },
      { value: 'ev', label: 'Electric vehicles' },
      { value: 'van', label: 'Vans & minibuses' },
      { value: 'truck', label: 'Trucks & commercial' },
    ],
  },
  {
    id: 'takes_payments_today',
    kind: 'single',
    prompt: 'How do you take payment today?',
    help: 'Tells us how much of the payments setup to walk you through.',
    required: true,
    options: [
      { value: 'stripe', label: 'Card payments, through Stripe' },
      { value: 'other_processor', label: 'Card payments, through another processor' },
      { value: 'manual', label: 'Cash, bank transfer or in person' },
      { value: 'not_yet', label: "I'm not taking bookings yet" },
    ],
  },
  {
    id: 'referral_source',
    kind: 'single',
    prompt: 'How did you hear about Drive247?',
    help: 'Optional — but it genuinely helps us.',
    required: false,
    options: [
      { value: 'search', label: 'Google or another search engine' },
      { value: 'social', label: 'Social media' },
      { value: 'word_of_mouth', label: 'Another operator told me' },
      { value: 'event', label: 'An industry event' },
      { value: 'other', label: 'Somewhere else' },
    ],
  },
];

/**
 * Is `question` satisfied by `answer`?
 *
 * Extracted so the Next button, the completion check and the tests all agree on
 * one definition of "answered". An optional question is always satisfied; a
 * required one needs a non-empty value of the right shape.
 */
export function isAnswered(
  question: FirstRunQuestion,
  answer: FirstRunAnswer | undefined,
): boolean {
  if (!question.required) return true;
  if (answer === undefined || answer === null) return false;
  if (Array.isArray(answer)) return answer.length > 0;
  return answer.trim().length > 0;
}
