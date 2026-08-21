/**
 * Inline stroke icons — thin, geometric, drawn on a 24px grid to sit quietly
 * beside the serif headings. No icon dependency, so the page stays portable.
 */

const S = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.4,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 9.6h17M8 3.4v3.2M16 3.4v3.2" /></>,
    car:      <><path d="M3 13.2l1.7-4.8A2 2 0 0 1 6.6 7h10.8a2 2 0 0 1 1.9 1.4l1.7 4.8" /><path d="M3 13.2h18v4.3h-2.4M3 13.2v4.3h2.4" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></>,
    users:    <><circle cx="9.2" cy="8.2" r="3.1" /><path d="M3 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.4 5.6a3.1 3.1 0 0 1 0 6M17.6 14.6A6.2 6.2 0 0 1 21 20" /></>,
    card:     <><rect x="2.8" y="5.4" width="18.4" height="13.2" rx="1.6" /><path d="M2.8 9.9h18.4" /></>,
    chart:    <><path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6H12Z" /><path d="M14.6 3.9A8.6 8.6 0 0 1 20.1 9.4h-5.5Z" /></>,
    trend:    <><path d="M3.6 16.4 9 11l3.4 3.4L20.4 6.4" /><path d="M15.6 6.4h4.8v4.8" /></>,
    shield:   <><path d="M12 3.2 5.2 6v5.1c0 4.2 2.8 8 6.8 9.1 4-1.1 6.8-4.9 6.8-9.1V6Z" /><path d="m9.3 12 1.9 1.9 3.5-3.7" /></>,
    clock:    <><circle cx="12" cy="12" r="8.6" /><path d="M12 7.2V12l3.2 1.9" /></>,
    smile:    <><circle cx="12" cy="12" r="8.6" /><path d="M8.6 14.2a4.4 4.4 0 0 0 6.8 0" /><path d="M9.4 9.6h.01M14.6 9.6h.01" /></>,
    arrow:    <><path d="M4.5 12h14" /><path d="m13 6.4 5.6 5.6L13 17.6" /></>,
    arrowUpRight: <><path d="M7 17 17 7" /><path d="M8.4 7H17v8.6" /></>,
    chevron:  <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
    filter:   <><path d="M3.6 6.2h16.8M6.6 12h10.8M10 17.8h4" /></>,
    grid:     <><rect x="3.6" y="3.6" width="7" height="7" rx="1" /><rect x="13.4" y="3.6" width="7" height="7" rx="1" /><rect x="3.6" y="13.4" width="7" height="7" rx="1" /><rect x="13.4" y="13.4" width="7" height="7" rx="1" /></>,
    user:     <><circle cx="12" cy="8" r="3.4" /><path d="M5 20.2a7 7 0 0 1 14 0" /></>,
    doc:      <><path d="M6 3.6h7.6L19 9v11.4H6Z" /><path d="M13.4 3.6V9H19" /></>,
    settings: <><circle cx="12" cy="12" r="2.9" /><path d="M19.3 12a7.3 7.3 0 0 0-.1-1.2l1.9-1.4-1.9-3.3-2.2 1a7.4 7.4 0 0 0-2-1.2l-.3-2.4h-3.8l-.3 2.4a7.4 7.4 0 0 0-2 1.2l-2.2-1-1.9 3.3 1.9 1.4a7.3 7.3 0 0 0 0 2.4l-1.9 1.4 1.9 3.3 2.2-1a7.4 7.4 0 0 0 2 1.2l.3 2.4h3.8l.3-2.4a7.4 7.4 0 0 0 2-1.2l2.2 1 1.9-3.3-1.9-1.4c.06-.4.1-.8.1-1.2Z" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S}>
      {paths[name] ?? paths.car}
    </svg>
  );
}

/** DRIVE247 wordmark — black word, red numerals, as in the reference. */
export function Wordmark({ className = "text-[15px]" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[.08em] text-[var(--ink)] ${className}`}>
      DRIVE<span className="text-[var(--red)]">247</span>
    </span>
  );
}
