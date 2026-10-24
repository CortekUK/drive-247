'use client';

/**
 * The home page's questions, one rounded row each: a number, the question, and
 * a round button that turns from + to × as the answer opens. The open row
 * lifts to a white card with an accent edge, so the one being read stands out.
 *
 * First the operator's own questions (`useFaqs(seed)`, live, each editable in
 * place), then `HOW_IT_WORKS` — answers that are true of booking on this site
 * for every operator (what to bring, how paying works, where the booking
 * lives), so the section is useful before an operator has written their own.
 * None of them states a policy (age, deposit, cancellation): those are the
 * operator's to write. One of ours is skipped when theirs already asks it.
 */

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { Plus } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { useFaqs } from '@nw/hooks/use-faqs';
import { Editable } from '@nw/lib/cms/editable';
import type { FaqItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';

type Question = { id: string; question: string; answer: string; own: boolean; topic?: RegExp };

const HOW_IT_WORKS: (Omit<Question, 'own'> & { topic: RegExp })[] = [
  {
    id: 'site-need',
    topic: /what (do|will) i need|bring with|documents?|licen[cs]e/i,
    question: 'What do I need to rent a car?',
    answer:
      'Your driving licence and a payment card in your name. The name on both needs to match. You add your licence online when you book, so we can check it before you arrive.',
  },
  {
    id: 'site-book',
    topic: /how (do|can) i book|booking work|make a booking/i,
    question: 'How do I book?',
    answer:
      'Choose your dates and where you want to collect the car, pick a car, add your details and any extras, then pay and sign your agreement. It all happens online, on your phone or computer.',
  },
  {
    id: 'site-price',
    topic: /price|hidden|extra (fees|charges)/i,
    question: 'Is the price I see the price I pay?',
    answer: 'Yes. Your total, with every fee in it, is on screen before you pay. Any extras you add are shown in that total too.',
  },
  {
    id: 'site-pay',
    topic: /how (do|can) i pay|payment|credit card|debit card/i,
    question: 'How do I pay?',
    answer: 'By card, online, as the last step of booking. The card needs to be in your name.',
  },
  {
    id: 'site-account',
    topic: /account|manage|my booking/i,
    question: 'Where can I see my booking?',
    answer:
      'In your account. Your booking, payments, rental agreement and your messages to us are all there, whenever you need them.',
  },
  {
    id: 'site-drop',
    topic: /return|drop.?off|different (place|location)/i,
    question: 'Can I return the car somewhere else?',
    answer:
      'When you search, choose a different drop-off place from the list. If a place is not listed, ask us before you book.',
  },
];

/** "1. How old…" → "How old…": the row numbers itself. */
const unnumbered = (text: string) => text.replace(/^\s*\d+[.)]\s*/, '');

export function HomeFaqList({ seed }: { seed: FaqItem[] | null }) {
  const { faqs, isLoading } = useFaqs(seed);

  if (isLoading) {
    return (
      <div className="space-y-2.5" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-2xl bg-pv-tint" />
        ))}
      </div>
    );
  }

  const own: Question[] = faqs.map((faq) => ({ ...faq, own: true }));
  const ours: Question[] = HOW_IT_WORKS.filter(({ topic }) => !faqs.some((faq) => topic.test(faq.question))).map(
    (item) => ({ ...item, own: false }),
  );
  const questions = [...own, ...ours];
  // Open the first question with a real answer, not one the operator left half-written.
  const opened = questions.find((item) => item.answer.trim().length >= 40)?.id ?? questions[0]?.id;

  return (
    <AccordionPrimitive.Root type="single" collapsible defaultValue={opened} data-reveal-group className="space-y-2.5">
      {questions.map((item, index) => (
        <AccordionPrimitive.Item
          key={item.id}
          value={item.id}
          className={cn(
            'group/q rounded-2xl border transition-colors duration-200 ease-out motion-reduce:transition-none',
            'border-transparent bg-pv-tint/60 hover:bg-pv-tint',
            'data-[state=open]:border-pv-primary/35 data-[state=open]:bg-pv-card data-[state=open]:ring-4 data-[state=open]:ring-pv-primary/[0.07]',
          )}
        >
          <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger className="flex min-h-16 flex-1 items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-primary/35 sm:gap-4 sm:px-4">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-lg bg-pv-card text-[12px] font-bold tabular-nums text-pv-muted-fg ring-1 ring-pv-border group-data-[state=open]/q:bg-pv-tint group-data-[state=open]/q:text-pv-primary group-data-[state=open]/q:ring-0"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-pv-fg md:text-[16px]">
                {item.own ? (
                  <Editable path={`table:faqs.${item.id}.question`}>{unnumbered(item.question)}</Editable>
                ) : (
                  item.question
                )}
              </span>
              {/* + turns into × as the answer opens. */}
              <span
                aria-hidden
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none',
                  'bg-pv-fg text-pv-bg',
                  'group-data-[state=open]/q:bg-pv-card group-data-[state=open]/q:text-pv-fg group-data-[state=open]/q:ring-1 group-data-[state=open]/q:ring-pv-border',
                )}
              >
                <Plus
                  className="size-4 transition-transform duration-200 ease-out group-data-[state=open]/q:rotate-45 motion-reduce:transition-none"
                  strokeWidth={2.25}
                />
              </span>
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=closed]:ease-in data-[state=open]:animate-accordion-down data-[state=open]:ease-out motion-reduce:animate-none">
            <div className="pb-5 pl-[calc(14px+28px+14px)] pr-14 text-[14.5px] leading-relaxed text-pv-muted-fg sm:pl-[calc(16px+28px+16px)] sm:pr-16">
              {item.own ? <Editable path={`table:faqs.${item.id}.answer`}>{item.answer}</Editable> : item.answer}
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  );
}
