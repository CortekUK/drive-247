/* global React, RA_DATA, AreaChart, Donut, Icon, BentoApp, Eyebrow, StatusPill, CarMark, bentoTile, bentoBigNum */

const RA = window.RA_DATA;
const tileS = window.bentoTile;
const bigN = window.bentoBigNum;
const eb = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' };
const money = n => '$' + n.toLocaleString();

function actIcon(k) { return { pay: 'card', book: 'calendar', insure: 'shield', overdue: 'alert', sign: 'file' }[k] || 'dot'; }
function actColor(k) { return { pay: 'var(--green)', book: 'var(--primary)', insure: 'var(--info)', overdue: 'var(--danger-fg)', sign: 'var(--text-2)' }[k] || 'var(--text-3)'; }

/* ================= DASHBOARD ================= */
function BentoDashboard() {
  const k = RA.kpis;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gridTemplateRows: 'repeat(3,1fr)', gap: 16 }}>
      {/* hero revenue */}
      <div style={{ gridColumn: '1 / 3', gridRow: '1 / 3', borderRadius: 22, padding: 24, background: 'var(--hero-grad)', color: '#fff', boxShadow: 'var(--hero-shadow)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ ...eb, color: 'rgba(255,255,255,.75)' }}>Revenue · this month</div>
          <span style={{ fontSize: 12.5, fontWeight: 800, background: 'rgba(255,255,255,.2)', borderRadius: 999, padding: '5px 11px' }}>▲ {k.revenueDelta.replace('+','')}</span>
        </div>
        <div style={{ ...bigN, color: '#fff', fontSize: 66, margin: '12px 0 2px' }}>{money(k.monthlyRevenue)}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.82)' }}>{money(11420)} collected this week · {money(2430)} outstanding</div>
        <div style={{ marginTop: 'auto', '--primary': '#fff', '--chart-grid': 'rgba(255,255,255,.18)', '--surface': 'transparent' }}>
          <AreaChart data={RA.revTrend} labels={RA.revLabels} w={520} h={150} />
        </div>
      </div>

      {/* active rentals (feature/dark) */}
      <div style={{ gridColumn: '3', gridRow: '1', borderRadius: 20, padding: 20, background: 'var(--feature-bg)', color: 'var(--feature-fg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ ...eb, color: 'var(--feature-sub)' }}>Active rentals</div>
        <div style={{ ...bigN, color: 'var(--feature-fg)', fontSize: 40, marginTop: 'auto' }}>{k.activeRentals}</div>
        <div style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 700, marginTop: 6 }}>▲ {k.activeDelta} this week</div>
      </div>

      {/* fleet util donut */}
      <div style={{ ...tileS, gridColumn: '4', gridRow: '1', padding: 18, alignItems: 'center' }}>
        <div style={{ ...eb, alignSelf: 'flex-start' }}>Fleet utilization</div>
        <div style={{ margin: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}><Donut value={k.fleet.pct} size={104} label="in use" /></div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', alignSelf: 'center' }}>{k.fleet.rented} on rental · {k.fleet.available} free</div>
      </div>

      {/* due today */}
      <div style={{ ...tileS, gridColumn: '3', gridRow: '2', padding: 20 }}>
        <div style={eb}>Due today</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto' }}>
          <span style={{ ...bigN, fontSize: 38 }}>{k.dueToday.returns}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>returns</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>{k.dueToday.pickups} pickups · {money(k.dueToday.amount)} expected</div>
      </div>

      {/* needs attention (warn) */}
      <div style={{ gridColumn: '4', gridRow: '2', borderRadius: 20, padding: 20, background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ ...eb, color: 'var(--warn-accent)' }}>Needs attention</div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn-fg)', fontSize: 13.5, fontWeight: 600 }}>
            <Icon name="alert" size={15} /><span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 18 }}>{RA.kpis.overdue.count}</span> overdue · {money(RA.kpis.overdue.amount)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn-fg)', fontSize: 13.5, fontWeight: 600 }}>
            <Icon name="card" size={15} /><span style={{ fontFamily: "'Sora',sans-serif", fontWeight: 800, fontSize: 18 }}>{RA.kpis.fines.count}</span> fines · {money(RA.kpis.fines.amount)}
          </div>
        </div>
      </div>

      {/* today's schedule */}
      <div style={{ ...tileS, gridColumn: '1 / 3', gridRow: '3', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 10px' }}>
          <div style={eb}>Today's schedule</div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--primary-weak-fg)' }}>View calendar →</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {RA.schedule.slice(0, 4).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px', borderTop: '1px solid var(--tile-border)' }}>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: 'var(--text-2)', width: 42 }}>{s.time}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: s.type === 'Pickup' ? 'var(--info)' : 'var(--primary-weak-fg)', background: s.type === 'Pickup' ? 'var(--info-weak)' : 'var(--primary-weak)', borderRadius: 999, padding: '3px 8px', width: 58, textAlign: 'center' }}>{s.type}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.who}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{s.car} · {s.plate}</div>
              </div>
              <Icon name="chevRight" size={16} style={{ color: 'var(--text-3)' }} />
            </div>
          ))}
        </div>
      </div>

      {/* recent activity */}
      <div style={{ ...tileS, gridColumn: '3', gridRow: '3', padding: 0 }}>
        <div style={{ ...eb, padding: '16px 16px 8px' }}>Recent activity</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {RA.activity.slice(0, 4).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, padding: '7px 16px', alignItems: 'flex-start', borderTop: '1px solid var(--tile-border)' }}>
              <span style={{ color: actColor(a.kind), marginTop: 1, display: 'flex' }}><Icon name={actIcon(a.kind)} size={14} /></span>
              <div style={{ flex: 1, fontSize: 12, lineHeight: 1.35, color: 'var(--text-2)' }}><span style={{ fontWeight: 700, color: 'var(--text)' }}>{a.who}</span> {a.what}</div>
            </div>
          ))}
        </div>
      </div>

      {/* action items */}
      <div style={{ ...tileS, gridColumn: '4', gridRow: '3', padding: 0 }}>
        <div style={{ ...eb, padding: '16px 16px 8px' }}>Action items</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {RA.actions.slice(0, 4).map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px', borderTop: '1px solid var(--tile-border)' }}>
              <span style={{ minWidth: 22, height: 20, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: a.tone === 'danger' ? 'var(--danger-fg)' : a.tone === 'warning' ? 'var(--warn-accent)' : 'var(--info)', background: a.tone === 'danger' ? 'var(--danger-weak)' : a.tone === 'warning' ? 'var(--warn-bg)' : 'var(--info-weak)' }}>{a.count}</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.3 }}>{a.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= RENTALS ================= */
function BentoRentals() {
  const k = RA.kpis;
  const stats = [
    { label: 'Active', value: k.activeRentals, sub: 'on the road', tone: 'feature' },
    { label: 'Due today', value: k.dueToday.returns, sub: `${k.dueToday.pickups} pickups`, tone: 'tile' },
    { label: 'Overdue', value: k.overdue.count, sub: money(k.overdue.amount), tone: 'warn' },
    { label: 'Revenue · MTD', value: money(k.monthlyRevenue), sub: k.revenueDelta, tone: 'tile' },
  ];
  const th = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '12px 18px' };
  const td = { padding: '13px 18px', borderTop: '1px solid var(--tile-border)', fontSize: 13, color: 'var(--text-2)', verticalAlign: 'middle' };
  const tabs = ['All', 'Active', 'Upcoming', 'Overdue', 'Completed'];
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, height: 116, flexShrink: 0 }}>
        {stats.map((s, i) => {
          const feat = s.tone === 'feature', warn = s.tone === 'warn';
          return (
            <div key={i} style={{ borderRadius: 18, padding: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column',
              ...(feat ? { background: 'var(--feature-bg)', color: 'var(--feature-fg)' } : warn ? { background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' } : tileS) }}>
              <div style={{ ...eb, color: feat ? 'var(--feature-sub)' : warn ? 'var(--warn-accent)' : 'var(--text-3)' }}>{s.label}</div>
              <div style={{ ...bigN, color: feat ? 'var(--feature-fg)' : warn ? 'var(--warn-fg)' : 'var(--text)', fontSize: 30, marginTop: 'auto' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: feat ? 'var(--feature-sub)' : warn ? 'var(--warn-accent)' : 'var(--text-3)', marginTop: 4, fontWeight: 600 }}>{s.sub}</div>
            </div>
          );
        })}
      </div>

      <div style={{ ...tileS, flex: 1, minHeight: 0, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
          <div style={{ display: 'inline-flex', gap: 4, background: 'var(--tile-2)', borderRadius: 12, padding: 4 }}>
            {tabs.map((t, i) => (
              <span key={t} style={{ fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 9, cursor: 'pointer', background: i === 0 ? 'var(--tile)' : 'transparent', color: i === 0 ? 'var(--text)' : 'var(--text-3)', boxShadow: i === 0 ? 'var(--shadow)' : 'none' }}>{t}</span>
            ))}
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{RA.rentals.length} rentals</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--tile-2)' }}>
              <th style={th}>Customer</th><th style={th}>Vehicle</th><th style={th}>Pickup → Return</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th><th style={{ ...th, textAlign: 'right' }}>Balance</th>
              <th style={th}>Insurance</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {RA.rentals.map((r, i) => {
                const bal = r.total - r.paid;
                return (
                  <tr key={i}>
                    <td style={td}><span style={{ fontWeight: 700, color: 'var(--text)' }}>{r.customer}</span></td>
                    <td style={td}>{r.car}<div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono',monospace" }}>{r.plate}</div></td>
                    <td style={{ ...td, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}>{r.from} → {r.to} <span style={{ color: 'var(--text-3)' }}>· {r.days}d</span></td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{money(r.total)}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: bal > 0 ? 'var(--danger-fg)' : 'var(--green)', fontWeight: 700 }}>{bal > 0 ? money(bal) : 'Paid'}</td>
                    <td style={td}>{r.insured ? <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600 }}><Icon name="checkCircle" size={14} />Verified</span> : <span style={{ color: 'var(--warn-accent)', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600 }}><Icon name="alert" size={13} />Missing</span>}</td>
                    <td style={td}><StatusPill status={r.status} dot /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BentoDashboard, BentoRentals });
