'use client';

/**
 * Template 2 ("Glass") — the home page's questions, as a conversation.
 *
 *   the questions  a glass list: the operator's own (`faqs`, live), then the
 *                  site's answers every renter here can be given truthfully
 *                  (`HOW_IT_WORKS`, shared with site-v2; one is skipped when
 *                  the operator already asks it)
 *   the thread     tapping a question sends it, as your message on the right;
 *                  the operator types for a moment, then their answer lands
 *                  on the left, in a bubble of glass, under their name. The
 *                  thread keeps the last few, like a chat
 *
 * It opens with one question already answered — the first with a real answer
 * — so it reads before anyone taps. Under the thread, "Message us" goes to
 * Contact for anything not listed.
 *
 * On a desktop only the thread scrolls, never the page. On a phone the
 * questions sit under the thread, so asking one brings the thread into view.
 * Reduced motion: no typing, the answer is simply there.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, MessageCircle } from 'lucide-react-nw';

import { useTenant } from '@nw/contexts/TenantContext';
import { useFaqs } from '@nw/hooks/use-faqs';
import type { FaqItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { HOW_IT_WORKS, unnumbered, type Question } from '@nw/site-v2/sections/home-faq-list';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

/** How long the operator "types" before the answer lands. */
const TYPING_MS = 650;
/** How many exchanges the thread keeps. */
const KEEP = 4;

export function Template2Questions({ seed }: { seed: FaqItem[] | null }) {
  const { tenant } = useTenant();
  const { faqs } = useFaqs(seed);
  const name = tenant?.company_name?.trim() || tenant?.app_name?.trim() || 'Us';

  const questions = useMemo<Question[]>(() => {
    const own = faqs.map((faq) => ({ ...faq, question: unnumbered(faq.question), own: true }));
    const ours = HOW_IT_WORKS.filter(({ topic }) => !faqs.some((faq) => topic.test(faq.question))).map((item) => ({ ...item, own: false }));
    return [...own, ...ours];
  }, [faqs]);

  // The first question with a real answer, not one left half-written.
  const first = questions.find((item) => item.answer.trim().length >= 40) ?? questions[0];

  const [asked, setAsked] = useState<string[] | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const thread = asked ?? (first ? [first.id] : []);

  const panel = useRef<HTMLDivElement>(null);
  const ask = (id: string) => {
    if (thread[thread.length - 1] === id && !typing) return;
    setAsked([...thread.filter((other) => other !== id), id].slice(-KEEP));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // On a phone the thread is above the questions: bring it into view.
    const box = panel.current?.getBoundingClientRect();
    if (box && !window.matchMedia('(min-width: 1024px)').matches && box.top < 80) {
      panel.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    }
    if (!still) setTyping(id);
  };

  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => setTyping(null), TYPING_MS);
    return () => window.clearTimeout(timer);
  }, [typing, asked]);

  // Keep the newest message in view, scrolling the thread only.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: asked ? 'smooth' : 'auto' });
  }, [asked, typing]);

  if (questions.length === 0) return null;
  const byId = new Map(questions.map((item) => [item.id, item]));
  const latest = thread[thread.length - 1];

  return (
    <section aria-labelledby="g2-faq-title" className="relative lg:flex lg:min-h-svh lg:flex-col">
      <div className="mx-auto w-full max-w-[1320px] px-3 pb-10 pt-4 sm:px-5 sm:pb-16 lg:flex lg:flex-1 lg:flex-col lg:pb-5 lg:pt-[92px]">
        <div className="g2-glass flex flex-col rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:flex-1 lg:rounded-[40px] lg:p-5">
          <header className="px-2 pb-5 pt-4 text-center sm:px-3 sm:pt-5 lg:pb-4 lg:pt-2">
            <div>
              <h2 id="g2-faq-title" className="text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[40px] lg:text-[36px]">
                Ask us anything.
              </h2>
              <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px] lg:mt-1.5 lg:text-[16px]">
                Tap a question and we answer it, the way we would if you messaged us.
              </p>
            </div>
          </header>

          <div className="grid gap-3 lg:flex-1 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-4">
            {/* The questions. */}
            <div className="g2-well g2-tray relative rounded-[30px] p-2 max-lg:order-last lg:min-h-[420px]">
              <ul aria-label="Questions" className="flex flex-col gap-1 lg:absolute lg:inset-2 lg:overflow-y-auto lg:[scrollbar-width:thin]">
                {questions.map((item) => {
                  const now = item.id === latest;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => ask(item.id)}
                        aria-pressed={now}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-[20px] px-4 py-3.5 text-left text-[15px] font-medium leading-snug transition-[background-color,box-shadow,color] duration-200',
                          now
                            ? 'bg-white text-[var(--g2-ink)] shadow-[0_10px_24px_-14px_rgb(13_12_29/0.5),inset_0_1px_0_#fff]'
                            : 'text-[var(--g2-ink-soft)] hover:bg-white/55 hover:text-[var(--g2-ink)]',
                          FOCUS,
                        )}
                      >
                        <span className="min-w-0 flex-1">{item.question}</span>
                        <span
                          aria-hidden
                          className={cn(
                            'grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-200',
                            now ? 'g2-cta' : 'bg-white/70 text-[var(--g2-accent-ink)]',
                          )}
                        >
                          <ArrowUpRight className="size-4" strokeWidth={2.25} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* The thread. */}
            <div ref={panel} className="g2-well g2-tray relative flex h-[460px] scroll-mt-[84px] flex-col overflow-hidden rounded-[30px] lg:h-auto lg:min-h-[420px]">
              <div className="flex items-center gap-3 border-b border-white/50 px-5 py-3.5">
                <Avatar name={name} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-[var(--g2-ink)]">{name}</p>
                  <p className="text-[12.5px] text-[var(--g2-ink-soft)]">Answers about renting with us</p>
                </div>
              </div>

              <div ref={scroller} role="log" aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 [scrollbar-width:thin] sm:px-6">
                <p className="mx-auto mb-auto rounded-full bg-white/50 px-3 py-1 text-[12px] font-medium text-[var(--g2-ink-soft)]">
                  Questions people ask before they book
                </p>
                {thread.map((id) => {
                  const item = byId.get(id);
                  if (!item) return null;
                  const pending = typing === id;
                  return (
                    <div key={id} className="flex flex-col gap-2">
                      <p className="g2-msg-in ml-auto max-w-[78%] rounded-[22px] rounded-br-[8px] bg-[var(--g2-accent)] px-4 py-2.5 text-[15px] leading-snug text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_18px_-12px_var(--g2-accent)]">
                        {item.question}
                      </p>
                      <div className="flex max-w-[86%] items-end gap-2">
                        <Avatar name={name} small />
                        {pending ? (
                          <span aria-label={`${name} is typing`} className="g2-glass-thin flex h-10 items-center gap-1 rounded-[22px] rounded-bl-[8px] px-4">
                            <span className="g2-dot" />
                            <span className="g2-dot [animation-delay:150ms]" />
                            <span className="g2-dot [animation-delay:300ms]" />
                          </span>
                        ) : (
                          <p className="g2-glass-thin g2-msg-in rounded-[22px] rounded-bl-[8px] px-4 py-3 text-[15px] leading-relaxed text-[var(--g2-ink)]">
                            {item.answer}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-2.5 border-t border-white/50 px-5 py-3.5 text-[13.5px] text-[var(--g2-ink-soft)]">
                <MessageCircle aria-hidden className="size-4 shrink-0 text-[var(--g2-accent-ink)]" strokeWidth={2} />
                <span>
                  Something else?{' '}
                  <Link href="/contact" className={cn('rounded font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}>
                    Message us
                  </Link>{' '}
                  and we will get back to you.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The operator's initial: a logo is too wide to read at this size. */
function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'g2-cta grid shrink-0 place-items-center rounded-full font-semibold',
        small ? 'size-7 text-[12px]' : 'size-10 text-[15px]',
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
