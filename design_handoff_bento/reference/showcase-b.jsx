/* global React, Icon */
// Design System Showcase — part B. Exports to window.RN_SHOW_B.
const { useState: uSb, useEffect: uEb } = React;
const tintB = (pct) => `color-mix(in srgb, var(--primary) ${pct}%, transparent)`;
const monoB = "'IBM Plex Mono',monospace";

/* 8 — Natural-language search */
function NLSearch() {
  const full = 'active Teslas due back this week';
  const [typed, setTyped] = uSb('');
  uEb(() => { let i = 0; const id = setInterval(() => { i++; setTyped(full.slice(0, i)); if (i >= full.length) clearInterval(id); }, 55); return () => clearInterval(id); }, []);
  const chips = [['Status', 'Active'], ['Make', 'Tesla'], ['Window', 'This week']];
  const done = typed.length >= full.length;
  return <div className="g" style={{ padding: 16, borderRadius: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 14px', borderRadius: 13, background: 'var(--glass-2)', border: '1px solid var(--glass-bd)' }}>
      <Icon name="sparkles" size={17} style={{ color: 'var(--primary)' }} />
      <span style={{ fontSize: 14, color: 'var(--text)' }}>{typed}<span style={{ opacity: done ? 0 : 1, color: 'var(--primary)' }}>|</span></span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, opacity: done ? 1 : 0, transition: 'opacity .3s', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Parsed:</span>
      {chips.map((c, i) => <span key={i} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--primary)', background: tintB(13), borderRadius: 999, padding: '4px 10px' }}>{c[0]}: {c[1]}</span>)}
      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>3 results</span>
    </div>
  </div>;
}

/* 9 — Density toggle */
function DensityDemo() {
  const [dense, setDense] = uSb(false);
  const rows = [['Marcus Webb', 'BMW X5', '$1,240'], ['Nina Park', 'Porsche Macan', '$2,100'], ['Aisha Bello', 'Mercedes EQE', '$1,850']];
  const py = dense ? 7 : 13;
  return <div className="g" style={{ padding: 0, borderRadius: 18, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--glass-bd)' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Recent rentals</span>
      <div style={{ display: 'inline-flex', gap: 2, background: 'var(--glass-2)', borderRadius: 10, padding: 3 }}>
        {[['Comfortable', false], ['Compact', true]].map(([l, val]) => <button key={l} onClick={() => setDense(val)} style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', background: dense === val ? 'var(--tile)' : 'transparent', color: dense === val ? 'var(--text)' : 'var(--text-3)' }}>{l}</button>)}
      </div>
    </div>
    {rows.map((r, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${py}px 16px`, borderTop: i ? '1px solid var(--glass-bd)' : 'none', transition: 'padding .25s' }}>
      <span style={{ width: dense ? 26 : 32, height: dense ? 26 : 32, borderRadius: 9, background: tintB(13), color: 'var(--primary)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: dense ? 10 : 12, transition: 'all .25s' }}>{r[0].split(' ').map(w => w[0]).join('')}</span>
      <span style={{ flex: 1, fontSize: dense ? 12.5 : 13.5, fontWeight: 600, color: 'var(--text)' }}>{r[0]}</span>
      <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{r[1]}</span>
      <span style={{ fontFamily: monoB, fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{r[2]}</span>
    </div>)}
  </div>;
}

/* 10 — Empty / Error / Skeleton states */
function StatesDemo() {
  const Frame = ({ label, children }) => <div className="g" style={{ padding: 0, borderRadius: 16, overflow: 'hidden' }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '10px 14px', borderBottom: '1px solid var(--glass-bd)' }}>{label}</div><div style={{ padding: 18, minHeight: 150, display: 'grid', placeItems: 'center' }}>{children}</div></div>;
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
    <Frame label="Empty">
      <div style={{ textAlign: 'center' }}><div style={{ width: 48, height: 48, borderRadius: 14, background: tintB(13), color: 'var(--primary)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Icon name="calendar" size={24} /></div><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>No rentals yet</div><div style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 12px' }}>Create your first booking.</div><button className="lgbtn lgbtn-p" style={{ height: 34, fontSize: 12.5 }}><Icon name="plus" size={14} />New rental</button></div>
    </Frame>
    <Frame label="Error">
      <div style={{ textAlign: 'center' }}><div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--danger-weak)', color: 'var(--danger-fg)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Icon name="alert" size={24} /></div><div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Couldn't load</div><div style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 12px' }}>Check your connection.</div><button className="lgbtn" style={{ height: 34, fontSize: 12.5 }}><Icon name="arrowRight" size={14} />Retry</button></div>
    </Frame>
    <Frame label="Loading">
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1, 2].map(i => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div className="shim" style={{ width: 34, height: 34, borderRadius: 9 }} /><div style={{ flex: 1 }}><div className="shim" style={{ height: 11, borderRadius: 6, width: '70%' }} /><div style={{ height: 7 }} /><div className="shim" style={{ height: 9, borderRadius: 6, width: '45%' }} /></div></div>)}</div>
    </Frame>
  </div>;
}

/* 11 — Undo toast */
function UndoToast({ fire }) {
  return <div className="g" style={{ padding: 18, borderRadius: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>Safer destructive actions</div><div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Delete fires a toast with a 5s Undo — no blocking confirm dialog.</div></div>
    <button className="lgbtn" onClick={fire} style={{ color: 'var(--danger-fg)' }}><Icon name="x" size={15} />Cancel rental</button>
  </div>;
}

/* 12 — Customizable bento */
function CustomBento() {
  const [edit, setEdit] = uSb(false);
  const tiles = [['Revenue', 2], ['Active', 1], ['Fleet', 1], ['Overdue', 1], ['Customers', 1], ['Schedule', 2]];
  return <div className="g" style={{ padding: 16, borderRadius: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Your dashboard</span>
      <button className="lgbtn" onClick={() => setEdit(e => !e)} style={{ height: 32, fontSize: 12 }}><Icon name={edit ? 'check' : 'pencil'} size={13} />{edit ? 'Done' : 'Edit layout'}</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
      {tiles.map((t, i) => <div key={i} style={{ gridColumn: 'span ' + t[1], height: 56, borderRadius: 13, background: 'var(--glass-2)', border: edit ? '1.5px dashed ' + tintB(50) : '1px solid var(--glass-bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', cursor: edit ? 'grab' : 'default', animation: edit ? `wiggle .4s ${i * 0.05}s ease-in-out infinite alternate` : 'none' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{t[0]}</span>
        {edit && <Icon name="grid" size={14} style={{ color: 'var(--text-3)' }} />}
      </div>)}
    </div>
  </div>;
}

window.RN_SHOW_B = { NLSearch, DensityDemo, StatesDemo, UndoToast, CustomBento };
