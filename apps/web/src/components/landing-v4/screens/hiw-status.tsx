import "./hiw-status.css";

/*
 * The handset's own status bar (time, signal, Wi-Fi, battery) for the
 * "How it works" phone screens. This is the phone, not the product: it only
 * sits above each page the way a real phone draws it, clear of the island.
 * Integer SVG coordinates only, so server and client render identically.
 */
export function HiwStatus({ time = "10:00", tone = "light" }: { time?: string; tone?: "light" | "dark" }) {
  return (
    <div className={`hiw-sb hiw-sb-${tone}`} aria-hidden="true">
      <span className="hiw-sb-t">{time}</span>
      <span className="hiw-sb-i">
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5" width="3" height="7" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" width="16" height="12">
          <path d="M8 12 L5 8.5 A4.6 4.6 0 0 1 11 8.5 Z" />
          <path d="M2.6 6.2 A7.8 7.8 0 0 1 13.4 6.2" fill="none" strokeWidth="2" strokeLinecap="round" />
          <path d="M0.4 3.4 A11 11 0 0 1 15.6 3.4" fill="none" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="hiw-sb-bat">
          <i />
        </span>
      </span>
    </div>
  );
}
