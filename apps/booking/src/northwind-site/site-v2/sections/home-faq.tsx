
import { cmsSection } from '@nw/lib/cms/editable';
import { loadFaqs } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { SITE_WIDE } from '@nw/site-v2/kit';
import { HomeFaqList } from '@nw/site-v2/sections/home-faq-list';

/**
 * Northwind booking site v2 — the home page's questions: the operator's own
 * answers (rows in `faqs`, each still editable in place), then the ones every
 * renter on this site can be answered truthfully (`HomeFaqList`).
 *
 * The heading is the design's, like the rest of the home page; the other
 * pages keep the CMS-driven `FaqSection`. Because the site's own answers are
 * always there, the section always shows.
 *
 * One centred column at every size, so it reads the same with one question
 * or twenty. Behind it, two pairs of loose ribbon lines (`Ribbons`).
 */

/**
 * The section's background: two pairs of flowing lines in a light tint of the
 * brand colour, one pair coming down from the top and out to the right edge,
 * the other in from the left edge and down — in the space beside the column,
 * so they frame it without crossing it. Wide screens only. Each draws itself once when the section scrolls
 * in (`nw-draw` under `data-reveal`, styles/site.css); with reduced motion,
 * or before the script runs, they are simply there. Each picture keeps its
 * viewBox's shape (sized by width), so the lines scale evenly: about 2px wide
 * on a laptop, 3.5px on a wide screen.
 */
const RIGHT = [
  'M595 0 C615 60 628 120 628 500 C628 760 680 800 815 797 C870 796 930 787 1000 777',
  'M715 0 C735 80 746 260 746 420 C746 600 738 690 748 740 C766 850 820 898 960 897 L1000 896',
];
const LEFT = [
  'M0 667 C130 660 250 680 300 760 C350 840 345 950 330 1100 C315 1250 295 1400 288 1500',
  'M0 835 C120 780 250 735 330 740 C420 745 455 790 445 880 C430 1000 380 1200 380 1500',
];

function Ribbons() {
  const lines = (paths: string[], delay: number) =>
    paths.map((d, i) => (
      <path
        key={d}
        className="nw-draw"
        pathLength={1}
        style={{ '--d': `${delay + i * 0.25}s`, animationDuration: '1.8s' } as React.CSSProperties}
        d={d}
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    ));
  return (
    // Only where there is room beside the column (lg up); on a narrower screen they would run through the questions.
    <div aria-hidden data-reveal className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden text-pv-primary/30 lg:block dark:text-pv-primary/40">
      {/* Each pair fills the space beside the 760px column, fading out where it is cut off. */}
      <svg
        viewBox="560 0 440 900"
        fill="none"
        className="absolute right-0 top-0 h-auto w-[min(440px,calc((100%-820px)/2))] [mask-image:linear-gradient(to_bottom,transparent,#000_22%)]"
      >
        {lines(RIGHT, 0.1)}
      </svg>
      <svg
        viewBox="0 640 460 860"
        fill="none"
        className="absolute bottom-0 left-0 h-auto w-[min(460px,calc((100%-820px)/2))] [mask-image:linear-gradient(to_top,transparent,#000_22%)]"
      >
        {lines(LEFT, 0.5)}
      </svg>
    </div>
  );
}

export async function HomeFaq() {
  const seed = await loadFaqs();

  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(SITE_WIDE, 'relative isolate pt-20 md:pt-28')}>
      <Ribbons />
      <div {...cmsSection('home.faq_header', 'FAQ')} className="mx-auto max-w-[760px]">
        <div data-reveal className="text-center">
          <h2
            id="faq-title"
            className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.045em] text-pv-fg [text-wrap:balance] sm:text-[42px] lg:text-[48px]"
          >
            Good to know before you book
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-pv-muted-fg md:text-[17px]">
            Quick answers about booking, paying and collecting your car.
          </p>
        </div>

        <div className="mt-10">
          <HomeFaqList seed={seed} />
        </div>
      </div>
    </section>
  );
}
