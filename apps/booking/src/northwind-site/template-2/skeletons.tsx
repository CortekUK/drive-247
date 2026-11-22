import { cn } from '@nw/lib/utils';

/**
 * Template 2 ("Glass") — what a page looks like while it loads. Each route's
 * `loading.tsx` shows one of these the moment its link is clicked, so the
 * page answers the click at once instead of sitting still until the next one
 * is ready. Each echoes its page's own panes, so nothing jumps when it lands.
 * Pulsing is off for reduced motion.
 */

const PAGE = 'mx-auto w-full max-w-[1320px] px-3 pb-3 pt-[84px] sm:px-5 sm:pt-[96px]';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';
const PULSE = 'animate-pulse motion-reduce:animate-none';

/** A line of text. */
function Bar({ className, width }: { className?: string; width?: string }) {
  return <div className={cn(PULSE, 'rounded-full bg-white/60', className)} style={width ? { width } : undefined} />;
}

/** A well, a photo, a card. */
function Block({ className }: { className?: string }) {
  return <div className={cn(PULSE, 'rounded-[28px] bg-white/45', className)} />;
}

function Frame({ children, label = 'Loading' }: { children: React.ReactNode; label?: string }) {
  return (
    <div aria-busy aria-label={label} className={PAGE}>
      <div className={PANE}>{children}</div>
    </div>
  );
}

/** A page's centred title and its line. */
function Heading() {
  return (
    <div className="flex flex-col items-center px-2 pb-6 pt-6 sm:pb-8 sm:pt-10">
      <Bar className="h-10 w-3/4 max-w-[520px] sm:h-14" />
      <Bar className="mt-4 h-4 w-full max-w-[420px]" />
    </div>
  );
}

/** Home: the showroom and the trip search. */
export function HomeSkeleton() {
  return (
    <Frame>
      <div className="grid min-h-[70svh] gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Block className="min-h-[320px]" />
        <div className="flex flex-col gap-3">
          <Block className="h-24" />
          <Block className="flex-1" />
        </div>
      </div>
    </Frame>
  );
}

/** Fleet and Pricing: the period tiles, the filters, and the cars. */
export function FleetSkeleton() {
  return (
    <Frame label="Loading the cars">
      <Heading />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((n) => (
          <Block key={n} className="h-[120px]" />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Bar className="h-11 w-full sm:w-[360px]" />
        <Bar className="h-11 w-[260px]" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Block key={n} className="h-[300px]" />
        ))}
      </div>
    </Frame>
  );
}

/** A car's own page: the gallery and what it costs. */
export function CarSkeleton() {
  return (
    <Frame label="Loading the car">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        <Block className="aspect-[16/10]" />
        <div className="space-y-4 px-3 py-4">
          <Bar className="h-5 w-24" />
          <Bar className="h-11 w-3/4" />
          <Bar className="h-8 w-1/2" />
          <Block className="h-20 rounded-[24px]" />
          <Bar className="h-12 w-48" />
        </div>
      </div>
    </Frame>
  );
}

/** A content page: its title, then its wells side by side. */
export function PageSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'split' | 'aside' }) {
  return (
    <Frame>
      <Heading />
      {layout === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <Block key={n} className="h-[340px]" />
          ))}
        </div>
      ) : layout === 'aside' ? (
        <div className="grid gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Block className="h-[420px]" />
          <Block className="h-[420px]" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <Block className="h-[380px]" />
          <Block className="h-[380px]" />
        </div>
      )}
    </Frame>
  );
}

/** A policy or a post: the title, then the reading sheet. */
export function ReadingSkeleton() {
  return (
    <Frame>
      <Heading />
      <div className="rounded-[26px] bg-white/70 px-5 py-10 sm:px-10">
        <div className="mx-auto max-w-[720px] space-y-3">
          {[100, 96, 92, 98, 60, 0, 94, 100, 88, 70].map((width, n) =>
            width === 0 ? <div key={n} className="h-4" /> : <Bar key={n} width={`${width}%`} className="h-4 bg-[rgb(13_12_29/0.06)]" />,
          )}
        </div>
      </div>
    </Frame>
  );
}

/** Sign in, create an account, reset your password. */
export function AuthSkeleton() {
  return (
    <Frame>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <div className="hidden space-y-4 px-8 py-10 lg:block">
          <Bar className="h-12 w-4/5" />
          <Bar className="h-12 w-3/5" />
          <Bar className="mt-6 h-4 w-2/3" />
        </div>
        <div className="space-y-4 rounded-[28px] bg-white/70 px-5 py-10 sm:px-10">
          <Bar className="h-8 w-40 bg-[rgb(13_12_29/0.07)]" />
          <Bar className="h-4 w-3/4 bg-[rgb(13_12_29/0.06)]" />
          {[0, 1].map((n) => (
            <div key={n} className={cn(PULSE, 'h-12 rounded-2xl bg-[rgb(13_12_29/0.06)]')} />
          ))}
          <div className={cn(PULSE, 'h-12 rounded-2xl bg-[rgb(13_12_29/0.1)]')} />
        </div>
      </div>
    </Frame>
  );
}

/** The skeleton for a Template 2 path, or null when it has none (an unknown page). */
export function skeletonFor(path: string): React.ReactNode {
  const rest = path.replace(/^\/template-2/, '').replace(/\/+$/, '') || '/';
  if (rest === '/') return <HomeSkeleton />;
  if (rest === '/fleet') return <FleetSkeleton />;
  if (/^\/booking\/[^/]+$/.test(rest)) return <CarSkeleton />;
  if (rest === '/booking') return null; // its own skeleton, from the booking flow, via loading.tsx
  if (rest === '/promotions' || rest === '/blog') return <PageSkeleton layout="grid" />;
  if (rest === '/reviews' || rest === '/contact') return <PageSkeleton layout="aside" />;
  if (rest === '/about') return <PageSkeleton layout="split" />;
  if (rest === '/privacy' || rest === '/terms' || rest.startsWith('/blog/')) return <ReadingSkeleton />;
  if (rest === '/login' || rest === '/signup' || rest === '/forgot-password') return <AuthSkeleton />;
  return null;
}
