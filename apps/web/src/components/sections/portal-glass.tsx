import { ArrowLeft, ArrowRight, Lock, Plus, RotateCw, X } from "lucide-react";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import "./portal-glass.css";

/* A plain browser window: tab strip, address bar, then whatever it is showing. */
export function BrowserChrome({
  tab,
  url,
  screenStyle,
  nav,
  children,
}: {
  tab: string;
  url: string;
  screenStyle?: CSSProperties;
  /** A window that can be clicked around (the demo): its back and forward arrows work. */
  nav?: { back?: () => void; forward?: () => void };
  children: ReactNode;
}) {
  return (
    <div className="pg-browser">
      <div className="pg-tabs" aria-hidden>
        <span className="pg-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pg-tab">
          <Image src="/favicon-dark.png" alt="" width={16} height={16} />
          <span className="pg-tab-label">{tab}</span>
          <X strokeWidth={2} />
        </span>
        <Plus strokeWidth={2} className="pg-newtab" />
      </div>
      <div className="pg-address" aria-hidden={nav ? undefined : true}>
        {nav ? (
          <>
            <button type="button" aria-label="Back" disabled={!nav.back} onClick={nav.back}>
              <ArrowLeft strokeWidth={2} aria-hidden />
            </button>
            <button type="button" aria-label="Forward" disabled={!nav.forward} onClick={nav.forward}>
              <ArrowRight strokeWidth={2} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <ArrowLeft strokeWidth={2} />
            <ArrowRight strokeWidth={2} className="pg-off" />
          </>
        )}
        <RotateCw strokeWidth={2} />
        <span className="pg-url">
          <Lock strokeWidth={2} />
          <span className="pg-url-label">{url}</span>
        </span>
      </div>
      <div className="pg-screen" style={screenStyle}>
        {children}
      </div>
    </div>
  );
}

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
    {/* The browser, open on a tablet. */}
    <div className="pg-tablet">
      <i className="pg-tablet-camera" aria-hidden />
      <BrowserChrome tab={tab} url={url} screenStyle={{ aspectRatio: aspect }}>
        <Image src={`${src}.png`} alt={alt} fill sizes="(min-width: 1200px) 60vw, 100vw" className="dark:hidden" />
        <Image src={`${src}-dark.png`} alt={alt} fill sizes="(min-width: 1200px) 60vw, 100vw" className="hidden dark:block" />
      </BrowserChrome>
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

/* Licence, then face, then cleared. */
export function VerifyArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M172 95H210" delay={1} />
      <Thread d="M310 95H350" delay={2.2} />
      <g className="pg-art-tool">
        <rect x="24" y="45" width="148" height="100" rx="12" />
        <circle cx="62" cy="86" r="17" />
        <path d="M38 128c3-12 13-17 24-17s21 5 24 17M104 76h52M104 96h52M104 116h30" />
      </g>
      <g className="pg-art-tool">
        <circle cx="260" cy="95" r="50" />
        <circle cx="260" cy="82" r="16" />
        <path d="M232 128c4-16 16-22 28-22s24 6 28 22" />
      </g>
      <path className="pg-art-sign" pathLength={1} style={at(1.5)} d="M210 62V50a8 8 0 0 1 8-8h12M290 42h12a8 8 0 0 1 8 8v12M310 128v12a8 8 0 0 1-8 8h-12M230 148h-12a8 8 0 0 1-8-8v-12" />
      <g className="pg-art-tool">
        <rect x="350" y="62" width="96" height="66" rx="12" />
        <circle cx="384" cy="95" r="13" />
        <path d="M397 95h36M423 95v13M433 95v9" />
      </g>
      <Tick x={446} y={64} delay={3.2} />
    </ArtSvg>
  );
}

/* A rental goes out with cover over it. */
export function InsuranceArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M154 95H260" delay={0.6} />
      <g className="pg-art-tool">
        <rect x="30" y="35" width="124" height="120" rx="12" />
        <path d="M48 62h88M48 84h88M48 106h52" />
      </g>
      <rect className="pg-art-grow" style={at(1.3)} x="48" y="124" width="88" height="16" rx="8" />
      <path className="pg-art-screen" d="M330 14l70 24v56c0 42-30 68-70 82-40-14-70-40-70-82V38Z" />
      <path className="pg-art-sign" pathLength={1} style={at(2)} d="m302 94 20 20 38-42" />
      <Tick x={400} y={38} delay={3.2} />
    </ArtSvg>
  );
}

/* Chat, text and email arrive from different places and land in one conversation. */
export function MessagesArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M146 50C210 50 220 95 280 95" delay={0.2} />
      <Thread d="M146 140C210 140 220 95 280 95" delay={0.9} />
      <g className="pg-art-tool">
        <rect x="34" y="18" width="112" height="64" rx="12" />
        <path d="M50 38h80M50 58h52" />
      </g>
      <g className="pg-art-tool">
        <rect x="34" y="108" width="112" height="64" rx="10" />
        <path d="m36 114 54 32 54-32" />
      </g>
      <rect className="pg-art-screen" x="280" y="20" width="166" height="150" rx="14" />
      <rect className="pg-art-grow" style={at(1.6)} x="296" y="40" width="100" height="24" rx="10" />
      <rect className="pg-art-fillbar" style={at(2.2)} x="340" y="78" width="90" height="24" rx="10" />
      <rect className="pg-art-grow" style={at(2.8)} x="296" y="116" width="118" height="24" rx="10" />
      <Tick x={446} y={22} delay={3.4} />
    </ArtSvg>
  );
}

/* A card pays, and the money lands in the operator's own account. */
export function PaymentsArt({ play }: { play: boolean }) {
  return (
    <ArtSvg play={play}>
      <Thread d="M190 95H280" delay={0.6} />
      <g className="pg-art-tool">
        <rect x="30" y="38" width="160" height="108" rx="14" />
        <path d="M30 72h160M50 118h40M136 118h34" />
      </g>
      <rect className="pg-art-screen" x="280" y="20" width="166" height="150" rx="14" />
      <rect className="pg-art-grow" style={at(1.3)} x="298" y="44" width="130" height="16" rx="8" />
      <rect className="pg-art-rise pg-art-kept" style={at(1.8)} x="306" y="112" width="26" height="40" rx="6" />
      <rect className="pg-art-rise pg-art-kept" style={at(2.1)} x="346" y="92" width="26" height="60" rx="6" />
      <rect className="pg-art-rise pg-art-kept" style={at(2.4)} x="386" y="72" width="26" height="80" rx="6" />
      <Tick x={446} y={22} delay={3.3} />
    </ArtSvg>
  );
}
