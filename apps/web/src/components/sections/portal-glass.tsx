import { ArrowLeft, ArrowRight, Lock, Plus, RotateCw, X } from "lucide-react";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import "./portal-glass.css";

/* A real screen, exactly as the product draws it, open in a browser window. */
export function PortalScreen({
  src,
  alt,
  aspect,
  tab,
  url,
  phone,
  phoneAlt,
}: {
  src: string;
  alt: string;
  aspect: string;
  tab: string;
  url: string;
  phone: string;
  phoneAlt: string;
}) {
  return (
    <div className="pg-device">
    <div className="pg-browser">
      <div className="pg-tabs" aria-hidden>
        <span className="pg-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pg-tab">
          <Image src="/favicon-dark.png" alt="" width={16} height={16} />
          {tab}
          <X strokeWidth={2} />
        </span>
        <Plus strokeWidth={2} className="pg-newtab" />
      </div>
      <div className="pg-address" aria-hidden>
        <ArrowLeft strokeWidth={2} />
        <ArrowRight strokeWidth={2} className="pg-off" />
        <RotateCw strokeWidth={2} />
        <span className="pg-url">
          <Lock strokeWidth={2} />
          {url}
        </span>
      </div>
      <div className="pg-screen" style={{ aspectRatio: aspect }}>
        <Image src={`${src}.png`} alt={alt} fill sizes="(min-width: 1200px) 60vw, 100vw" className="dark:hidden" />
        <Image src={`${src}-dark.png`} alt={alt} fill sizes="(min-width: 1200px) 60vw, 100vw" className="hidden dark:block" />
      </div>
    </div>
    {/* The phone view, resting on the window's outer corner. */}
    <div className="pg-phone">
      <div className="pg-phone-screen">
        <Image src={`${phone}.png`} alt={phoneAlt} fill sizes="180px" className="dark:hidden" />
        <Image src={`${phone}-dark.png`} alt={phoneAlt} fill sizes="180px" className="hidden dark:block" />
      </div>
    </div>
    </div>
  );
}

/* The six loose tools. */
const TOOLS = [
  {
    x: 44,
    y: 36,
    r: -6,
    art: (
      <>
        <rect x="-22" y="-18" width="44" height="36" rx="5" />
        <path d="M-22-6h44M-22 6h44M-7-18v36M8-18v36" />
      </>
    ),
  },
  {
    x: 120,
    y: 28,
    r: 5,
    art: (
      <>
        <rect x="-22" y="-16" width="44" height="32" rx="5" />
        <path d="M-22-7h44M-15 6h9M8 6h7" />
      </>
    ),
  },
  {
    x: 30,
    y: 98,
    r: 4,
    art: (
      <>
        <path d="M-14-16h28a8 8 0 0 1 8 8v10a8 8 0 0 1-8 8H-2l-10 8v-8h-2a8 8 0 0 1-8-8V-8a8 8 0 0 1 8-8Z" />
        <path d="M-11-6h22M-11 1h14" />
      </>
    ),
  },
  {
    x: 108,
    y: 94,
    r: -4,
    art: (
      <>
        <rect x="-16" y="-21" width="32" height="42" rx="4" />
        <path d="M-9-12H9M-9-5H9M-9 10c3-6 5-7 6-3s-1 5 1 4 3-4 5-2 2 2 5 1" />
      </>
    ),
  },
  {
    x: 48,
    y: 160,
    r: -3,
    art: (
      <>
        <rect x="-20" y="-16" width="40" height="33" rx="5" />
        <path d="M-20-7h40M-10-21v9M10-21v9M-9 2h4M3 2h4M-9 9h4" />
      </>
    ),
  },
  {
    x: 124,
    y: 160,
    r: 6,
    art: (
      <>
        <rect x="-12" y="-22" width="24" height="44" rx="5" />
        <path d="M-4 16h8" />
      </>
    ),
  },
];

/* Each picture runs on one 8s loop; `--d` is when a piece takes its turn in it. */
const at = (seconds: number) => ({ "--d": `${seconds}s` }) as CSSProperties;

function ArtSvg({ play, children }: { play: boolean; children: ReactNode }) {
  return (
    <svg className={play ? "pg-art is-playing" : "pg-art"} viewBox="0 0 470 190" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

/* A fixed thread, and a bright pulse that travels along it at `delay`. */
function Thread({ d, delay }: { d: string; delay: number }) {
  return (
    <>
      <path className="pg-art-line" d={d} />
      <path className="pg-art-pulse" pathLength={1} style={at(delay)} d={d} />
    </>
  );
}

function Tick({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <g className="pg-art-tick" style={at(delay)}>
      <circle cx={x} cy={y} r="13" />
      <path d={`m${x - 6} ${y} 4.5 4.5 8-8.5`} />
    </g>
  );
}

/* Work arrives from six places, one thread at a time, and the portal fills up. */
export function SixToolsArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      {TOOLS.map((t, i) => (
        <Thread key={i} delay={i * 0.35} d={`M${t.x} ${t.y}C210 ${t.y} 230 95 300 95`} />
      ))}

      {TOOLS.map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${t.y}) rotate(${t.r})`}>
          <g className="pg-art-tool pg-art-bob" style={at(i * -0.7)}>
            {t.art}
          </g>
        </g>
      ))}

      <rect className="pg-art-screen" x="300" y="28" width="150" height="134" rx="12" />
      <path className="pg-art-bar" d="M300 50V40a12 12 0 0 1 12-12h126a12 12 0 0 1 12 12v10Z" />
      <path className="pg-art-ink" d="M340 50v112M312 66h16M312 80h16M312 94h16M312 108h16" />
      {[64, 84, 104, 124].map((y, i) => (
        <rect key={y} className="pg-art-grow" style={at(1 + i * 0.5)} x="354" y={y} width={i === 3 ? 54 : 84} height="9" rx="4.5" />
      ))}
      <Tick x={450} y={30} delay={3.2} />
    </ArtSvg>
  );
}

/* A block is rewritten in the editor, sent across, and appears on the live site. */
export function WebsiteArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M240 95H320" delay={1.7} />
      <g className="pg-art-tool">
        <rect x="24" y="20" width="216" height="150" rx="12" />
        <path className="pg-art-ink" d="M24 44h216M38 32h8M52 32h8M38 132h110M38 148h70" />
        <rect className="pg-art-mark" x="38" y="58" width="188" height="58" rx="8" />
      </g>
      <rect className="pg-art-grow" style={at(0.2)} x="50" y="72" width="120" height="9" rx="4.5" />
      <rect className="pg-art-grow" style={at(0.9)} x="50" y="90" width="76" height="9" rx="4.5" />

      <rect className="pg-art-screen" x="320" y="35" width="130" height="120" rx="10" />
      <path className="pg-art-bar" d="M320 58V45a10 10 0 0 1 10-10h110a10 10 0 0 1 10 10v13Z" />
      <path className="pg-art-ink" d="M332 122h74M332 136h46" />
      <rect className="pg-art-grow" style={at(2.4)} x="332" y="72" width="88" height="8" rx="4" />
      <rect className="pg-art-grow" style={at(2.8)} x="332" y="88" width="56" height="8" rx="4" />
      <Tick x={450} y={37} delay={3.4} />
    </ArtSvg>
  );
}

/* The contract goes out, is signed on the phone, and comes back signed. */
export function AgreementsArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M112 95H205" delay={0.2} />
      <Thread d="M265 95H352" delay={2.2} />
      <g className="pg-art-tool">
        <rect x="42" y="30" width="70" height="130" rx="8" />
        <path className="pg-art-ink" d="M56 52h42M56 68h42M56 84h42M56 100h26M56 138h42" />
      </g>
      <g className="pg-art-tool">
        <rect x="205" y="20" width="60" height="150" rx="12" />
        <path className="pg-art-ink" d="M226 158h18M216 122h38" />
      </g>
      <path className="pg-art-sign" pathLength={1} style={at(1)} d="M216 104c8-22 12-26 15-13s-3 19 3 15 9-14 13-9 3 9 9 5" />
      <g className="pg-art-tool">
        <rect x="352" y="30" width="70" height="130" rx="8" />
        <path className="pg-art-ink" d="M366 52h42M366 68h42M366 84h42M366 100h26" />
      </g>
      <path className="pg-art-sign" pathLength={1} style={at(2.9)} d="M366 142c5-10 8-12 10-6s-2 8 2 7 5-7 7-4 2 4 6 2 6-3 17-1" />
      <Tick x={422} y={32} delay={3.6} />
    </ArtSvg>
  );
}

/* Money in, then what came out of it, and what is left is yours. */
export function InsightsArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <path className="pg-art-ink" d="M50 170h370" />
      <path className="pg-art-line" d="M132 24H158M220 58H246M308 110H334" />
      <rect className="pg-art-rise pg-art-solid" style={at(0.2)} x="70" y="24" width="62" height="146" rx="8" />
      <rect className="pg-art-drop pg-art-solid" style={at(1)} x="158" y="24" width="62" height="34" rx="8" />
      <rect className="pg-art-drop pg-art-solid" style={at(1.7)} x="246" y="58" width="62" height="52" rx="8" />
      <rect className="pg-art-rise pg-art-kept" style={at(2.5)} x="334" y="110" width="62" height="60" rx="8" />
      <Tick x={396} y={110} delay={3.3} />
    </ArtSvg>
  );
}

/* Visitors keep arriving, and each step of the way to a paid booking fills in turn. */
export function MarketingArt({ play }: { play: boolean }) {
  const paths = ["M43 50C80 50 90 43 118 43", "M71 96C95 96 95 43 118 43", "M39 140C85 140 85 43 118 43"];
  return (
    <ArtSvg play={play}>
      {paths.map((d, i) => (
        <Thread key={d} d={d} delay={i * 0.7} />
      ))}
      {[
        [34, 50],
        [62, 96],
        [30, 140],
      ].map(([cx, cy], i) => (
        <g key={i} className="pg-art-tool pg-art-bob" style={at(i * -1.1)}>
          <circle cx={cx} cy={cy} r="9" />
        </g>
      ))}
      {[300, 210, 120, 62].map((width, i) => {
        const y = 28 + i * 40;
        return (
          <g key={y}>
            <rect className="pg-art-screen" x="118" y={y} width={width} height="30" rx="10" />
            <rect className="pg-art-fillbar" style={at(0.6 + i * 0.7)} x="118" y={y} width={width} height="30" rx="10" />
          </g>
        );
      })}
      <Tick x={180} y={150} delay={3.6} />
    </ArtSvg>
  );
}
