/**
 * The dashboard's empty-state character: a little cartoon car with a face, in
 * a thin-outline, flat-fill style. Our own drawing — nothing here is traced
 * from anyone else's character.
 *
 * One car, three moods, each with its own body colour so a screen with two
 * empty cards does not show the same picture twice:
 *   happy   — all clear, nothing needs you     (indigo, sparkles)
 *   sleepy  — nothing on the diary today       (peach, "z z")
 *   waiting — nothing collected yet            (sky, glancing aside, a clock)
 *
 * Pure SVG, decorative only (`aria-hidden`); the empty state's own text says
 * what the picture means.
 */
import { cn } from '@/lib/utils';

export type CarMood = 'happy' | 'sleepy' | 'waiting';

const INK = '#1f2040';
/**
 * The parts that sit straight on the card rather than inside the car's own
 * fills — tyres, the ground shadow and the sleepy "z z". On a dark card the
 * navy ink disappears into it, so each reads a variable that the <svg> sets
 * lighter in dark mode; light mode falls back to the ink, unchanged.
 */
const TYRE = 'var(--car-tyre, #1f2040)';
const FLOAT_INK = 'var(--car-float, #1f2040)';
const BODY: Record<CarMood, string> = {
  // The theme colour, softened toward white so the cartoon stays pastel on
  // any brand (it was a fixed #8b8cf0 indigo on every tenant).
  happy: 'color-mix(in srgb, hsl(var(--primary)) 60%, white)',
  sleepy: '#f6b38a',
  waiting: '#93c5fd',
};

const line = { stroke: INK, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Eyes({ mood }: { mood: CarMood }) {
  if (mood === 'sleepy') {
    return (
      <>
        <path d="M74 52 Q84 60 94 52" fill="none" {...line} />
        <path d="M106 52 Q116 60 126 52" fill="none" {...line} />
      </>
    );
  }
  const look = mood === 'waiting' ? 5 : 1; // waiting glances to the side
  return (
    <>
      <ellipse cx="84" cy="51" rx="11" ry="12.5" fill="#fff" {...line} />
      <ellipse cx="116" cy="51" rx="11" ry="12.5" fill="#fff" {...line} />
      <circle cx={84 + look} cy="53" r="5.5" fill={INK} />
      <circle cx={116 + look} cy="53" r="5.5" fill={INK} />
      <circle cx={86 + look} cy="50.5" r="1.8" fill="#fff" />
      <circle cx={118 + look} cy="50.5" r="1.8" fill="#fff" />
    </>
  );
}

function Mouth({ mood }: { mood: CarMood }) {
  if (mood === 'happy') {
    return (
      <>
        <path d="M80 88 Q100 106 120 88 Z" fill={INK} {...line} />
        <path d="M89 97 Q100 102 111 97" fill="none" stroke="#f87171" strokeWidth={5} strokeLinecap="round" />
        <ellipse cx="66" cy="80" rx="7" ry="4.5" fill="#fda4af" opacity={0.8} />
        <ellipse cx="134" cy="80" rx="7" ry="4.5" fill="#fda4af" opacity={0.8} />
      </>
    );
  }
  if (mood === 'sleepy') return <ellipse cx="100" cy="93" rx="5" ry="4" fill={INK} />;
  return <path d="M88 93 Q100 99 112 93" fill="none" {...line} />;
}

function Extra({ mood }: { mood: CarMood }) {
  if (mood === 'sleepy') {
    return (
      <g fill={FLOAT_INK} fontWeight={700} fontFamily="inherit">
        <text x="150" y="34" fontSize="18">z</text>
        <text x="164" y="20" fontSize="13">z</text>
      </g>
    );
  }
  if (mood === 'happy') {
    return (
      <>
        <path d="M160 18 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#f6c453" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <path d="M32 26 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#86d9b4" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      </>
    );
  }
  return (
    <>
      <circle cx="166" cy="26" r="9" fill="#fff" stroke={INK} strokeWidth={2.5} />
      <path d="M166 21 v5 l3 2" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </>
  );
}

export function CarMascot({ mood, className }: { mood: CarMood; className?: string }) {
  const body = BODY[mood];
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" className={cn('h-auto w-[132px] dark:[--car-tyre:#3d3f58] dark:[--car-float:hsl(var(--muted-foreground))] dark:[--car-shadow:#000] dark:[--car-shadow-o:0.35]', className)}>
      {/* Loose shapes around the car, kept clear of it. */}
      <circle cx="100" cy="72" r="58" fill={body} opacity={0.18} />
      <rect x="14" y="52" width="16" height="16" rx="4" transform="rotate(45 22 60)" fill="#f6c453" />
      <circle cx="184" cy="62" r="6" fill="#fff" stroke={INK} strokeWidth={2} />
      <ellipse cx="100" cy="134" rx="66" ry="6" fill="var(--car-shadow, #1f2040)" style={{ opacity: 'var(--car-shadow-o, 0.1)' }} />

      {/* Tyres, then roof, windshield, mirrors, body, lights, bumper. */}
      <rect x="36" y="104" width="26" height="28" rx="9" fill={TYRE} />
      <rect x="138" y="104" width="26" height="28" rx="9" fill={TYRE} />
      <path d="M50 70 C54 34 74 24 100 24 C126 24 146 34 150 70 Z" fill={body} {...line} />
      <path d="M60 66 C64 42 78 34 100 34 C122 34 136 42 140 66 Z" fill="color-mix(in srgb, hsl(var(--primary)) 8%, white)" {...line} />
      <ellipse cx="44" cy="62" rx="8" ry="6" fill={body} {...line} />
      <ellipse cx="156" cy="62" rx="8" ry="6" fill={body} {...line} />
      <rect x="22" y="64" width="156" height="50" rx="22" fill={body} {...line} />
      <circle cx="44" cy="84" r="9" fill="#fef3c7" {...line} />
      <circle cx="156" cy="84" r="9" fill="#fef3c7" {...line} />
      <rect x="34" y="106" width="132" height="12" rx="6" fill="#fff" {...line} />

      <Eyes mood={mood} />
      <Mouth mood={mood} />
      <Extra mood={mood} />
    </svg>
  );
}
