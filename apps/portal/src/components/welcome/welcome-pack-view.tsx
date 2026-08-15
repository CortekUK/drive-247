'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, HelpCircle, Printer, Search, X,
} from 'lucide-react';
import {
  useWelcomePack,
  useWelcomePackProgress,
  type WelcomePackChapter,
  type WelcomePackFaq,
  type WelcomePackSection,
} from '@/hooks/use-welcome-pack';
import { WelcomeIcon } from './welcome-icon';
import { WelcomeMarkdown } from './welcome-markdown';

/* -------------------------------------------------------------------------- */

/**
 * A section marks itself read once it has actually been on screen — not when
 * its chapter is opened. Progress that ticks up for pages you scrolled straight
 * past makes the readership figures in the admin panel meaningless, which is
 * the whole point of collecting them.
 */
function SectionArticle({
  section,
  read,
  onRead,
}: {
  section: WelcomePackSection;
  read: boolean;
  onRead: (id: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const firedRef = useRef(read);

  useEffect(() => {
    if (firedRef.current) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true;
            onRead(section.id);
            observer.disconnect();
          }
        }
      },
      // Generous threshold: a long section can never be 50% visible on a
      // laptop, so the heading crossing into view is the signal.
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [section.id, onRead]);

  return (
    <article
      ref={ref}
      id={`section-${section.slug}`}
      className="scroll-mt-24 rounded-xl border bg-card p-5 sm:p-7"
    >
      <header className="mb-5 flex items-start gap-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <WelcomeIcon name={section.icon} className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug text-foreground">
            {section.title}
          </h2>
          {section.summary && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {section.summary}
            </p>
          )}
        </div>
        {read && (
          <span
            className="mt-1 shrink-0 text-green-600 dark:text-green-500"
            title="You have read this"
          >
            <CheckCircle2 className="h-4 w-4" />
          </span>
        )}
      </header>

      <WelcomeMarkdown>{section.body_md}</WelcomeMarkdown>
    </article>
  );
}

/* -------------------------------------------------------------------------- */

function FaqList({ faqs, title }: { faqs: WelcomePackFaq[]; title?: string }) {
  if (faqs.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-5 sm:p-7">
      <header className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HelpCircle className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold text-foreground">
            {title ?? 'Common questions'}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {faqs.length} question{faqs.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <Accordion type="multiple" className="w-full">
        {faqs.map((faq) => (
          <AccordionItem key={faq.id} value={faq.id}>
            <AccordionTrigger className="text-left text-[14px] font-medium hover:no-underline">
              {faq.question}
            </AccordionTrigger>
            <AccordionContent>
              <WelcomeMarkdown>{faq.answer_md}</WelcomeMarkdown>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function WelcomePackView() {
  const { settings, chapters, allSections, allFaqs, isLoading, isError } =
    useWelcomePack();
  const { readSectionIds, isRead, completion, markRead, markComplete } =
    useWelcomePackProgress();

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [printing, setPrinting] = useState(false);
  const scrollTargetRef = useRef<HTMLDivElement | null>(null);

  // Deep links: /welcome#section-your-first-week opens the owning chapter.
  useEffect(() => {
    if (activeKey || chapters.length === 0) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const slug = hash.startsWith('#section-') ? hash.slice('#section-'.length) : null;
    const owning = slug
      ? chapters.find((c) => c.sections.some((s) => s.slug === slug))
      : null;
    setActiveKey(owning?.key ?? chapters[0].key);
  }, [chapters, activeKey]);

  const activeChapter: WelcomePackChapter | null = useMemo(
    () => chapters.find((c) => c.key === activeKey) ?? chapters[0] ?? null,
    [chapters, activeKey]
  );

  const activeIndex = activeChapter
    ? chapters.findIndex((c) => c.key === activeChapter.key)
    : -1;

  const totalSections = allSections.length;
  const readCount = allSections.filter((s) => readSectionIds.includes(s.id)).length;
  const progressPercent =
    totalSections === 0 ? 0 : Math.round((readCount / totalSections) * 100);
  const everythingRead = totalSections > 0 && readCount === totalSections;

  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length >= 2;

  const results = useMemo(() => {
    if (!searching) return { sections: [], faqs: [] };
    const match = (t: string) => t.toLowerCase().includes(trimmed);
    return {
      sections: allSections.filter(
        (s) => match(s.title) || match(s.summary ?? '') || match(s.body_md)
      ),
      faqs: allFaqs.filter((f) => match(f.question) || match(f.answer_md)),
    };
  }, [searching, trimmed, allSections, allFaqs]);

  const goToChapter = (key: string) => {
    setActiveKey(key);
    setQuery('');
    requestAnimationFrame(() => {
      scrollTargetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const jumpToSection = (slug: string) => {
    const owning = chapters.find((c) => c.sections.some((s) => s.slug === slug));
    if (owning) setActiveKey(owning.key);
    setQuery('');
    requestAnimationFrame(() => {
      document
        .getElementById(`section-${slug}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // The flat copy must exist in the DOM BEFORE print() fires, and print()
  // blocks the main thread — so this runs from an effect on the committed
  // render, not from the click handler where the markup would not exist yet.
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  /* ------------------------------------------------------------- states */

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[268px_1fr]">
          <Skeleton className="h-96 w-full rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || chapters.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <h2 className="text-base font-semibold text-foreground">
          Your welcome pack isn&apos;t ready yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          There&apos;s nothing published here at the moment. If you were expecting a
          guide, let us know with the Send Feedback button and we&apos;ll sort it out.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      {/* ----------------------------------------------------------- header */}
      <header className="rounded-xl border bg-card p-5 sm:p-7 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              Welcome pack
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {settings?.doc_title ?? 'Welcome'}
            </h1>
            {settings?.doc_subtitle && (
              <p className="mt-1.5 max-w-2xl text-[14px] text-muted-foreground">
                {settings.doc_subtitle}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrinting(true)}
            className="shrink-0 print:hidden"
          >
            <Printer className="mr-2 h-3.5 w-3.5" />
            Print
          </Button>
        </div>

        {settings?.intro_md && (
          <div className="mt-5 border-t pt-5">
            <WelcomeMarkdown>{settings.intro_md}</WelcomeMarkdown>
          </div>
        )}

        <div className="mt-6 print:hidden">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-medium text-foreground">Your progress</span>
            <span className="tabular-nums text-muted-foreground">
              {readCount} of {totalSections} read
            </span>
          </div>
          <Progress value={progressPercent} className="h-1.5" />

          {everythingRead && !completion && settings && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-green-600/25 bg-green-50 px-4 py-3 dark:bg-green-950/25">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
              <p className="min-w-0 flex-1 text-[13px] text-foreground">
                You&apos;ve been through the whole thing. Nice work.
              </p>
              <Button
                size="sm"
                onClick={() => markComplete.mutate(settings.version)}
                disabled={markComplete.isPending}
              >
                Mark as complete
              </Button>
            </div>
          )}

          {completion && (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
              Completed on{' '}
              {new Date(completion.completed_at).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------- body */}
      <div
        ref={scrollTargetRef}
        className="grid gap-6 lg:grid-cols-[268px_1fr] print:hidden"
      >
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border bg-card p-3">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the guide..."
                className="h-9 pl-8 pr-8 text-[13px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <nav className="space-y-0.5">
              {chapters.map((chapter) => {
                const chapterRead = chapter.sections.filter((s) =>
                  readSectionIds.includes(s.id)
                ).length;
                const done =
                  chapter.sections.length > 0 &&
                  chapterRead === chapter.sections.length;
                const active = !searching && chapter.key === activeChapter?.key;

                return (
                  <button
                    key={chapter.key}
                    type="button"
                    onClick={() => goToChapter(chapter.key)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <WelcomeIcon
                      name={chapter.icon}
                      className={`h-4 w-4 shrink-0 ${
                        active ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {chapter.title}
                    </span>
                    {done ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500" />
                    ) : (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {chapterRead}/{chapter.sections.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {searching ? (
            <>
              <div className="flex items-center justify-between rounded-xl border bg-card px-5 py-3.5">
                <p className="text-[13px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {results.sections.length + results.faqs.length}
                  </span>{' '}
                  result
                  {results.sections.length + results.faqs.length === 1 ? '' : 's'} for
                  &ldquo;{query.trim()}&rdquo;
                </p>
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  Clear
                </Button>
              </div>

              {results.sections.length === 0 && results.faqs.length === 0 && (
                <div className="rounded-xl border bg-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nothing matches that. Try a different word — or ask us directly
                    with the Send Feedback button.
                  </p>
                </div>
              )}

              {results.sections.length > 0 && (
                <div className="rounded-xl border bg-card p-3">
                  <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Pages
                  </p>
                  <div className="space-y-0.5">
                    {results.sections.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => jumpToSection(s.slug)}
                        className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-muted"
                      >
                        <WelcomeIcon
                          name={s.icon}
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-foreground">
                            {s.title}
                          </span>
                          {s.summary && (
                            <span className="block truncate text-[12.5px] text-muted-foreground">
                              {s.summary}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.faqs.length > 0 && (
                <FaqList faqs={results.faqs} title="Matching questions" />
              )}
            </>
          ) : (
            activeChapter && (
              <>
                <div className="rounded-xl border bg-card px-5 py-4 sm:px-7">
                  <div className="flex items-center gap-3">
                    <WelcomeIcon
                      name={activeChapter.icon}
                      className="h-5 w-5 shrink-0 text-primary"
                    />
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-semibold text-foreground">
                        {activeChapter.title}
                      </h2>
                      {activeChapter.description && (
                        <p className="text-[13px] text-muted-foreground">
                          {activeChapter.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {activeChapter.sections.map((section) => (
                  <SectionArticle
                    key={section.id}
                    section={section}
                    read={isRead(section.id)}
                    onRead={(id) => markRead.mutate(id)}
                  />
                ))}

                <FaqList faqs={activeChapter.faqs} />

                <nav className="flex items-center justify-between gap-3 pt-1">
                  {activeIndex > 0 ? (
                    <Button
                      variant="outline"
                      onClick={() => goToChapter(chapters[activeIndex - 1].key)}
                      className="min-w-0"
                    >
                      <ArrowLeft className="mr-2 h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {chapters[activeIndex - 1].title}
                      </span>
                    </Button>
                  ) : (
                    <span />
                  )}

                  {activeIndex < chapters.length - 1 && (
                    <Button
                      onClick={() => goToChapter(chapters[activeIndex + 1].key)}
                      className="ml-auto min-w-0"
                    >
                      <span className="truncate">
                        {chapters[activeIndex + 1].title}
                      </span>
                      <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0" />
                    </Button>
                  )}
                </nav>
              </>
            )
          )}
        </main>
      </div>

      {/* --------------------------------------------- print-only full copy */}
      {printing && (
        <div className="hidden print:block">
          {chapters.map((chapter) => (
            <div key={chapter.key} className="mb-8">
              <h2 className="mb-4 border-b pb-2 text-xl font-semibold">
                {chapter.title}
              </h2>
              {chapter.sections.map((section) => (
                <div key={section.id} className="mb-6 break-inside-avoid">
                  <h3 className="mb-2 text-base font-semibold">{section.title}</h3>
                  <WelcomeMarkdown>{section.body_md}</WelcomeMarkdown>
                </div>
              ))}
              {chapter.faqs.map((faq) => (
                <div key={faq.id} className="mb-4 break-inside-avoid">
                  <p className="font-semibold">{faq.question}</p>
                  <WelcomeMarkdown>{faq.answer_md}</WelcomeMarkdown>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
