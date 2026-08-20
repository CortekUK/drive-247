"use client";

/** Inline stroke icons — no icon dependency, so the prototype stays portable. */

const S = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    car:    <><path d="M3 13l1.8-5.1A2 2 0 0 1 6.7 6.5h10.6a2 2 0 0 1 1.9 1.4L21 13" /><path d="M3 13h18v4.5h-2.5M3 13v4.5h2.5" /><circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" /></>,
    tag:    <><path d="M3.5 11.4V4.5a1 1 0 0 1 1-1h6.9a1 1 0 0 1 .7.3l8.1 8.1a1 1 0 0 1 0 1.4l-6.9 6.9a1 1 0 0 1-1.4 0L3.8 12.1a1 1 0 0 1-.3-.7Z" /><circle cx="8" cy="8" r="1.3" /></>,
    bolt:   <path d="M13.5 2.5 4.8 13.2a.6.6 0 0 0 .5 1h5.2l-1 7.3 8.7-10.7a.6.6 0 0 0-.5-1h-5.2Z" />,
    shield: <><path d="M12 3 5 6v5.2c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V6Z" /><path d="m9.2 12 2 2 3.6-3.8" /></>,
    star:   <path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.75l5.8-.85Z" />,
    pin:    <><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
    users:  <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.1M17.6 14.4a6.2 6.2 0 0 1 3.6 5.6" /></>,
    gear:   <><circle cx="12" cy="12" r="3.1" /><path d="M19.5 12a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.1-1.2l-.3-2.5H10.3l-.3 2.5a7.6 7.6 0 0 0-2.1 1.2l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.1 1.2l.3 2.5h3.4l.3-2.5a7.6 7.6 0 0 0 2.1-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z" /></>,
    check:  <path d="m5 12.5 4.2 4.2L19 7" />,
    phone:  <path d="M6.2 3.5h3l1.5 3.7-1.9 1.4a12 12 0 0 0 5.6 5.6l1.4-1.9 3.7 1.5v3a1.7 1.7 0 0 1-1.9 1.7A16.5 16.5 0 0 1 4.5 5.4 1.7 1.7 0 0 1 6.2 3.5Z" />,
    mail:   <><rect x="3" y="5.2" width="18" height="13.6" rx="2" /><path d="m3.6 6.4 8.4 6 8.4-6" /></>,
    head:   <><path d="M4.5 13v-1a7.5 7.5 0 0 1 15 0v1" /><path d="M4.5 12.6h1.6a1.4 1.4 0 0 1 1.4 1.4v2.6a1.4 1.4 0 0 1-1.4 1.4H4.5Z" /><path d="M19.5 12.6h-1.6a1.4 1.4 0 0 0-1.4 1.4v2.6a1.4 1.4 0 0 0 1.4 1.4h1.6Z" /><path d="M19.5 18v.5a2.5 2.5 0 0 1-2.5 2.5h-2.4" /></>,
    seat:   <><path d="M7 4.5h2.6a2 2 0 0 1 2 1.8l.7 6.2H8.4a2 2 0 0 1-2-1.8Z" /><path d="M6.4 14.5h9.1a2 2 0 0 1 2 2v3h-9a2 2 0 0 1-2-1.8Z" /></>,
    arrow:  <><path d="M4.5 12h14" /><path d="m13 6.5 5.5 5.5L13 17.5" /></>,
    cal:    <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.6h17M8 3.5v3M16 3.5v3" /></>,
    clock:  <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.4V12l3 1.8" /></>,
    chev:   <path d="m7 10 5 5 5-5" />,
    left:   <path d="M15 6.5 8.5 12l6.5 5.5" />,
    right:  <path d="M9 6.5 15.5 12 9 17.5" />,
    quote:  <path d="M9.4 6.2c-3 1.3-4.6 3.7-4.6 7 0 2.9 1.4 4.6 3.5 4.6 1.8 0 3.1-1.3 3.1-3.1 0-1.7-1.1-2.9-2.7-2.9h-.6c.2-1.5 1.2-2.7 2.7-3.4Zm9 0c-3 1.3-4.6 3.7-4.6 7 0 2.9 1.4 4.6 3.5 4.6 1.8 0 3.1-1.3 3.1-3.1 0-1.7-1.1-2.9-2.7-2.9h-.6c.2-1.5 1.2-2.7 2.7-3.4Z" />,
    gift:   <><rect x="3.5" y="9.5" width="17" height="11" rx="1.6" /><path d="M3.5 13.5h17M12 9.5v11" /><path d="M12 9.5S10.6 4.5 8.4 4.5a2.2 2.2 0 0 0 0 4.4M12 9.5s1.4-5 3.6-5a2.2 2.2 0 0 1 0 4.4" /></>,
    user:   <><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" /></>,
    chat:   <path d="M20.5 12.6c0 3.9-3.8 7-8.5 7a9.9 9.9 0 0 1-2.6-.34L4.5 20.5l1.2-3.4A6.7 6.7 0 0 1 3.5 12.6c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z" />,
    menu:   <path d="M4 7.5h16M4 12.5h16M4 17.5h16" />,
    close:  <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
    sliders:<><path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></>,
    spark:  <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6-5.5-1.7L10.3 9Z" />,
    lock:   <><rect x="4.8" y="10.5" width="14.4" height="9.5" rx="2" /><path d="M8.3 10.5V7.8a3.7 3.7 0 0 1 7.4 0v2.7" /></>,
    play:   <path d="M8.6 5.8 18 12l-9.4 6.2Z" />,
    plus:   <path d="M12 5.5v13M5.5 12h13" />,
    sun:    <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.6v2.3M12 19.1v2.3M4.35 4.35 5.98 5.98M18.02 18.02l1.63 1.63M2.6 12h2.3M19.1 12h2.3M4.35 19.65 5.98 18.02M18.02 5.98l1.63-1.63" /></>,
    moon:   <path d="M20.4 14.3A8.6 8.6 0 0 1 9.7 3.6a8.6 8.6 0 1 0 10.7 10.7Z" />,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S}>
      {p[name] ?? p.car}
    </svg>
  );
}

/** Solid social glyphs — stroke icons read wrong at footer size. */
export function Social({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    facebook: <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H16.7V3.6A21 21 0 0 0 14.3 3.5c-2.4 0-4 1.45-4 4.12V9.9H7.6V13h2.7v8Z" />,
    instagram: <path d="M12 2.2c-2.65 0-3 .01-4.05.06-1.04.05-1.75.22-2.37.46a4.8 4.8 0 0 0-1.73 1.13A4.8 4.8 0 0 0 2.72 5.58c-.24.62-.4 1.33-.46 2.37C2.21 9 2.2 9.35 2.2 12s.01 3 .06 4.05c.05 1.04.22 1.75.46 2.37a4.8 4.8 0 0 0 1.13 1.73 4.8 4.8 0 0 0 1.73 1.13c.62.24 1.33.4 2.37.46 1.04.05 1.4.06 4.05.06s3-.01 4.05-.06c1.04-.05 1.75-.22 2.37-.46a5 5 0 0 0 2.86-2.86c.24-.62.4-1.33.46-2.37.05-1.04.06-1.4.06-4.05s-.01-3-.06-4.05c-.05-1.04-.22-1.75-.46-2.37a4.8 4.8 0 0 0-1.13-1.73 4.8 4.8 0 0 0-1.73-1.13c-.62-.24-1.33-.4-2.37-.46C15 2.21 14.65 2.2 12 2.2Zm0 1.77c2.6 0 2.92.01 3.95.06.95.04 1.47.2 1.82.34.45.17.78.38 1.12.72.34.34.55.66.72 1.12.13.34.3.86.34 1.82.05 1.03.06 1.34.06 3.95s-.01 2.92-.06 3.95c-.04.95-.2 1.47-.34 1.82-.17.45-.38.78-.72 1.12-.34.34-.66.55-1.12.72-.34.13-.86.3-1.82.34-1.03.05-1.34.06-3.95.06s-2.92-.01-3.95-.06c-.95-.04-1.47-.2-1.82-.34a3 3 0 0 1-1.12-.72 3 3 0 0 1-.72-1.12c-.13-.34-.3-.86-.34-1.82-.05-1.03-.06-1.34-.06-3.95s.01-2.92.06-3.95c.04-.95.2-1.47.34-1.82.17-.45.38-.78.72-1.12a3 3 0 0 1 1.12-.72c.34-.13.86-.3 1.82-.34C9.08 3.98 9.4 3.97 12 3.97Zm0 3.01a5.02 5.02 0 1 0 0 10.04A5.02 5.02 0 0 0 12 6.98Zm0 8.28a3.26 3.26 0 1 1 0-6.52 3.26 3.26 0 0 1 0 6.52Zm6.4-8.48a1.17 1.17 0 1 1-2.35 0 1.17 1.17 0 0 1 2.34 0Z" />,
    x: <path d="M17.2 3h3.3l-7.2 8.2 8.5 11.3h-6.7l-5.2-6.9-6 6.9H.6l7.7-8.8L.2 3h6.9l4.7 6.3ZM16 20.5h1.8L7.9 4.9H6Z" />,
    linkedin: <path d="M6.9 21H3.4V9.1h3.5ZM5.15 7.5a2.03 2.03 0 1 1 0-4.06 2.03 2.03 0 0 1 0 4.06ZM21 21h-3.5v-5.8c0-1.38-.03-3.16-1.93-3.16-1.93 0-2.22 1.5-2.22 3.06V21H9.85V9.1h3.36v1.63h.05a3.68 3.68 0 0 1 3.31-1.82c3.55 0 4.2 2.34 4.2 5.37Z" />,
    youtube: <path d="M22.1 7.2a2.64 2.64 0 0 0-1.86-1.87C18.6 4.9 12 4.9 12 4.9s-6.6 0-8.24.44A2.64 2.64 0 0 0 1.9 7.2C1.46 8.85 1.46 12 1.46 12s0 3.15.44 4.8a2.64 2.64 0 0 0 1.86 1.86c1.64.44 8.24.44 8.24.44s6.6 0 8.24-.44a2.64 2.64 0 0 0 1.86-1.86c.44-1.65.44-4.8.44-4.8s0-3.15-.44-4.8ZM9.9 15.15V8.85L15.35 12Z" />,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      {p[name]}
    </svg>
  );
}

/** Drive247 wordmark — gradient 'D' tile plus the name. */
export function Logo({ light = false, className = "" }: { light?: boolean; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[11px]
                       bg-[linear-gradient(135deg,#3b82f6,#6d5af0_55%,#a855f7)]
                       shadow-[0_8px_20px_-8px_rgba(109,90,240,.95)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path d="M6.5 4.5h5a7.5 7.5 0 0 1 0 15h-5Z" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinejoin="round" />
          <circle cx="10.2" cy="12" r="1.7" fill="#fff" />
        </svg>
      </span>
      <span className={`d7-dis text-[20px] tracking-[-.035em] ${light ? "text-white" : "text-[var(--ink)]"}`}>
        Drive<span className={light ? "text-[#c4b5fd]" : "text-[var(--v)]"}>247</span>
      </span>
    </span>
  );
}

/**
 * Landmark skyline behind the hero car — Big Ben, Burj Khalifa and the Statue
 * of Liberty, echoing the UK / UAE / USA chips. Drawn rather than sourced:
 * the repo has no landmark photography, and a silhouette composites cleanly
 * over the gradient sky at any width.
 */
export function Skyline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 380" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="d7-sky-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b8fd6" stopOpacity=".40" />
          <stop offset="70%" stopColor="#a5a9e6" stopOpacity=".22" />
          <stop offset="100%" stopColor="#c7cbf4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="d7-sky-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6f76c4" stopOpacity=".52" />
          <stop offset="100%" stopColor="#9aa0e0" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* far bank — generic towers */}
      <g fill="url(#d7-sky-fade)">
        <rect x="30" y="196" width="52" height="184" />
        <rect x="96" y="230" width="38" height="150" />
        <rect x="150" y="168" width="60" height="212" />
        <rect x="228" y="244" width="44" height="136" />
        <rect x="700" y="214" width="46" height="166" />
        <rect x="760" y="182" width="58" height="198" />
        <rect x="836" y="238" width="40" height="142" />
        <rect x="1090" y="206" width="54" height="174" />
        <rect x="1156" y="248" width="36" height="132" />
      </g>

      {/* Big Ben — clock tower, left of centre */}
      <g fill="url(#d7-sky-near)">
        <rect x="296" y="150" width="34" height="230" />
        <rect x="292" y="140" width="42" height="12" />
        <rect x="300" y="112" width="26" height="30" />
        <path d="M313 78 330 114h-34Z" />
        <rect x="340" y="262" width="120" height="118" />
        <path d="M348 262h104v-16H348Z" />
        <rect x="360" y="228" width="14" height="36" />
        <rect x="392" y="238" width="12" height="26" />
        <rect x="424" y="228" width="14" height="36" />
      </g>
      <circle cx="313" cy="128" r="9" fill="#eef0ff" opacity=".55" />

      {/* Burj Khalifa — the tapering spire, centre-right */}
      <g fill="url(#d7-sky-near)">
        <path d="M596 380V196l10-58 10 58v184Z" />
        <path d="M606 138V54l3-40 3 40v84Z" />
        <path d="M566 380V236l14-22v166Z" />
        <path d="M646 380V236l-14-22v166Z" />
        <path d="M542 380V286l12-14v108Z" />
        <path d="M670 380V286l-12-14v108Z" />
      </g>

      {/* Statue of Liberty on its pedestal, right */}
      <g fill="url(#d7-sky-near)">
        <rect x="944" y="300" width="86" height="80" />
        <path d="M956 300h62v-22h-62Z" />
        <path d="M975 278h28v-40h-28Z" />
        {/* robe */}
        <path d="M978 238c0-14 5-24 11-24s11 10 11 24Z" />
        <path d="M972 238h34l6 40h-46Z" />
        {/* raised arm and torch */}
        <path d="M1002 216l14-46 5 2-13 46Z" />
        <path d="M1013 166l10 4-4 12-10-4Z" />
        {/* crown */}
        <path d="M983 206h16l-2-9-6 3-6-3Z" />
      </g>
      <circle cx="1018" cy="164" r="7" fill="#fde68a" opacity=".55" />
    </svg>
  );
}
