/* global React, Icon */
// Reusable controls for the New Rental form. All read CSS vars from the themed root.
const { useState: useS, useRef: useR, useEffect: useE } = React;

const inputBase = {
  width: '100%', height: 46, borderRadius: 13, border: '1px solid var(--tile-border)',
  background: 'var(--tile-2)', color: 'var(--text)', padding: '0 14px', fontSize: 14,
  fontFamily: 'inherit', outline: 'none',
};
const errBorder = { borderColor: 'var(--danger)', boxShadow: '0 0 0 3px var(--danger-weak)' };

function Field({ label, req, error, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {label && (
        <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {label}{req && <span style={{ color: 'var(--danger)' }}>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span style={{ fontSize: 12, color: 'var(--danger-fg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="alert" size={13} />{error}</span>
      ) : hint ? <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{hint}</span> : null}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, error, icon, type = 'text' }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {icon && <span style={{ position: 'absolute', left: 13, color: 'var(--text-3)', display: 'flex' }}><Icon name={icon} size={16} /></span>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputBase, paddingLeft: icon ? 40 : 14, ...(error ? errBorder : {}) }} />
    </div>
  );
}

function Dropdown({ value, placeholder, options, onSelect, error, icon, searchable, renderValue }) {
  const [open, setOpen] = useS(false);
  const [q, setQ] = useS('');
  const cur = options.find(o => o.id === value);
  const list = searchable && q ? options.filter(o => (o.search || o.label).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} type="button"
        style={{ ...inputBase, ...(error ? errBorder : {}), display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', paddingLeft: icon ? 40 : 14, position: 'relative' }}>
        {icon && <span style={{ position: 'absolute', left: 13, color: 'var(--text-3)', display: 'flex' }}><Icon name={icon} size={16} /></span>}
        <span style={{ flex: 1, color: cur ? 'var(--text)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cur ? (renderValue ? renderValue(cur) : cur.label) : placeholder}
        </span>
        <Icon name="chevDown" size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 28 }} />
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, background: 'var(--tile)', border: '1px solid var(--tile-border)', borderRadius: 14, boxShadow: '0 18px 44px rgba(0,0,0,.22)', overflow: 'hidden', animation: 'rnPop .18s ease' }}>
          {searchable && (
            <div style={{ padding: 8, borderBottom: '1px solid var(--tile-border)' }}>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
                style={{ ...inputBase, height: 38, background: 'var(--tile-2)' }} />
            </div>
          )}
          <div style={{ maxHeight: 244, overflowY: 'auto', padding: 6 }}>
            {list.length === 0 && <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No matches</div>}
            {list.map(o => (
              <button key={o.id} type="button" onClick={() => { onSelect(o.id); setOpen(false); setQ(''); }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--tile-2)'}
                onMouseLeave={e => e.currentTarget.style.background = o.id === value ? 'var(--primary-weak)' : 'transparent'}
                style={{ width: '100%', textAlign: 'left', border: 'none', background: o.id === value ? 'var(--primary-weak)' : 'transparent', borderRadius: 10, padding: '9px 11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
                {o.node || <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o.label}</span>}
              </button>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}

function Segmented({ options, value, onChange, full }) {
  const refs = useR([]);
  const [ind, setInd] = useS({ left: 0, width: 0 });
  useE(() => { const el = refs.current[options.indexOf(value)]; if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth }); }, [value, options]);
  return (
    <div style={{ position: 'relative', display: full ? 'grid' : 'inline-flex', gridTemplateColumns: full ? `repeat(${options.length},1fr)` : undefined, gap: 2, background: 'var(--tile-2)', border: '1px solid var(--tile-border)', borderRadius: 13, padding: 4 }}>
      <div style={{ position: 'absolute', top: 4, bottom: 4, left: ind.left, width: ind.width, background: 'var(--tile)', borderRadius: 10, boxShadow: 'var(--shadow)', transition: 'left .36s cubic-bezier(.34,1.56,.64,1), width .36s cubic-bezier(.34,1.56,.64,1)' }} />
      {options.map((o, i) => (
        <button key={o} type="button" ref={el => refs.current[i] = el} onClick={() => onChange(o)}
          style={{ position: 'relative', zIndex: 1, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5, padding: '8px 13px', borderRadius: 10, color: value === o ? 'var(--text)' : 'var(--text-3)', transition: 'color .2s', whiteSpace: 'nowrap' }}>{o}</button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, size = 'md' }) {
  const w = size === 'sm' ? 42 : 50, h = size === 'sm' ? 25 : 29, k = h - 6;
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ width: w, height: h, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? 'var(--primary)' : 'var(--tile-border)', position: 'relative', transition: 'background-color .25s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? w - k - 3 : 3, width: k, height: k, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)', transition: 'left .28s cubic-bezier(.34,1.56,.64,1)' }} />
    </button>
  );
}

function Stepper({ value, onChange, min = 0 }) {
  const btn = { width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--tile-2)', color: 'var(--text)', fontSize: 18, fontWeight: 700, display: 'grid', placeItems: 'center' };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--tile-border)', borderRadius: 12, padding: 4, background: 'var(--tile)' }}>
      <button type="button" style={{ ...btn, opacity: value <= min ? .4 : 1 }} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 800, fontFamily: "'Sora',sans-serif", fontSize: 15, color: 'var(--text)' }}>{value}</span>
      <button type="button" style={btn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function Check({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ width: 22, height: 22, borderRadius: 7, border: on ? 'none' : '2px solid var(--tile-border)', background: on ? 'var(--primary)' : 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'background-color .15s' }}>
      {on && <Icon name="check" size={14} stroke={3} style={{ color: '#fff' }} />}
    </button>
  );
}

function SectionCard({ id, icon, num, title, desc, action, children, refCb }) {
  return (
    <div ref={refCb} id={id} style={{ background: 'var(--tile)', border: '1px solid var(--tile-border)', borderRadius: 22, boxShadow: 'var(--shadow)', overflow: 'visible', scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '18px 20px', borderBottom: '1px solid var(--tile-border)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--primary-weak)', color: 'var(--primary-weak-fg)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={19} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)' }}>{num}</span>
            <h3 style={{ margin: 0, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 16.5, letterSpacing: '-0.02em', color: 'var(--text)' }}>{title}</h3>
          </div>
          {desc && <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-3)' }}>{desc}</p>}
        </div>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

// ---- skeleton ----
function Sk({ w = '100%', h = 14, r = 7, style }) {
  return <div className="rnshimmer" style={{ width: w, height: h, borderRadius: r, background: 'var(--tile-2)', ...style }} />;
}
function SkCard() {
  return (
    <div style={{ background: 'var(--tile)', border: '1px solid var(--tile-border)', borderRadius: 22, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}><Sk w={38} h={38} r={12} /><div style={{ flex: 1 }}><Sk w={160} h={15} /><div style={{ height: 7 }} /><Sk w={220} h={11} /></div></div>
      <Sk h={46} r={13} /><Sk h={46} r={13} /><Sk w="60%" h={46} r={13} />
    </div>
  );
}

Object.assign(window, { Field, TextInput, Dropdown, Segmented, Toggle, Stepper, Check, SectionCard, Sk, SkCard, rnInputBase: inputBase });
