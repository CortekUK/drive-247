import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  FIRST_RUN_QUESTIONS,
  type FirstRunOption,
  type FirstRunQuestion,
} from '@/lib/first-run-questions';

/**
 * The wizard's questions — from the database, falling back to the compiled list.
 *
 * A super admin authors these in apps/admin (Configuration → Onboarding
 * Questions). `public.first_run_questions` is platform-wide, not per-tenant:
 * every new operator is asked the same set, so there is no `tenant_id` here and
 * no tenant filter to get wrong (V2_PLAN §5).
 *
 * THE FALLBACK IS NOT A NICETY, and it is why this can ship before the table
 * exists. `FIRST_RUN_QUESTIONS` stays in `lib/first-run-questions.ts` as the
 * compiled default, and ANY failure — table not created, RLS refusal, an
 * outage, a row that does not parse — resolves to it. The wizard is the first
 * thing a brand-new operator sees; showing them a broken or empty screen
 * because a read failed would be far worse than showing them the five questions
 * we already ship.
 *
 * Deleting that constant is also not an option for a second reason: three test
 * files read it directly (`first-run-questions.test.ts`,
 * `first-run-wizard-gate.test.tsx`, `first-run-arrival-gate.test.tsx`).
 */

/** A row as it comes back from PostgREST. Every field is treated as untrusted. */
interface QuestionRow {
  question_key: unknown;
  kind: unknown;
  prompt: unknown;
  help: unknown;
  placeholder: unknown;
  options: unknown;
  is_required: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Options, validated one at a time.
 *
 * A malformed entry is DROPPED rather than failing the whole question: an admin
 * who saves one bad option should lose that option, not the question it belongs
 * to. A `single`/`multi` question left with none is rejected by the caller,
 * because a choice with nothing to choose is a dead end.
 */
function toOptions(raw: unknown): FirstRunOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FirstRunOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (!isNonEmptyString(e.value) || !isNonEmptyString(e.label)) continue;
    out.push({
      value: e.value,
      label: e.label,
      ...(isNonEmptyString(e.hint) ? { hint: e.hint } : {}),
    });
  }
  return out;
}

/** One row to a `FirstRunQuestion`, or `null` if it cannot be rendered. */
function toQuestion(row: QuestionRow): FirstRunQuestion | null {
  if (!isNonEmptyString(row.question_key)) return null;
  if (!isNonEmptyString(row.prompt)) return null;

  const kind = row.kind;
  if (kind !== 'single' && kind !== 'multi' && kind !== 'text') return null;

  const base = {
    id: row.question_key,
    prompt: row.prompt,
    required: row.is_required !== false,
    ...(isNonEmptyString(row.help) ? { help: row.help } : {}),
  };

  if (kind === 'text') {
    return {
      ...base,
      kind: 'text',
      ...(isNonEmptyString(row.placeholder) ? { placeholder: row.placeholder } : {}),
    };
  }

  const options = toOptions(row.options);
  // A choice question with no options can never be answered, and a REQUIRED one
  // would trap the operator on that step forever. Drop it.
  if (options.length === 0) return null;

  return { ...base, kind, options };
}

export interface FirstRunQuestionsState {
  questions: readonly FirstRunQuestion[];
  /** True while the first read is in flight. The wizard waits rather than
   *  flashing the compiled list and swapping it for the authored one. */
  isLoading: boolean;
  /** True when these came from the compiled fallback rather than the database. */
  isFallback: boolean;
}

export function useFirstRunQuestions(): FirstRunQuestionsState {
  const { data, isLoading } = useQuery({
    // No tenant in the key: the set is platform-wide, so one cache entry serves
    // every tenant in this browser.
    queryKey: ['first-run-questions'],
    queryFn: async (): Promise<readonly FirstRunQuestion[] | null> => {
      const { data: rows, error } = await (supabase as any)
        .from('first_run_questions')
        .select('question_key,kind,prompt,help,placeholder,options,is_required')
        .eq('is_published', true)
        .order('sort_order', { ascending: true });

      if (error) {
        // Includes "table does not exist" until ops/first_run_questions.sql is
        // applied. Logged rather than thrown: the caller falls back, and a
        // brand-new operator must never meet an error screen here.
        console.warn(
          '[first-run] could not read first_run_questions — using the compiled ' +
            'question set.',
          error.message,
        );
        return null;
      }

      const parsed = (rows ?? [])
        .map((r: QuestionRow) => toQuestion(r))
        .filter((q: FirstRunQuestion | null): q is FirstRunQuestion => q !== null);

      // An empty table is not an instruction to ask nothing. It is far more
      // likely to be an unseeded database than a deliberate choice to skip
      // onboarding, so it falls back too.
      return parsed.length > 0 ? parsed : null;
    },
    // Authored once in a while, read on every first login. A long stale time
    // keeps this off the critical path of a new operator's first screen.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    questions: data ?? FIRST_RUN_QUESTIONS,
    isLoading,
    isFallback: !data,
  };
}
