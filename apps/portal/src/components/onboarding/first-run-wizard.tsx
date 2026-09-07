'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react';

import { cn } from '@/lib/utils';
import {
  FIRST_RUN_QUESTIONS,
  isAnswered,
  type FirstRunAnswer,
  type FirstRunAnswers,
  type FirstRunQuestion,
} from '@/lib/first-run-questions';
import { armArrival, celebrateArrival, disarmArrival } from '@/lib/first-run-arrival';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';

/**
 * First-run onboarding wizard — full screen, canary only, shown exactly once.
 *
 * Step 5 of the signup flow: landing → account → pay → "Go to portal" → HERE →
 * dashboard. A handful of questions, then the operator is dropped into the app
 * and never sees this again, because finishing (or skipping) writes the
 * `tenant_first_run` row that `useFirstRunWizard` looks for.
 *
 * WHAT IT RENDERS IS NOT IN THIS FILE. Every question comes from
 * `lib/first-run-questions.ts`; this component only knows how to draw the three
 * question KINDS. Swapping the questions is an edit to that array.
 *
 *
 * THE DESIGN — no card, one question, liquid between them.
 * =======================================================
 * There is deliberately NO panel, border, shadow or container anywhere on this
 * screen. The question sits directly on the app's own wash (`.bg-app-gradient`,
 * which is brand-derived, so it is the tenant's colour and not a second
 * palette), left-aligned, at display size. Everything that is not the question
 * recedes: the progress is five hairlines, the helper line is one muted
 * sentence, and the actions are three items of 14px text in the bottom corner.
 *
 * Left-aligned rather than centred, on purpose. A centred block on an empty
 * field re-reads as a card whose edges you cannot see; ranging it left with the
 * answers hanging off the same axis is what makes it look like a page rather
 * than a dialog, and it lets the free-text question be a bare rule under the
 * cursor instead of a field in a box.
 *
 * THE TRANSITION IS A GHOST, NOT AN <AnimatePresence>.
 * ---------------------------------------------------
 * The outgoing question flows out and the incoming one flows in, which needs
 * both on screen at once. `AnimatePresence` is the obvious tool and is the
 * wrong one here, twice over:
 *
 *  - `mode="wait"` holds the NEXT question unmounted until the exit finishes.
 *    Anything driving this screen without a real compositor — the test suite,
 *    or a browser that never fires the callback — is then stuck on a step that
 *    has already been answered.
 *  - `mode="sync"` keeps the outgoing question's real radios in the DOM, ahead
 *    of the incoming ones, wired to a stale render's closures. "The first
 *    option on screen" stops meaning the current question's first option.
 *
 * So the outgoing question is re-rendered as a GHOST: the same type at the same
 * size, but as inert text — `aria-hidden`, no roles, no handlers, no focus
 * stops. Exactly one interactive question exists at any moment, the next one
 * mounts synchronously, and the flow-out is real rather than a cross-fade of
 * two live forms. The two share one CSS grid cell so neither is positioned
 * absolutely and neither can add to the scroll height.
 *
 * The ghost is retired by a TIMER rather than an animation callback, because a
 * callback that never fires would leave stale text painted over the live
 * question forever.
 *
 * THE ARRIVAL IS A DETACHED VEIL.
 * -------------------------------
 * Saving flips `shouldShow`, which unmounts this component — the row is the one
 * source of truth and nothing here may delay it (the tour is queued behind
 * "the wizard let go"). So the arrival cannot be an exit animation on this
 * tree. Instead, finishing paints one non-interactive veil onto <body> in the
 * same wash this screen was already wearing, and fades it out over ~0.4s. The
 * wizard is genuinely gone the instant it says it is; what dissolves is a
 * 400ms sheet of colour the operator can already click straight through.
 *
 * WHY A PLAIN OVERLAY AND NOT `<Dialog>`. The other blocking surfaces here
 * split two ways: `SubscriptionGateDialog` is a Radix dialog because it is a
 * modal-sized card, and `TenantSuspendedScreen` is a bare `fixed inset-0`
 * because it owns the whole viewport. This is the second kind — it needs the
 * full bleed, and it has no business fighting Radix's scroll-lock and portal
 * for a screen that covers everything anyway.
 *
 * SUPPRESSION. The caller passes `suppressed` while the subscription paywall
 * owns the screen, exactly as `FeedbackForcePrompt` and `WelcomePackPrompt` do.
 * Two non-dismissible full-screen surfaces stacked on each other leave the
 * operator unable to act on either.
 */

/** How long the outgoing question takes to flow away, in ms. */
const GHOST_MS = 520;
const GHOST_MS_REDUCED = 140;

/* Type treatment, shared by the live question and its ghost so the two are the
   same object mid-flight. Manrope (`font-heading`) at display size, tight
   leading, optically negative tracking — the question is the only loud thing
   on the screen. */
const PROMPT_CLASS =
  'font-heading text-[clamp(2rem,5.2vw,3.5rem)] font-medium leading-[1.04] tracking-[-0.032em] text-foreground';
const HELP_CLASS =
  'max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground';
const OPTION_LABEL_CLASS = 'font-heading text-[17px] leading-snug sm:text-lg';
const OPTION_ROW_CLASS = 'flex items-center gap-3.5 py-2 pl-1 pr-4 text-left';

export function FirstRunWizard({ suppressed = false }: { suppressed?: boolean }) {
  const { shouldShow, save } = useFirstRunWizard();
  const reduced = !!useReducedMotion();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FirstRunAnswers>({});
  const [finishing, setFinishing] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Which way the questions are flowing: 1 forward, -1 back. */
  const [dir, setDir] = useState(1);
  /** The question that just left, painted as inert text while it flows away. */
  const [ghost, setGhost] = useState<{
    question: FirstRunQuestion;
    answer: FirstRunAnswer | undefined;
    dir: number;
    token: number;
  } | null>(null);

  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();

  const questions = FIRST_RUN_QUESTIONS;
  const total = questions.length;
  const question = questions[step];

  const canAdvance = useMemo(
    () => (question ? isAnswered(question, answers[question.id]) : false),
    [question, answers],
  );

  useEffect(() => () => {
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
  }, []);

  // Move focus onto this screen at every step, so a keyboard operator is
  // working the wizard and not the dashboard still sitting behind it.
  //
  // A free-text question takes the caret, because that is where the answer
  // goes. A CHOICE question deliberately does NOT take focus onto its first
  // option: Chrome treats a programmatic focus as `:focus-visible`, so the
  // screen would open with a ring drawn around option one — a rounded outline
  // that reads as exactly the pill-in-a-box this design exists to remove, on
  // an option nobody has picked. Focus lands on the dialog instead, which is
  // silent and leaves the first Tab where it should be.
  useEffect(() => {
    if (!shouldShow || suppressed) return;
    const input = stageRef.current?.querySelector<HTMLElement>('input[type="text"]');
    (input ?? rootRef.current)?.focus();
  }, [step, shouldShow, suppressed]);

  // Hooks above this line, always. `shouldShow` flips as the query resolves.
  if (!shouldShow || suppressed || total === 0 || !question) return null;

  const isLast = step === total - 1;
  const headingId = `${baseId}-prompt`;
  const helpId = `${baseId}-help`;
  const busy = finishing || departing;

  const setAnswer = (value: FirstRunAnswer) =>
    setAnswers((prev) => ({ ...prev, [question.id]: value }));

  const toggleMulti = (value: string) => {
    const current = answers[question.id];
    const list = Array.isArray(current) ? current : [];
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    setAnswers((prev) => {
      // An empty multi-select is "not answered", not "answered with nothing" —
      // drop the key so the progress hairlines and `isAnswered` agree.
      if (next.length === 0) {
        const { [question.id]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [question.id]: next };
    });
  };

  /** Send the current question on its way, as inert text, in `direction`. */
  const shed = (direction: number) => {
    setGhost({
      question,
      answer: answers[question.id],
      dir: direction,
      token: Date.now(),
    });
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(
      () => setGhost(null),
      reduced ? GHOST_MS_REDUCED : GHOST_MS,
    );
  };

  const goTo = (next: number, direction: number) => {
    shed(direction);
    setDir(direction);
    setStep(next);
  };

  const advance = () => {
    if (busy || !canAdvance) return;
    if (isLast) {
      void finish(false);
      return;
    }
    goTo(Math.min(total - 1, step + 1), 1);
  };

  const goBack = () => {
    if (busy || step === 0) return;
    goTo(Math.max(0, step - 1), -1);
  };

  const finish = async (skipped: boolean) => {
    // Re-entry guard. The buttons stay clickable while the write is in flight
    // (they are mid-fade, and dimming them to the disabled treatment reads as a
    // glitch rather than as progress), so the second click is stopped here.
    if (busy) return;
    // The content starts leaving straight away rather than after the round
    // trip: the write takes network time, and a screen that sits perfectly
    // still through it reads as a dropped click.
    setDeparting(true);
    setFinishing(true);
    setFailed(false);
    // Arm the celebration BEFORE the write, not after it.
    //
    // `save.mutateAsync` invalidates the query that feeds `shouldShow`, so
    // `wizardPending` can flip false while we are still inside this await —
    // and the walkthrough's autostart effect fires the moment it does. If the
    // arrival has not been armed by then, that effect reads a hold of zero and
    // schedules the Welcome card for ~700ms, which is how the card ended up on
    // screen with confetti still falling around it.
    //
    // Arming is not drawing: nothing appears here. It only tells the tour that
    // a burst is coming, so it waits the full run out. `celebrateArrival`
    // below still does the drawing, and still only after the row is safely
    // written — a failed write gets the error state and no celebration.
    armArrival();
    try {
      await save.mutateAsync({ answers, skipped });
      // No local "done" state: the row now exists, the query is invalidated,
      // `shouldShow` goes false and this unmounts. One source of truth. The
      // veil below outlives that unmount and carries the arrival.
      dissolveIntoDashboard(reduced);
      // …and the celebration rides on top of it: a scatter of confetti,
      // detached from React for the same reason the veil is, latched to fire
      // exactly once, nothing at all under `prefers-reduced-motion`, and over
      // before the walkthrough's first card comes up. No sound — see the note
      // at the top of `lib/first-run-arrival.ts`.
      celebrateArrival(reduced);
    } catch {
      // The celebration was promised before the write and the write did not
      // land, so take the promise back — otherwise the walkthrough waits out a
      // burst that is never drawn. See `armArrival`.
      disarmArrival();
      // Never trap the operator behind a wizard whose write failed. Say so,
      // bring the question back, and leave both buttons live so they can retry
      // — and note that even a total failure here is recoverable, because the
      // wizard simply asks again next load rather than losing anything.
      setFailed(true);
      setDeparting(false);
    } finally {
      setFinishing(false);
    }
  };

  /**
   * Enter advances; Tab stays inside.
   *
   * Enter is handled once, here, rather than per control. Preventing the
   * default during the bubble phase also cancels the click the browser would
   * otherwise synthesise on a focused option — so Enter on a radio moves on
   * instead of re-picking it, while Space still selects. The action buttons opt
   * out via `data-wizard-action` so their own click is not double-counted.
   */
  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;

    if (e.key === 'Tab') {
      // `aria-modal="true"` is a promise that the rest of the page is inert,
      // and the dashboard behind this is still perfectly tabbable. Keep it.
      const stops = rootRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!stops || stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!e.shiftKey && target === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && target === first) {
        e.preventDefault();
        last.focus();
      }
      return;
    }

    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (target?.closest('[data-wizard-action]')) return;
    e.preventDefault();
    advance();
  };

  return (
    <div
      ref={rootRef}
      data-first-run-wizard=""
      role="dialog"
      aria-modal="true"
      aria-label="Set up your account"
      onKeyDown={onRootKeyDown}
      tabIndex={-1}
      className="fixed inset-0 z-[70] overflow-y-auto bg-background bg-app-gradient outline-none"
    >
      <LiquidWash step={step} reduced={reduced} />

      <div className="relative mx-auto flex min-h-full w-full max-w-[64rem] flex-col px-6 pb-10 pt-14 sm:px-10 sm:pt-20 lg:px-16">
        {/* One grid cell, two occupants: the question that is leaving and the
            one that has arrived. Neither is absolutely positioned, so neither
            can push the scroll height around mid-flight. */}
        <div className="flex flex-1 items-start pt-[10vh]">
          <div className="grid w-full">
            {ghost ? (
              <GhostQuestion key={ghost.token} ghost={ghost} reduced={reduced} />
            ) : null}

            <motion.div
              key={question.id}
              ref={stageRef}
              custom={dir}
              variants={stageVariants(reduced)}
              initial="hidden"
              animate={departing ? 'leaving' : 'shown'}
              className="col-start-1 row-start-1 flex flex-col gap-6"
            >
              <motion.h1
                id={headingId}
                variants={riseVariants(reduced)}
                className={PROMPT_CLASS}
              >
                {question.prompt}
              </motion.h1>

              {question.help ? (
                <motion.p
                  id={helpId}
                  variants={riseVariants(reduced)}
                  className={cn(HELP_CLASS, '-mt-2')}
                >
                  {question.help}
                </motion.p>
              ) : null}

              <QuestionField
                question={question}
                answer={answers[question.id]}
                headingId={headingId}
                helpId={question.help ? helpId : undefined}
                reduced={reduced}
                onSelect={setAnswer}
                onToggle={toggleMulti}
              />
            </motion.div>
          </div>
        </div>

        {failed ? (
          <p role="alert" className="pb-4 text-sm text-destructive">
            We couldn&apos;t save your answers just then. Please try again — nothing
            has been lost.
          </p>
        ) : null}

        {/* Actions and progress, both at 14px and both a long way down the
            page. This row is the whole of the chrome. It leaves with the
            question rather than being cut off mid-stride when the row is
            written and this component unmounts. */}
        <motion.div
          animate={{ opacity: departing ? 0 : 1 }}
          transition={{ duration: departing ? 0.26 : 0.2, ease: 'easeOut' }}
          className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 pt-6"
        >
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={step + 1}
            aria-label={`Question ${step + 1} of ${total}`}
            className="flex items-center gap-1.5"
          >
            {questions.map((q, i) => (
              <span
                key={q.id}
                aria-hidden
                className={cn(
                  'h-[3px] rounded-full transition-all duration-500 ease-out',
                  i === step
                    ? 'w-9 bg-primary'
                    : q.id in answers
                      ? 'w-5 bg-primary/40'
                      : 'w-5 bg-foreground/[0.12]',
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-6">
            {step > 0 ? (
              <button
                type="button"
                data-wizard-action=""
                onClick={goBack}
                className="rounded-full text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-40"
              >
                Back
              </button>
            ) : null}

            <button
              type="button"
              data-wizard-action=""
              onClick={() => void finish(true)}
              className="rounded-full text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-40"
            >
              Skip for now
            </button>

            <button
              type="button"
              data-wizard-action=""
              onClick={advance}
              disabled={!canAdvance}
              aria-busy={finishing || undefined}
              className={cn(
                // The accent, not ink. This is the only forward action on the
                // screen, and a black pill made it read as a neutral chrome
                // button sitting next to "Skip for now" rather than as the way
                // on. `bg-primary` also means it follows the tenant's own
                // accent instead of hardcoding indigo.
                'h-11 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground outline-none transition-all',
                'hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/30 active:translate-y-px',
                'disabled:pointer-events-none disabled:bg-primary/25 disabled:text-primary-foreground/70',
              )}
            >
              {isLast ? 'Go to my dashboard' : 'Continue'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ── Motion ───────────────────────────────────────────────────────────────
 *
 * Water rather than a slide: the block resolves out of a blur while its lines
 * rise into place one after another on a spring with a little overshoot, and
 * the wash behind it drifts on a much slower spring so it is still settling
 * after the type has stopped. That lag is the whole effect.
 *
 * `prefers-reduced-motion` collapses all of it to a 0.14s opacity fade. Not
 * nothing — the operator still sees that something changed — and not the
 * liquid, which is exactly what that preference is asking us not to do.
 */

const RISE_SPRING: Transition = {
  type: 'spring',
  stiffness: 150,
  damping: 17,
  mass: 0.85,
};

const stageVariants = (reduced: boolean): Variants =>
  reduced
    ? {
        hidden: { opacity: 0 },
        shown: { opacity: 1, transition: { duration: 0.14 } },
        leaving: { opacity: 0, transition: { duration: 0.14 } },
      }
    : {
        hidden: { opacity: 0, filter: 'blur(14px)' },
        shown: {
          opacity: 1,
          filter: 'blur(0px)',
          transition: {
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
            delayChildren: 0.05,
            staggerChildren: 0.055,
          },
        },
        leaving: {
          opacity: 0,
          y: -14,
          filter: 'blur(16px)',
          transition: { duration: 0.32, ease: [0.4, 0, 1, 1] },
        },
      };

const riseVariants = (reduced: boolean): Variants =>
  reduced
    ? { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.14 } } }
    : {
        hidden: (d: number) => ({ opacity: 0, y: 26 * (d ?? 1) }),
        shown: { opacity: 1, y: 0, transition: RISE_SPRING },
      };

/** The options list rises as a group, then staggers its own rows. */
const groupVariants = (reduced: boolean): Variants =>
  reduced
    ? { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.14 } } }
    : {
        hidden: { opacity: 0 },
        shown: { opacity: 1, transition: { staggerChildren: 0.042 } },
      };

/**
 * Two very large, very soft brand-coloured shapes that drift a little on each
 * step and take about a second and a half to stop. They are the only thing on
 * the screen that moves without being asked to, and they only move when the
 * operator has just done something.
 *
 * Colours come from `--primary` and `--chart-3`, the same two the app wash
 * uses, so a tenant on green never gets a purple corner.
 */
function LiquidWash({ step, reduced }: { step: number; reduced: boolean }) {
  if (reduced) return null;
  const drift: Transition = { type: 'spring', stiffness: 26, damping: 24, mass: 1.6 };
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <motion.div
        className="absolute -right-40 -top-48 size-[46rem] rounded-full blur-[120px]"
        style={{ backgroundColor: 'hsl(var(--primary) / 0.10)' }}
        animate={{
          x: Math.sin(step * 1.3) * 70,
          y: Math.cos(step * 0.9) * 54,
          scale: 1 + Math.sin(step * 0.7) * 0.07,
        }}
        transition={drift}
      />
      <motion.div
        className="absolute -bottom-56 -left-48 size-[42rem] rounded-full blur-[130px]"
        style={{ backgroundColor: 'hsl(var(--chart-3) / 0.09)' }}
        animate={{
          x: Math.cos(step * 1.1) * 60,
          y: Math.sin(step * 1.4) * 48,
          scale: 1 + Math.cos(step * 0.8) * 0.06,
        }}
        transition={drift}
      />
    </div>
  );
}

/**
 * The question that has just left, as inert text.
 *
 * Deliberately NOT the real `QuestionField`: no roles, no handlers, no focus
 * stops, `aria-hidden`. It is a picture of the previous step, not a second copy
 * of the form — see the header note for why that distinction is load-bearing.
 */
function GhostQuestion({
  ghost,
  reduced,
}: {
  ghost: {
    question: FirstRunQuestion;
    answer: FirstRunAnswer | undefined;
    dir: number;
  };
  reduced: boolean;
}) {
  const { question, answer, dir } = ghost;
  const chosen = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : [];

  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      animate={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, y: -34 * dir, filter: 'blur(18px)', scale: 0.985 }
      }
      transition={
        reduced
          ? { duration: 0.12 }
          : { duration: GHOST_MS / 1000, ease: [0.4, 0, 0.2, 1] }
      }
      className="col-start-1 row-start-1 flex select-none flex-col gap-6"
      style={{ pointerEvents: 'none' }}
    >
      <p className={PROMPT_CLASS}>{question.prompt}</p>
      {question.help ? <p className={cn(HELP_CLASS, '-mt-2')}>{question.help}</p> : null}

      {question.kind === 'text' ? (
        <div className="max-w-[34rem]">
          <p
            className={cn(
              'font-heading text-2xl tracking-tight sm:text-3xl',
              typeof answer === 'string' && answer ? 'text-foreground' : 'text-foreground/25',
            )}
          >
            {typeof answer === 'string' && answer ? answer : question.placeholder}
          </p>
          <span className="mt-3 block h-px w-full bg-foreground/15" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1">
          {question.options.map((option) => {
            const isOn = chosen.includes(option.value);
            return (
              <span key={option.value} className={OPTION_ROW_CLASS}>
                <span className="relative flex size-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'size-[10px]',
                      question.kind === 'multi' ? 'rounded-[3px]' : 'rounded-full',
                      isOn ? 'bg-primary' : 'ring-1 ring-foreground/30',
                    )}
                  />
                </span>
                <span
                  className={cn(
                    OPTION_LABEL_CLASS,
                    isOn ? 'font-medium text-foreground' : 'text-foreground/60',
                  )}
                >
                  {option.label}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Draws one question's answer. The only place that knows about the three kinds.
 *
 * Choices are a plain left-aligned stack — no pill, no border, no grid, nothing
 * that would put a box back on a screen whose entire point is not having one.
 * The affordance is a small dot in the gutter that GLIDES between the options
 * as the selection moves (`layoutId`), which is the one piece of decoration on
 * the screen and the only accent the primary colour is spent on.
 */
function QuestionField({
  question,
  answer,
  headingId,
  helpId,
  reduced,
  onSelect,
  onToggle,
}: {
  question: FirstRunQuestion;
  answer: FirstRunAnswer | undefined;
  headingId: string;
  helpId: string | undefined;
  reduced: boolean;
  onSelect: (value: FirstRunAnswer) => void;
  onToggle: (value: string) => void;
}) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  if (question.kind === 'text') {
    return (
      <motion.div variants={riseVariants(reduced)} className="relative max-w-[34rem] pt-1">
        <input
          type="text"
          autoFocus
          autoComplete="off"
          value={typeof answer === 'string' ? answer : ''}
          placeholder={question.placeholder}
          aria-labelledby={headingId}
          aria-describedby={helpId}
          onChange={(e) => onSelect(e.target.value)}
          className={cn(
            'peer w-full border-0 bg-transparent px-0 pb-3 font-heading text-2xl font-normal tracking-tight sm:text-3xl',
            'text-foreground caret-primary outline-none placeholder:text-foreground/25',
          )}
        />
        {/* The rule IS the field, and its accent half IS the focus indicator —
            there is no box to outline. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-foreground/15" />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-primary transition-transform duration-500 ease-out peer-focus:scale-x-100 motion-reduce:transition-none"
        />
      </motion.div>
    );
  }

  const selected = Array.isArray(answer)
    ? answer
    : typeof answer === 'string'
      ? [answer]
      : [];
  const multi = question.kind === 'multi';
  const firstSelected = question.options.findIndex((o) => selected.includes(o.value));

  /**
   * Arrow keys move the selection, the way a radio group is supposed to.
   * Combined with the roving tabindex below, the whole group is one tab stop.
   */
  const onGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (multi) return;
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !backward) return;
    e.preventDefault();

    const count = question.options.length;
    const next =
      firstSelected < 0
        ? forward
          ? 0
          : count - 1
        : (firstSelected + (forward ? 1 : -1) + count) % count;

    onSelect(question.options[next].value);
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <motion.div
      ref={groupRef}
      variants={groupVariants(reduced)}
      role={multi ? 'group' : 'radiogroup'}
      aria-labelledby={headingId}
      aria-describedby={helpId}
      onKeyDown={onGroupKeyDown}
      className="flex flex-col items-start gap-1 pt-1"
    >
      {question.options.map((option, i) => {
        const isOn = selected.includes(option.value);
        // Roving tabindex: one stop for the whole group, landing on the
        // current choice — or the first option when nothing is chosen yet.
        const tabbable = multi || (firstSelected < 0 ? i === 0 : isOn);
        return (
          <motion.button
            key={option.value}
            variants={riseVariants(reduced)}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isOn}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => (multi ? onToggle(option.value) : onSelect(option.value))}
            className={cn(
              OPTION_ROW_CLASS,
              'group/opt -ml-1 rounded-full outline-none transition-colors',
              'focus-visible:ring-3 focus-visible:ring-ring/30',
              // Chosen rows carry a light wash of the accent rather than a
              // neutral outline. The tint has to stay light: the label sits on
              // top of it, and this is the one place on the screen where colour
              // means "this is your answer" rather than decoration.
              isOn
                ? 'bg-primary/[0.08] ring-1 ring-primary/25'
                : 'hover:bg-foreground/[0.03]',
            )}
          >
            <span
              aria-hidden
              className="relative flex size-5 shrink-0 items-center justify-center"
            >
              <span
                className={cn(
                  'size-[10px] ring-1 transition-colors',
                  multi ? 'rounded-[3px]' : 'rounded-full',
                  isOn
                    ? 'ring-transparent'
                    : 'ring-foreground/30 group-hover/opt:ring-foreground/55',
                )}
              />
              {isOn ? (
                multi ? (
                  <span className="absolute flex size-[15px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                ) : (
                  <motion.span
                    layoutId={reduced ? undefined : `first-run-marker-${question.id}`}
                    className="absolute size-[10px] rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                  />
                )
              ) : null}
            </span>

            <span
              className={cn(
                OPTION_LABEL_CLASS,
                'transition-colors',
                isOn
                  ? 'font-medium text-foreground'
                  : 'text-foreground/60 group-hover/opt:text-foreground/90',
              )}
            >
              {option.label}
            </span>

            {option.hint ? (
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            ) : null}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

/**
 * The arrival: one sheet of the same wash, fading off the dashboard.
 *
 * Detached from React on purpose — see the header note. Saving unmounts this
 * component immediately (the tour is queued behind that, and the row is the
 * only source of truth), so the dissolve has to outlive the tree. The veil is
 * `pointer-events: none` from the first frame, so the operator is working in
 * the dashboard while it is still fading.
 *
 * Deliberately short and deliberately dull: ~0.4s of one property. Anything
 * more turns a threshold into an event.
 */
function dissolveIntoDashboard(reduced: boolean) {
  if (typeof document === 'undefined') return;

  const veil = document.createElement('div');
  veil.setAttribute('aria-hidden', 'true');
  veil.setAttribute('data-first-run-arrival', '');
  // z-index one below the wizard's own, so it slips in underneath as that goes.
  veil.style.cssText = 'position:fixed;inset:0;z-index:69;pointer-events:none;';
  veil.className = 'bg-background bg-app-gradient';
  document.body.appendChild(veil);

  const done = () => veil.remove();

  // No Web Animations (jsdom, very old browsers) or reduced motion: take the
  // veil straight back off rather than leaving a sheet of colour on the app.
  if (reduced || typeof veil.animate !== 'function') {
    setTimeout(done, reduced ? 120 : 0);
    return;
  }

  const anim = veil.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 420,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'forwards',
  });
  anim.onfinish = done;
  anim.oncancel = done;
}
