/* global React, Icon */
// Design System Showcase — part A. Compact glass-Bento demos. Exports to window.RN_SHOW_A.
const { useState: uS, useEffect: uE, useRef: uR } = React;

function useCount(target, dur = 950) {
  const [v, setV] = uS(0);
  uE(() => { let raf; const t0 = performance.now(); const step = t => { const p = Math.min(1, (t - t0) / dur); setV(target * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf); }, [target]);
  return v;
}
const tint = (pct) => `color-mix(in srgb, var(--primary) ${pct}%, transparent)`;
const mono = "'IBM Plex Mono',monospace";

/* 1 — Command palette (⌘K) */
function CommandPalette() {
  const [open, setOpen] = uS(false);
  const [q, setQ] = uS('');
  uE(() => { const h = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); } if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const groups = [
    ['Actions', [['plus', 'New rental'], ['key', 'Hand over keys'], ['send', 'Send agreement']]],
    ['Go to', [['dashboard', 'Dashboard'], ['car', 'Fleet'], ['users', 'Customers']]],
    ['Recent', [['file', 'Rental #RT-1043 · Marcus Webb'], ['file', 'Rental #RT-1039 · Nina Park']]],
  ];
  return (
    <div style={{ position: 'relative', minHeight: 230 }}>
      <button className="lgbtn" onClick={() => setOpen(true)} style={{ gap: 9 }}><Icon name="search" size={15} />Search or run a command<span style={{ marginLeft: 8, fontSize: 11, fontFamily: mono, background: 'var(--glass-2)', borderRadius: 6, padding: '2px 7px', color: 'var(--text-3)' }}>⌘K</span></button>
      {open && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'start center', paddingTop: 8, zIndex: 5 }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: -20, background: 'rgba(10,8,24,.28)', backdropFilter: 'blur(3px)' }} />
          <div className="g" style={{ position: 'relative', width: '100%', maxWidth: 380, borderRadius: 18, overflow: 'hidden', animation: 'pop .25s cubic-bezier(.34,1.56,.64,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--glass-bd)' }}>
              <Icon name="search" size={17} style={{ color: 'var(--primary)' }} />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command or search…" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }} />
              <span style={{ fontSize: 10.5, fontFamily: mono, color: 'var(--text-3)', border: '1px solid var(--glass-bd)', borderRadius: 6, padding: '2px 6px' }}>ESC</span>
            </div>
            <div style={{ maxHeight: 250, overflowY: 'auto', padding: 8 }}>
              {groups.map(([g, items]) => (
                <div key={g} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '6px 8px 4px' }}>{g}</div>
                  {items.map(([ic, label], i) => (
                    <div key={i} className="cmd-row" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', color: 'var(--text)' }}>
                      <Icon name={ic} size={16} style={{ color: 'var(--text-3)' }} /><span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{label}</span><Icon name="arrowRight" size={14} style={{ color: 'var(--text-3)' }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 2 — Animated KPIs + sparklines */
function KpiAnimated() {
  const data = [[284910, 'Revenue · MTD', '+14%', [3, 4, 3, 5, 5, 7, 8, 9]], [1284, 'Active rentals', '+8%', [4, 5, 4, 6, 7, 6, 8, 9]], [78, 'Utilization %', '', [6, 7, 6, 7, 8, 7, 8, 7]]];
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>{data.map((d, i) => <KpiTile key={i} {...{ target: d[0], label: d[1], delta: d[2], spark: d[3], pct: i === 2 }} />)}</div>;
}
function KpiTile({ target, label, delta, spark, pct }) {
  const v = useCount(target);
  const max = Math.max(...spark), min = Math.min(...spark);
  const pts = spark.map((s, i) => `${(i / (spark.length - 1)) * 100},${28 - ((s - min) / (max - min || 1)) * 24}`).join(' ');
  return <div className="g" style={{ padding: 16, borderRadius: 18 }}>
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
      <div>
        <div style={{ fontFamily: "'Sora'", fontWeight: 800, fontSize: 25, letterSpacing: '-0.03em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{pct ? Math.round(v) + '%' : (target >= 1000 ? '$' + Math.round(v).toLocaleString() : Math.round(v).toLocaleString())}</div>
        {delta && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>{delta}</div>}
      </div>
      <svg width="84" height="30" style={{ overflow: 'visible' }}><polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 300, strokeDashoffset: 300, animation: 'draw 1.1s .2s ease forwards' }} /></svg>
    </div>
  </div>;
}

/* 3 — Availability heatmap */
function Heatmap() {
  const cars = ['Tesla M3', 'BMW X3', 'RAV4', 'Wrangler', 'Audi A4'];
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const seed = (r, c) => { const x = Math.sin(r * 12.9 + c * 78.2) * 43758.5; const f = x - Math.floor(x); return f < 0.42 ? 0 : f < 0.62 ? 1 : 2; }; // 0 free,1 booked,2 hold
  const col = s => s === 1 ? 'var(--primary)' : s === 2 ? tint(45) : 'var(--glass-2)';
  return <div className="g" style={{ padding: 16, borderRadius: 18 }}>
    <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(14, 1fr)`, gap: 4, alignItems: 'center' }}>
      <div />{days.map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9.5, color: 'var(--text-3)', fontWeight: 600 }}>{d}</div>)}
      {cars.map((c, r) => <React.Fragment key={r}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{c}</div>
        {days.map((_, cI) => { const s = seed(r, cI); return <div key={cI} title={['Free', 'Booked', 'Hold'][s]} style={{ height: 20, borderRadius: 5, background: col(s), opacity: s === 0 ? 1 : 0.9, transition: 'transform .15s', cursor: 'pointer' }} className="heat-cell" />; })}
      </React.Fragment>)}
    </div>
    <div style={{ display: 'flex', gap: 16, marginTop: 13, fontSize: 11, color: 'var(--text-3)' }}>
      <Lg c="var(--glass-2)" t="Free" /><Lg c="var(--primary)" t="Booked" /><Lg c={tint(45)} t="Hold" />
    </div>
  </div>;
}
function Lg({ c, t }) { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 4, background: c }} />{t}</span>; }

/* 4 — Lifecycle timeline */
function Lifecycle() {
  const steps = [['calendar', 'Booked'], ['file', 'Signed'], ['key', 'Keys out'], ['car', 'Active'], ['checkCircle', 'Returned']];
  const cur = 3;
  return <div className="g" style={{ padding: '24px 20px', borderRadius: 18 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
      {steps.map(([ic, label], i) => {
        const done = i < cur, active = i === cur;
        return <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
          {i < steps.length - 1 && <div style={{ position: 'absolute', top: 19, left: '50%', right: '-50%', height: 3, background: i < cur ? 'var(--primary)' : 'var(--glass-bd)', borderRadius: 2 }} />}
          <div style={{ width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', position: 'relative', zIndex: 1, background: done || active ? 'var(--primary)' : 'var(--glass-2)', color: done || active ? '#fff' : 'var(--text-3)', boxShadow: active ? '0 0 0 5px ' + tint(22) : 'none', animation: active ? 'pulse 2s ease-in-out infinite' : 'none' }}><Icon name={done ? 'check' : ic} size={18} stroke={done ? 3 : 2} /></div>
          <div style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: done || active ? 'var(--text)' : 'var(--text-3)', marginTop: 9 }}>{label}</div>
        </div>;
      })}
    </div>
  </div>;
}

/* 5 — Bookings kanban */
function Kanban() {
  const cols = [['Upcoming', 'info', [['Nina Park', 'Porsche Macan', 'Jun 5'], ['Devon Clarke', 'Tesla M3', 'Jun 4']]], ['Active', 'ok', [['Marcus Webb', 'BMW X5', '4d left'], ['Aisha Bello', 'Mercedes EQE', '5d left']]], ['Overdue', 'danger', [['Carlos Mendez', 'Malibu', '2d over']]], ['Completed', 'neutral', [['Priya Nair', 'RAV4', 'Jun 2']]]];
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
    {cols.map(([title, tone, cards], ci) => (
      <div key={ci} style={{ background: 'var(--glass-2)', borderRadius: 16, padding: 10, minHeight: 150 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px 9px' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{title}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)' }}>{cards.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cards.map((c, i) => <div key={i} className="g kan" style={{ padding: 11, borderRadius: 12, cursor: 'grab' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{c[0]}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{c[1]}</div>
            <div style={{ display: 'inline-block', marginTop: 7, fontSize: 10.5, fontWeight: 700, color: 'var(--' + (tone === 'danger' ? 'danger-fg' : tone === 'ok' ? 'green' : tone === 'info' ? 'info' : 'text-3') + ')', background: 'var(--' + (tone === 'danger' ? 'danger-weak' : tone === 'ok' ? 'green-weak' : tone === 'info' ? 'info-weak' : 'glass-2') + ')', borderRadius: 999, padding: '3px 8px' }}>{c[2]}</div>
          </div>)}
        </div>
      </div>
    ))}
  </div>;
}

/* 6 — Map panel */
function MapPanel() {
  const pins = [[20, 58], [40, 42], [50, 70], [66, 55], [76, 76], [82, 36]];
  return <div className="g" style={{ padding: 0, borderRadius: 18, overflow: 'hidden', height: 220, position: 'relative' }}>
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 100% at 50% 0%, ' + tint(16) + ', transparent)' }} />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {[20, 40, 60, 80].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--glass-bd)" strokeWidth="0.2" />)}
      {[20, 40, 60, 80].map(x => <line key={x} x1={x} x2={x} y1="0" y2="100" stroke="var(--glass-bd)" strokeWidth="0.2" />)}
      <path d="M10,52 C16,38 34,32 50,32 C66,32 84,36 88,48 C90,60 84,72 68,78 C52,82 30,84 18,72 C10,64 8,58 10,52 Z" fill={tint(10)} stroke={tint(30)} strokeWidth="0.3" />
    </svg>
    {pins.map((p, i) => <div key={i} style={{ position: 'absolute', left: p[0] + '%', top: p[1] + '%', transform: 'translate(-50%,-50%)' }}><div style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--primary)', border: '2px solid #fff', boxShadow: '0 0 0 4px ' + tint(22) }} /></div>)}
    <div className="g" style={{ position: 'absolute', bottom: 12, left: 12, borderRadius: 14, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' }}>On the road now</div>
      <div style={{ fontFamily: "'Sora'", fontWeight: 800, fontSize: 18, color: 'var(--text)', marginTop: 3 }}>6 active pickups</div>
    </div>
  </div>;
}

/* 7 — AI insight cards */
function Insights({ onAct }) {
  const items = [['alert', 'danger', '4 rentals are overdue', '$3,240 outstanding · send payment reminders?', 'Send reminders'], ['sparkles', 'primary', 'Utilization is up 12%', 'Consider raising weekend rates on SUVs.', 'Review pricing'], ['shield', 'warn', '2 insurance docs expire soon', 'Ask customers to re-upload before pickup.', 'Notify customers']];
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{items.map((it, i) => (
    <div key={i} className="g" style={{ padding: 16, borderRadius: 16, display: 'flex', gap: 13, alignItems: 'center' }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: it[1] === 'danger' ? 'var(--danger-weak)' : it[1] === 'warn' ? 'var(--warn-bg)' : tint(14), color: it[1] === 'danger' ? 'var(--danger-fg)' : it[1] === 'warn' ? 'var(--warn-accent)' : 'var(--primary)' }}><Icon name={it[0]} size={20} /></div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{it[2]}</div><div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{it[3]}</div></div>
      <button className="lgbtn lgbtn-p" onClick={() => onAct(it[4] + ' ✓')} style={{ height: 36, fontSize: 12.5, flexShrink: 0 }}>{it[4]}</button>
    </div>
  ))}</div>;
}

window.RN_SHOW_A = { CommandPalette, KpiAnimated, Heatmap, Lifecycle, Kanban, MapPanel, Insights };
