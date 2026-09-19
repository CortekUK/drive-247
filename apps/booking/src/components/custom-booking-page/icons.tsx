/**
 * Inline stroke icons on a 24px grid — the light, even line style the
 * reference uses throughout. No icon dependency, so this design stays
 * self-contained.
 */

const S = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const PATHS: Record<string, React.ReactNode> = {
  /* nav + chrome */
  user:     <><circle cx="12" cy="8" r="3.4" /><path d="M5 20.2a7 7 0 0 1 14 0" /></>,
  chat:     <><path d="M20.4 12.4a7.6 7.6 0 0 1-8.2 7.6L7 21.4l1.4-4.3a7.6 7.6 0 1 1 12-4.7Z" /><path d="M9.4 12h.01M12 12h.01M14.6 12h.01" /></>,
  phone:    <path d="M6.4 3.6h3l1.6 4-2.1 1.5a11.6 11.6 0 0 0 5.4 5.4l1.5-2.1 4 1.6v3a1.9 1.9 0 0 1-2.1 1.9A15.9 15.9 0 0 1 4.5 5.7a1.9 1.9 0 0 1 1.9-2.1Z" />,
  menu:     <path d="M4 7h16M4 12h16M4 17h16" />,
  close:    <path d="M6 6l12 12M18 6 6 18" />,
  mail:     <><rect x="2.8" y="5.2" width="18.4" height="13.6" rx="2.4" /><path d="m3.4 6.6 8.6 6.2 8.6-6.2" /></>,
  pin:      <><path d="M12 21.4s6.6-5.8 6.6-11.2a6.6 6.6 0 1 0-13.2 0c0 5.4 6.6 11.2 6.6 11.2Z" /><circle cx="12" cy="10" r="2.5" /></>,
  clock:    <><circle cx="12" cy="12" r="9" /><path d="M12 6.8V12l3.4 2" /></>,
  calendar: <><rect x="3.2" y="5" width="17.6" height="16" rx="2.5" /><path d="M3.2 9.8h17.6M8 3v4M16 3v4" /></>,

  /* vehicles + features */
  car:      <><path d="M3 13.4 4.8 8.5A2.1 2.1 0 0 1 6.8 7h10.4a2.1 2.1 0 0 1 2 1.5l1.8 4.9" /><path d="M3 13.4h18v4.4h-2.5M3 13.4v4.4h2.5" /><circle cx="7.2" cy="17.8" r="1.6" /><circle cx="16.8" cy="17.8" r="1.6" /></>,
  seat:     <><path d="M6.4 3.6h2.2a2 2 0 0 1 2 1.74l.9 6.86" /><path d="M6 12.2h8.4a2.4 2.4 0 0 1 2.4 2.4v1.6H8.4A2.4 2.4 0 0 1 6 13.8Z" /><path d="M6 16.2v4.2M16.8 16.2v4.2" /></>,
  gear:     <><circle cx="12" cy="12" r="2.9" /><path d="M12 3.2v3M12 17.8v3M3.2 12h3M17.8 12h3M5.8 5.8l2.1 2.1M16.1 16.1l2.1 2.1M18.2 5.8l-2.1 2.1M7.9 16.1l-2.1 2.1" /></>,
  fuel:     <><path d="M4.6 20.4V5.2a1.6 1.6 0 0 1 1.6-1.6h5.6a1.6 1.6 0 0 1 1.6 1.6v15.2" /><path d="M3.4 20.4h11.6M6.6 9.6h5.6" /><path d="M13.4 8.4h3.2a2 2 0 0 1 2 2v5.4a1.6 1.6 0 0 0 3.2 0V10L19.4 7" /></>,
  shield:   <><path d="M12 2.6 4.6 5.6v6c0 4.6 3.1 8.8 7.4 10 4.3-1.2 7.4-5.4 7.4-10v-6Z" /><path d="m9 12 2.1 2.1 4-4.2" /></>,
  headset:  <><path d="M4.2 13.5v-1.7a7.8 7.8 0 0 1 15.6 0v1.7" /><rect x="2.6" y="12.6" width="4" height="6.4" rx="1.8" /><rect x="17.4" y="12.6" width="4" height="6.4" rx="1.8" /><path d="M19.8 19v.6a2.6 2.6 0 0 1-2.6 2.6h-2.4" /></>,
  sparkle:  <><path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2l-1.7-5.8L4.5 10.7 10.3 9Z" /><path d="M18.6 3v3M20.1 4.5h-3" /></>,
  diamond:  <><path d="M6.4 3.4h11.2l3.4 5.1L12 20.6 3 8.5Z" /><path d="M3 8.5h18M8.6 8.5 12 20.6l3.4-12.1M6.4 3.4l2.2 5.1M17.6 3.4l-2.2 5.1" /></>,
  users:    <><circle cx="9.4" cy="8" r="3.2" /><path d="M3 20.2a6.4 6.4 0 0 1 12.8 0" /><path d="M16.6 5.2a3.2 3.2 0 0 1 0 6.2M17.9 14.4a6.4 6.4 0 0 1 3.5 5.8" /></>,
  wallet:   <><rect x="2.8" y="5.4" width="18.4" height="13.4" rx="2.4" /><path d="M2.8 10h18.4" /><circle cx="17.2" cy="14.4" r="1.1" /></>,
  tag:      <><path d="M11.2 2.8H20a1.2 1.2 0 0 1 1.2 1.2v8.8a1.6 1.6 0 0 1-.47 1.13l-7.1 7.1a1.6 1.6 0 0 1-2.26 0l-8.1-8.1a1.6 1.6 0 0 1 0-2.26l7.1-7.1a1.6 1.6 0 0 1 1.13-.47Z" /><circle cx="16.6" cy="7.4" r="1.5" /></>,
  gift:     <><rect x="3" y="8.6" width="18" height="4" rx="1.2" /><path d="M4.6 12.6v7a1.4 1.4 0 0 0 1.4 1.4h12a1.4 1.4 0 0 0 1.4-1.4v-7M12 8.6V21" /><path d="M12 8.6S10.6 3.4 8.2 3.4a2.6 2.6 0 0 0 0 5.2ZM12 8.6s1.4-5.2 3.8-5.2a2.6 2.6 0 0 1 0 5.2Z" /></>,
  building: <><rect x="4" y="3.4" width="12" height="17.2" rx="1.4" /><path d="M16 9.6h3.4a.6.6 0 0 1 .6.6v10.4M7.2 7.4h2M11 7.4h2M7.2 11h2M11 11h2M7.2 14.6h2M11 14.6h2M9.6 20.6v-3.2h2.8v3.2" /></>,
  doc:      <><path d="M6 3.4h7.8L19 8.6v12H6Z" /><path d="M13.8 3.4v5.2H19M9 13h6M9 16.4h4" /></>,
  check:    <path d="m4.8 12.6 4.6 4.6 9.8-10.4" />,
  info:     <><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5M12 7.9h.01" /></>,
  logout:   <><path d="M9.4 20.4H6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h3.4" /><path d="M15.6 16.4 20 12l-4.4-4.4M20 12H9.6" /></>,
  eye:      <><path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z" /><circle cx="12" cy="12" r="3.1" /></>,
  eyeOff:   <><path d="M9.6 6.1A8.9 8.9 0 0 1 12 5.8c6 0 9.6 6.2 9.6 6.2a17 17 0 0 1-3.1 3.8M6.2 8A17 17 0 0 0 2.4 12s3.6 6.2 9.6 6.2a9 9 0 0 0 3.4-.65" /><path d="m10 10a2.8 2.8 0 0 0 4 4" /><path d="m3.6 3.6 16.8 16.8" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.2 12.2 2.6 2.6 5-5.4" /></>,
  star:     <path d="m12 3.4 2.7 5.5 6 .9-4.35 4.2 1.03 6-5.38-2.83L6.62 20l1.03-6L3.3 9.8l6-.9Z" />,
  quote:    <path d="M9.4 6.2C6.4 7.4 4.6 10 4.6 13.2c0 2.6 1.5 4.6 3.8 4.6 2 0 3.5-1.5 3.5-3.4 0-1.9-1.4-3.3-3.2-3.3-.3 0-.6 0-.9.1.4-1.6 1.6-2.9 3.3-3.6Zm9 0c-3 1.2-4.8 3.8-4.8 7 0 2.6 1.5 4.6 3.8 4.6 2 0 3.5-1.5 3.5-3.4 0-1.9-1.4-3.3-3.2-3.3-.3 0-.6 0-.9.1.4-1.6 1.6-2.9 3.3-3.6Z" />,
  swap:     <><path d="M4 8.4h13.2M13.6 4.8l3.6 3.6M20 15.6H6.8M10.4 19.2l-3.6-3.6" /></>,
  search:   <><circle cx="11" cy="11" r="6.8" /><path d="m16 16 5 5" /></>,
  arrow:    <><path d="M4.8 12h13.6" /><path d="m13 6.6 5.4 5.4-5.4 5.4" /></>,
  chevron:  <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronLeft:  <path d="M14.5 6.5 9 12l5.5 5.5" />,
  chevronRight: <path d="M9.5 6.5 15 12l-5.5 5.5" />,

  /* socials */
  facebook:  <path d="M14.4 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H17.6V3.6A21 21 0 0 0 15.2 3.5c-2.4 0-4 1.45-4 4.12V9.9H8.5V13h2.7v8Z" />,
  instagram: <><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.8" /><circle cx="12" cy="12" r="3.9" /><circle cx="17" cy="7" r="1" /></>,
  linkedin:  <><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.4" /><path d="M7.6 10.4v6.2M7.6 7.6v.01M11.6 16.6v-6.2M11.6 12.9c0-1.4.9-2.3 2.2-2.3s2.2.9 2.2 2.5v3.5" /></>,
  x:         <path d="m4.4 4.4 15.2 15.2M19.6 4.4 4.4 19.6" />,
  youtube:   <><rect x="2.6" y="5.6" width="18.8" height="12.8" rx="3.6" /><path d="m10.4 9.6 5 2.4-5 2.4Z" /></>,
  tiktok:    <><path d="M14.4 3.4v10.9a3.5 3.5 0 1 1-3.5-3.5c.3 0 .6 0 .9.12" /><path d="M14.4 3.4c.4 2.3 2 3.9 4.3 4.1" /></>,
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S}>
      {PATHS[name] ?? PATHS.car}
    </svg>
  );
}

/** Filled star — the ratings read as solid marks, not outlines. */
export function StarIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="m12 3.4 2.7 5.5 6 .9-4.35 4.2 1.03 6-5.38-2.83L6.62 20l1.03-6L3.3 9.8l6-.9Z" />
    </svg>
  );
}

/**
 * The operator's mark.
 *
 * The uploaded logo is rendered exactly as supplied — `object-fit: contain`,
 * sized by height so any aspect ratio survives, and no opacity, blur,
 * greyscale or colour filter of any kind. Sizing lives in `.cbp-logo-img`.
 *
 * Whether the company name appears beside it is the operator's call, not a
 * guess: a logo that already contains the name would otherwise print it twice,
 * and an icon-only mark alone leaves the header anonymous. They set that in
 * the portal (Site settings → Logo), and `showName` carries the answer here.
 *
 * `variant` picks the light- or dark-background upload; the caller resolves
 * which, so this component stays free of theme state.
 */
export function Logo({
  name, src, tone = "dark", showName = true, plate = false, className = "",
}: {
  name: string;
  src?: string | null;
  /** `light` renders the wordmark white, for use on the midnight footer. */
  tone?: "dark" | "light";
  /** False when the uploaded logo already contains the company name. */
  showName?: boolean;
  /**
   * Sit the mark on a rounded plate so it stays visible on a ground it was
   * not drawn for: "dark" for a light-ink logo on the white header, "light"
   * for a dark-ink logo on the midnight footer. Measured, never assumed —
   * see `useLogoTone`.
   */
  plate?: false | "dark" | "light";
  className?: string;
}) {
  const word = (
    <span
      className={`whitespace-nowrap text-[17px] font-extrabold leading-none tracking-[-.03em] sm:text-[19px] ${
        tone === "light" ? "text-white" : "text-[var(--ink)]"
      }`}
    >
      {name}
    </span>
  );

  // No logo uploaded — the name carries the brand on its own.
  if (!src) return <span className={`flex items-center ${className}`}>{word}</span>;

  const mark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={showName ? "" : name} className="cbp-logo-img shrink-0" decoding="async" />
  );

  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {plate
        ? <span className={`shrink-0 ${plate === "light" ? "cbp-logo-plate-light" : "cbp-logo-plate"}`}>{mark}</span>
        : mark}
      {/* The name is dropped on the narrowest screens when a logo is present,
          so the lockup and the header actions still fit side by side. */}
      {showName && <span className="hidden sm:flex sm:items-center">{word}</span>}
    </span>
  );
}
