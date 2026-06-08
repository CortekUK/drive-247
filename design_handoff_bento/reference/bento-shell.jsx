/* global React, Icon */
// Bento rental-admin shell: slim glyph rail + header, plus shared tile atoms.

const RAIL = [
  { key: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { key: 'rentals',   icon: 'calendar',  label: 'Rentals' },
  { key: 'fleet',     icon: 'car',       label: 'Fleet' },
  { key: 'customers', icon: 'users',     label: 'Customers' },
  { key: 'payments',  icon: 'card',      label: 'Payments' },
  { key: 'fines',     icon: 'alert',     label: 'Fines' },
  { key: 'insurance', icon: 'shield',    label: 'Insurance' },
  { key: 'messages',  icon: 'chat',      label: 'Messages' },
  { key: 'reports',   icon: 'activity',  label: 'Reports' },
  { key: 'settings',  icon: 'settings',  label: 'Settings' },
];

// ---- shared style helpers (read CSS vars on app root) ----
const tile = { background: 'var(--tile)', border: '1px solid var(--tile-border)', borderRadius: 20, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const eyebrow = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' };
const bigNum = { fontFamily: "'Sora', sans-serif", fontWeight: 800, letterSpacing: '-0.04em', lineHeight: .95, color: 'var(--text)' };

function Eyebrow({ children, style }) { return <div style={{ ...eyebrow, ...style }}>{children}</div>; }

const ST = {
  Active: ['var(--green-weak)', 'var(--green)'], 'On rental': ['var(--green-weak)', 'var(--green)'],
  Verified: ['var(--green-weak)', 'var(--green)'], Upcoming: ['var(--info-weak)', 'var(--info)'],
  Available: ['var(--info-weak)', 'var(--info)'], Pending: ['var(--warn-bg)', 'var(--warn-accent)'],
  Maintenance: ['var(--warn-bg)', 'var(--warn-accent)'], Overdue: ['var(--danger-weak)', 'var(--danger-fg)'],
  Blocked: ['var(--danger-weak)', 'var(--danger-fg)'], Completed: ['var(--tile-2)', 'var(--text-3)'],
};
function StatusPill({ status, dot }) {
  const [bg, fg] = ST[status] || ['var(--tile-2)', 'var(--text-2)'];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color: fg, fontWeight: 700, fontSize: 11.5, padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
    {dot && <span style={{ width: 6, height: 6, borderRadius: 9, background: fg }} />}{status}</span>;
}

function CarMark({ hue, size = 44, radius = 12 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 42%)`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Icon name="car" size={size * 0.5} stroke={1.8} />
    </div>
  );
}

function Rail({ active, theme }) {
  return (
    <div style={{ width: 66, flexShrink: 0, background: 'var(--rail)', borderRight: '1px solid var(--rail-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0' }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--primary)', color: 'var(--primary-fg)', display: 'grid', placeItems: 'center', fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 16, marginBottom: 12 }}>D</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {RAIL.map(it => {
          const on = it.key === active;
          return (
            <div key={it.key} title={it.label} style={{ width: 42, height: 42, borderRadius: 13, display: 'grid', placeItems: 'center', color: on ? 'var(--primary-weak-fg)' : 'var(--text-3)', background: on ? 'var(--primary-weak)' : 'transparent', position: 'relative' }}>
              <Icon name={it.icon} size={20} stroke={on ? 2 : 1.7} />
            </div>
          );
        })}
      </div>
      <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', color: 'var(--text-3)', marginTop: 8 }}>
        <Icon name={theme.name === 'Dark' ? 'moon' : 'sun'} size={18} />
      </div>
      <div style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--tile-2)', color: 'var(--text-2)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, marginTop: 8, border: '1px solid var(--tile-border)' }}>DR</div>
    </div>
  );
}

function Header({ title, subtitle, eyebrowText, showRange, cta = 'New rental' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '20px 24px 16px', gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        {eyebrowText && <Eyebrow style={{ color: 'var(--primary-weak-fg)' }}>{eyebrowText}</Eyebrow>}
        <div style={{ ...bigNum, fontSize: 30, marginTop: 5 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 5 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 13px', borderRadius: 12, background: 'var(--tile)', border: '1px solid var(--tile-border)', color: 'var(--text-3)', fontSize: 13 }}>
          <Icon name="search" size={15} /><span>Search</span>
        </div>
        {showRange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 13px', borderRadius: 12, background: 'var(--tile)', border: '1px solid var(--tile-border)', color: 'var(--text-2)', fontSize: 13, fontWeight: 600 }}>
            <Icon name="calendar" size={15} />This month<Icon name="chevDown" size={14} />
          </div>
        )}
        <div style={{ position: 'relative', width: 38, height: 38, borderRadius: 12, background: 'var(--tile)', border: '1px solid var(--tile-border)', display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
          <Icon name="bell" size={17} /><span style={{ position: 'absolute', top: 8, right: 9, width: 6, height: 6, borderRadius: 9, background: 'var(--danger)' }} />
        </div>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: 'var(--primary-fg)', fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
          <Icon name="plus" size={16} />{cta}
        </button>
      </div>
    </div>
  );
}

function BentoApp({ theme, active, header, children }) {
  return (
    <div style={{ ...theme, height: '100%', display: 'flex', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Sora', system-ui, sans-serif", overflow: 'hidden', WebkitFontSmoothing: 'antialiased' }}>
      <Rail active={active} theme={theme} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header {...header} />
        <div style={{ flex: 1, minHeight: 0, padding: '0 24px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

Object.assign(window, { BentoApp, Eyebrow, StatusPill, CarMark, bentoTile: tile, bentoEyebrow: eyebrow, bentoBigNum: bigNum });
