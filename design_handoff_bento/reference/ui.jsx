/* global React */
// Shared themed UI kit for the Drive247 admin mockups.
// All visuals read from CSS custom properties set by the active theme.

const I = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  arrowUp: '<circle cx="12" cy="12" r="9"/><path d="M12 16V8m0 0-3 3m3-3 3 3"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M14 8a4 4 0 0 1 0 8"/>',
  scroll: '<path d="M5 4h11a1 1 0 0 1 1 1v13a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2V5a1 1 0 0 0-1-1Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  sparkles: '<path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M5 18l.7 1.8L7.5 20.5 5.7 21.2 5 23l-.7-1.8L2.5 20.5l1.8-.7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5M21 20a6 6 0 0 0-4-5.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  car: '<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M4 13h16v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M7 16h.01M17 16h.01"/>',
  dollar: '<path d="M12 2v20M17 6.5C17 4.6 14.8 4 12.5 4 9.5 4 8 5.3 8 7c0 4.5 9 2.5 9 7 0 1.7-1.7 3-4.5 3-2.5 0-5-.8-5-3"/>',
  activity: '<path d="M3 12h4l2.5 7 5-15 2.5 8H21"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  download: '<path d="M12 4v10m0 0 4-4m-4 4-4-4"/><path d="M4 18h16"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  chat: '<path d="M21 12a7 7 0 0 1-7 7H8l-4 3V12a7 7 0 0 1 7-7h3a7 7 0 0 1 7 7Z"/>',
  file: '<path d="M6 2.5h7l5 5v14H6z"/><path d="M13 2.5v5h5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0-5 5L3 17v4h4l6.5-6.5a4 4 0 0 0 5-5l-2.8 2.8-2.2-.6-.6-2.2z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8M16 3l3 3-2 2-3-3M14 9l2 2"/>',
  pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z"/><circle cx="12" cy="11" r="2.2"/>',
  upload: '<path d="M12 16V5m0 0L8 9m4-4 4 4"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 15h2v2M19 14v3M16 19v1M19 20v-2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  gauge: '<path d="M12 14 16 9"/><path d="M4.5 18a8 8 0 1 1 15 0"/><circle cx="12" cy="14" r="1.6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M8.5 8h7M8.5 12h7"/>',
  userPlus: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 11.3-2.8"/><path d="M18 8.5v5M15.5 11h5"/>',
  tag: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
};

function Icon({ name, size = 16, stroke = 1.7, fill = false, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: I[name] || '' }} />
  );
}

const TONE = {
  success: ['var(--success-weak)', 'var(--success)'],
  warning: ['var(--warning-weak)', 'var(--warning)'],
  danger:  ['var(--danger-weak)',  'var(--danger)'],
  info:    ['var(--info-weak)',     'var(--info)'],
  primary: ['var(--primary-weak)',  'var(--primary-weak-fg)'],
  neutral: ['var(--surface-2)',     'var(--text-2)'],
};

function Pill({ tone = 'neutral', children, dot = false }) {
  const [bg, fg] = TONE[tone] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: bg, color: fg, fontWeight: 600,
      fontSize: 11.5, lineHeight: 1, padding: '4px 8px',
      borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: fg }} />}
      {children}
    </span>
  );
}

function ModeTag({ mode }) {
  return <Pill tone={mode === 'Live' ? 'success' : 'warning'} dot>{mode}</Pill>;
}

function StatusTag({ status }) {
  const map = { Active: 'success', Onboarding: 'warning', Suspended: 'danger', Upcoming: 'info', Completed: 'neutral' };
  return <Pill tone={map[status] || 'neutral'}>{status}</Pill>;
}

function Avatar({ code, hue = 250, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--radius-sm)',
      background: `hsl(${hue} 55% 95%)`, color: `hsl(${hue} 48% 42%)`,
      display: 'grid', placeItems: 'center', flexShrink: 0,
      fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: size * 0.36,
      letterSpacing: '-0.02em', border: '1px solid var(--border)',
    }}>{code}</div>
  );
}

function fmtMoney(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k';
  return '$' + n.toLocaleString();
}

function KpiCard({ label, value, delta, deltaTone = 'success', sub, icon }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: 'calc(16px * var(--density))',
      boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
        {icon && <span style={{ color: 'var(--primary)', opacity: .85, display: 'flex' }}><Icon name={icon} size={16} /></span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 'var(--head-weight)', fontSize: 28, letterSpacing: 'var(--head-tracking)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        {delta && <span style={{ fontSize: 12.5, fontWeight: 600, color: deltaTone === 'success' ? 'var(--success)' : 'var(--danger)' }}>{delta}</span>}
      </div>
      {sub && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sub}</span>}
    </div>
  );
}

function Panel({ title, action, children, pad = true, style }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-head)', fontWeight: 'var(--head-weight)', fontSize: 14.5, letterSpacing: 'var(--head-tracking)', color: 'var(--text)' }}>{title}</h3>
          {action}
        </div>
      )}
      <div style={{ padding: pad ? 16 : 0, flex: 1 }}>{children}</div>
    </div>
  );
}

// ---- Charts (pure SVG) ----
function AreaChart({ data, w = 520, h = 150, labels }) {
  const max = Math.max(...data) * 1.08, min = Math.min(...data) * 0.85;
  const pad = 6;
  const x = i => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = v => h - 18 - ((v - min) / (max - min)) * (h - 30);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${h - 18} L${pad} ${h - 18} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <line key={i} x1={pad} x2={w - pad} y1={(h - 18) * t} y2={(h - 18) * t} stroke="var(--chart-grid)" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#gA)" />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => i === data.length - 1 && (
        <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />
      ))}
      {labels && labels.map((l, i) => (i % 2 === 0) && (
        <text key={i} x={x(i)} y={h - 4} fontSize="9" fill="var(--text-3)" textAnchor="middle" fontFamily="var(--font-mono)">{l}</text>
      ))}
    </svg>
  );
}

function BarMini({ items, w = 300, h = 150 }) {
  const max = Math.max(...items.map(d => d.v)) * 1.1;
  const bw = (w) / items.length;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {items.map((d, i) => {
        const bh = (d.v / max) * (h - 24);
        return (
          <g key={i}>
            <rect x={i * bw + bw * 0.2} y={h - 18 - bh} width={bw * 0.6} height={bh} rx="3" fill="var(--primary)" opacity={0.35 + 0.65 * (d.v / max)} />
            <text x={i * bw + bw * 0.5} y={h - 5} fontSize="9" fill="var(--text-3)" textAnchor="middle" fontFamily="var(--font-mono)">{d.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ value, size = 116, label }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 'var(--head-weight)', fontSize: 24, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}%</div>
          {label && <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{label}</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Pill, ModeTag, StatusTag, Avatar, KpiCard, Panel, AreaChart, BarMini, Donut, fmtMoney });
