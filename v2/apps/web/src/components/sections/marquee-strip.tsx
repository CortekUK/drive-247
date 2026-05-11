const ITEMS = [
  "PICK UP ANYTIME",
  "NO COUNTER LINES",
  "NO HIDDEN FEES",
  "100% TRANSPARENCY",
  "DRIVING THE MOVE",
];

export function MarqueeStrip() {
  const repeated = [...ITEMS, ...ITEMS, ...ITEMS];

  return (
    <div className="overflow-hidden bg-brand-cream py-[16px] text-brand-text">
      <div className="marquee-track flex w-max items-center whitespace-nowrap">
        {repeated.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="inline-flex items-center text-sm font-semibold uppercase tracking-[0.14em]"
          >
            {item}
            <span className="mx-6 text-brand-text/45">•</span>
          </span>
        ))}
      </div>
    </div>
  );
}
