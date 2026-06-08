/* global React, RA_DATA, Icon, StatusPill, CarMark, bentoTile, bentoBigNum */

const RA2 = window.RA_DATA;
const tileS2 = window.bentoTile;
const bigN2 = window.bentoBigNum;
const eb2 = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' };
const money2 = n => '$' + n.toLocaleString();

function StatTiles({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, height: 116, flexShrink: 0 }}>
      {items.map((s, i) => {
        const feat = s.tone === 'feature';
        return (
          <div key={i} style={{ borderRadius: 18, padding: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...(feat ? { background: 'var(--feature-bg)', color: 'var(--feature-fg)' } : tileS2) }}>
            <div style={{ ...eb2, color: feat ? 'var(--feature-sub)' : 'var(--text-3)' }}>{s.label}</div>
            <div style={{ ...bigN2, color: feat ? 'var(--feature-fg)' : 'var(--text)', fontSize: 30, marginTop: 'auto' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: feat ? 'var(--feature-sub)' : 'var(--text-3)', marginTop: 4, fontWeight: 600 }}>{s.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ================= FLEET ================= */
function BentoFleet() {
  const f = RA2.kpis.fleet;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatTiles items={[
        { label: 'Total vehicles', value: f.total, sub: `${f.pct}% utilized`, tone: 'feature' },
        { label: 'On rental', value: f.rented, sub: 'generating revenue' },
        { label: 'Available', value: f.available, sub: 'ready to book' },
        { label: 'Maintenance', value: f.maintenance, sub: '1 service due' },
      ]} />

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridAutoRows: '1fr', gap: 16, overflow: 'hidden' }}>
        {RA2.fleet.map((v, i) => (
          <div key={i} style={{ ...tileS2, padding: 16, gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <CarMark hue={v.hue} size={42} />
              <StatusPill status={v.status} dot />
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.02em' }}>{v.make} {v.model}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{v.year} · <span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{v.plate}</span></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 14 }}>
              <div>
                <span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>${v.rate}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>/day</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{v.next}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-3)', marginBottom: 5, fontWeight: 600, letterSpacing: '.04em' }}><span>UTILIZATION</span><span>{v.util}%</span></div>
              <div style={{ height: 6, borderRadius: 4, background: 'var(--tile-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${v.util || 3}%`, borderRadius: 4, background: v.status === 'Maintenance' ? 'var(--warn-accent)' : 'var(--primary)' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= CUSTOMERS ================= */
function Initials({ name, hue }) {
  const ini = name.split(' ').map(w => w[0]).slice(0, 2).join('');
  return <div style={{ width: 36, height: 36, borderRadius: 11, background: `hsl(${hue} 65% 92%)`, color: `hsl(${hue} 50% 40%)`, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, fontFamily: "'Sora',sans-serif", flexShrink: 0 }}>{ini}</div>;
}
function Stars({ r }) {
  if (!r) return <span style={{ fontSize: 12, color: 'var(--text-3)' }}>—</span>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}><Icon name="star" size={13} fill={true} style={{ color: 'var(--warn-accent)' }} />{r.toFixed(1)}</span>;
}

function BentoCustomers() {
  const th = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '12px 18px' };
  const td = { padding: '12px 18px', borderTop: '1px solid var(--tile-border)', fontSize: 13, color: 'var(--text-2)', verticalAlign: 'middle' };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatTiles items={[
        { label: 'Total customers', value: RA2.kpis.customers.toLocaleString(), sub: 'lifetime', tone: 'feature' },
        { label: 'New this month', value: RA2.kpis.newCustomers, sub: '▲ 12%' },
        { label: 'Repeat rate', value: '64%', sub: 'book again' },
        { label: 'Blocked', value: 1, sub: 'flagged customer' },
      ]} />

      <div style={{ ...tileS2, flex: 1, minHeight: 0, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
          <div style={{ ...eb2, color: 'var(--text-2)', fontSize: 13, textTransform: 'none', letterSpacing: 0, fontWeight: 700 }}>All customers</div>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>sorted by lifetime value</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--tile-2)' }}>
              <th style={th}>Customer</th><th style={{ ...th, textAlign: 'right' }}>Rentals</th>
              <th style={{ ...th, textAlign: 'right' }}>Lifetime value</th><th style={th}>Last rental</th>
              <th style={th}>Rating</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {RA2.customers.map((c, i) => (
                <tr key={i}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <Initials name={c.name} hue={c.hue} />
                      <div><div style={{ fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{c.contact}</div></div>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{c.rentals}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{money2(c.ltv)}</td>
                  <td style={{ ...td, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{c.last}</td>
                  <td style={td}><Stars r={c.rating} /></td>
                  <td style={td}><StatusPill status={c.status} dot /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BentoFleet, BentoCustomers });
