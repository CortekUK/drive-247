/* global React, Icon, Field, TextInput, Dropdown, Segmented, Toggle, Stepper, Check, SectionCard */
const RN = window.RN_DATA;
const $ = n => '$' + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0 });
const inp = window.rnInputBase;

function Hint({ icon, children, tone }) {
  const c = tone === 'warn' ? 'var(--warn-accent)' : tone === 'ok' ? 'var(--green)' : 'var(--text-3)';
  const bg = tone === 'warn' ? 'var(--warn-bg)' : tone === 'ok' ? 'var(--green-weak)' : 'var(--tile-2)';
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: c, background: bg, borderRadius: 11, padding: '9px 12px', fontWeight: 600 }}><Icon name={icon} size={15} />{children}</div>;
}
function Money({ value, onChange, error }) {
  return <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
    <span style={{ position: 'absolute', left: 14, color: 'var(--text-3)', fontWeight: 700 }}>$</span>
    <input type="number" value={value} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      style={{ ...inp, paddingLeft: 26, ...(error ? { borderColor: 'var(--danger)', boxShadow: '0 0 0 3px var(--danger-weak)' } : {}) }} />
  </div>;
}
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };

/* 1 — CUSTOMER & VEHICLE */
function SecCustomer({ f, set, err, refCb, toast }) {
  const custOpts = RN.customers.map(c => ({ id: c.id, label: c.name, search: c.name + c.email,
    node: <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: `hsl(${c.hue} 65% 90%)`, color: `hsl(${c.hue} 50% 38%)`, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12 }}>{c.name.split(' ').map(w=>w[0]).join('')}</div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.name}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.email}</div></div>
      {c.verified === 'Verified' ? <Icon name="checkCircle" size={15} style={{ color: 'var(--green)' }} /> : <Icon name="clock" size={14} style={{ color: 'var(--warn-accent)' }} />}
    </div> }));
  const vehOpts = RN.vehicles.filter(v => v.status === 'Available').map(v => ({ id: v.id, label: `${v.make} ${v.model}`, search: `${v.make} ${v.model} ${v.reg}`,
    node: <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: `hsl(${v.hue} 70% 91%)`, color: `hsl(${v.hue} 55% 40%)`, display: 'grid', placeItems: 'center' }}><Icon name="car" size={17} /></div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700 }}>{v.make} {v.model} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{v.year}</span></div><div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono',monospace" }}>{v.reg}</div></div>
      <div style={{ fontWeight: 800, fontFamily: "'Sora',sans-serif", fontSize: 13 }}>{$(v.daily)}<span style={{ fontSize: 10, color: 'var(--text-3)' }}>/d</span></div>
    </div> }));
  const cust = RN.customers.find(c => c.id === f.customerId);
  return (
    <SectionCard refCb={refCb} id="sec-customer" icon="users" num="01" title="Customer & Vehicle" desc="Who's renting and what they're taking"
      action={<button onClick={() => toast('Invite link copied to clipboard')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: 'var(--primary-weak-fg)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}><Icon name="link" size={15} />Invite link</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Customer" req error={err.customerId}>
          <Dropdown value={f.customerId} placeholder="Select customer" options={custOpts} searchable icon="users" error={err.customerId}
            onSelect={id => { set('customerId', id); const c = RN.customers.find(x=>x.id===id); set('driverAge', c.age); }}
            renderValue={c => c.label} />
        </Field>
        {cust && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -4 }}>
            <Tag tone={cust.verified === 'Verified' ? 'ok' : 'warn'} icon={cust.verified === 'Verified' ? 'checkCircle' : 'clock'}>{cust.verified === 'Verified' ? 'ID verified' : 'ID not verified'}</Tag>
            {cust.rating > 0 && <Tag icon="star">{cust.rating.toFixed(1)} rating</Tag>}
            <Tag icon="file">{cust.rentals} past rentals</Tag>
            <Tag tone={cust.insuranceOnFile ? 'ok' : 'plain'} icon="shield">{cust.insuranceOnFile ? 'Insurance on file' : 'No insurance on file'}</Tag>
          </div>
        )}
        <Field label="Vehicle" req error={err.vehicleId} hint="Booked dates are disabled in the calendar · 1 vehicle unavailable">
          <Dropdown value={f.vehicleId} placeholder="Select vehicle" options={vehOpts} searchable icon="car" error={err.vehicleId}
            onSelect={id => set('vehicleId', id)} renderValue={v => v.label} />
        </Field>
      </div>
    </SectionCard>
  );
}
function Tag({ tone, icon, children }) {
  const c = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--warn-accent)' : 'var(--text-2)';
  const bg = tone === 'ok' ? 'var(--green-weak)' : tone === 'warn' ? 'var(--warn-bg)' : 'var(--tile-2)';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: c, background: bg, borderRadius: 9, padding: '5px 10px' }}><Icon name={icon} size={13} fill={icon==='star'} />{children}</span>;
}

/* 2 — PERIOD & PRICING */
function SecPeriod({ f, set, err, derived, refCb }) {
  const { days, period } = derived;
  const timeOpts = RN.times.map(t => ({ id: t, label: t }));
  return (
    <SectionCard refCb={refCb} id="sec-period" icon="calendar" num="02" title="Rental Period & Pricing" desc="Dates, times and how much it costs"
      action={period ? <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary-weak-fg)', background: 'var(--primary-weak)', borderRadius: 999, padding: '5px 12px' }}>{period}{days ? ` · ${days}d` : ''}</span> : null}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={grid2}>
          <Field label="Pickup date" req error={err.startDate}>
            <input type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} style={{ ...inp, ...(err.startDate ? { borderColor: 'var(--danger)' } : {}) }} />
          </Field>
          <Field label="Return date" req={!f.payAsYouGo} error={err.endDate}>
            <input type="date" value={f.endDate} disabled={f.payAsYouGo} onChange={e => set('endDate', e.target.value)} style={{ ...inp, opacity: f.payAsYouGo ? .5 : 1, ...(err.endDate ? { borderColor: 'var(--danger)' } : {}) }} />
          </Field>
        </div>
        <div style={grid2}>
          <Field label="Pickup time" req error={err.pickupTime}><Dropdown value={f.pickupTime} placeholder="Select time" options={timeOpts} icon="clock" error={err.pickupTime} onSelect={v => set('pickupTime', v)} /></Field>
          <Field label="Return time" req={!f.payAsYouGo} error={err.returnTime}><Dropdown value={f.returnTime} placeholder="Select time" options={timeOpts} icon="clock" error={err.returnTime} onSelect={v => set('returnTime', v)} /></Field>
        </div>
        <div style={grid2}>
          <Field label={`Rate (per ${period ? period.toLowerCase().replace('ly','') : 'day'})`} hint="Auto-filled from vehicle · editable"><Money value={f.rate} onChange={v => set('rate', v)} /></Field>
          <Field label="Driver age" req error={err.driverAge}><TextInput type="number" value={f.driverAge} onChange={v => set('driverAge', v)} placeholder="e.g. 30" error={err.driverAge} icon="users" /></Field>
        </div>
        <Field label="Promo code" error={f.promoErr}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><TextInput value={f.promo} onChange={v => { set('promo', v); set('promoErr', ''); }} placeholder="Enter code" icon="tag" /></div>
            <button onClick={() => { const ok = ['SAVE10','WELCOME','REVTEK'].includes((f.promo||'').toUpperCase()); if (!f.promo) return; if (ok) { set('promoApplied', f.promo.toUpperCase()); set('promoErr',''); } else { set('promoApplied', null); set('promoErr', 'Invalid or expired code'); } }}
              style={{ height: 46, padding: '0 18px', borderRadius: 13, border: 'none', background: 'var(--tile-2)', color: 'var(--text)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>Apply</button>
          </div>
        </Field>
        {f.promoApplied && <Hint icon="checkCircle" tone="ok">Code “{f.promoApplied}” applied — 10% off the rental</Hint>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <ToggleRow on={f.payAsYouGo} onChange={v => set('payAsYouGo', v)} title="Pay as you go" desc="Open-ended rental, billed per period — no fixed return date" />
          <ToggleRow on={f.autoExtend} onChange={v => set('autoExtend', v)} title="Auto-extend" desc="Renew automatically each period and charge upfront" />
        </div>
      </div>
    </SectionCard>
  );
}
function ToggleRow({ on, onChange, title, desc }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--tile-2)' }}>
    <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div><div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>{desc}</div></div>
    <Toggle on={on} onChange={onChange} />
  </div>;
}

/* 3 — PICKUP & RETURN */
function SecLocation({ f, set, err, refCb }) {
  return (
    <SectionCard refCb={refCb} id="sec-location" icon="pin" num="03" title="Pickup & Return" desc="Where the keys change hands">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Pickup location" req error={err.pickupLoc}><TextInput value={f.pickupLoc} onChange={v => set('pickupLoc', v)} placeholder="Address or branch" icon="pin" error={err.pickupLoc} /></Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 13, background: 'var(--tile-2)' }}>
          <Check on={f.sameAsPickup} onChange={v => set('sameAsPickup', v)} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Return to the same location</span>
        </div>
        {!f.sameAsPickup && <Field label="Return location"><TextInput value={f.returnLoc} onChange={v => set('returnLoc', v)} placeholder="Return address" icon="pin" /></Field>}
        <Field label="Handover method">
          <Segmented options={RN.deliveryMethods} value={f.delivery} onChange={v => set('delivery', v)} full />
        </Field>
        {f.delivery === 'Lockbox'
          ? <div style={grid2}><Field label="Lockbox code" hint="Sent to customer 1h before pickup"><TextInput value={f.lockbox} onChange={v => set('lockbox', v)} placeholder="e.g. 4821" icon="key" /></Field></div>
          : <Hint icon="info">Customer collects keys in person at the pickup location.</Hint>}
      </div>
    </SectionCard>
  );
}

/* 4 — INSURANCE & ID */
function SecInsurance({ f, set, derived, refCb, toast }) {
  const cust = RN.customers.find(c => c.id === f.customerId);
  const [qr, setQr] = React.useState(false);
  const premium = RN.coverage.reduce((s, c) => s + (f.coverage[c.key] ? c.price : 0), 0);
  return (
    <SectionCard refCb={refCb} id="sec-insurance" icon="shield" num="04" title="Insurance & Verification" desc="Coverage and identity checks"
      action={<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)' }}>Bonzah balance <span style={{ color: 'var(--text)' }}>$2,155</span></span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[['bonzah','Bonzah','Recommended','shield'],['own','Own policy','Upload doc','upload'],['none','Not required','Skip','x']].map(([k,t,s,ic]) => (
            <button key={k} type="button" onClick={() => set('insMode', k)} style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 15, padding: 14, border: f.insMode===k ? '2px solid var(--primary)' : '2px solid var(--tile-border)', background: f.insMode===k ? 'var(--primary-weak)' : 'var(--tile)', transition: 'border-color .15s' }}>
              <Icon name={ic} size={19} style={{ color: f.insMode===k ? 'var(--primary-weak-fg)' : 'var(--text-3)' }} />
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', marginTop: 8 }}>{t}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{s}</div>
            </button>
          ))}
        </div>
        {f.insMode === 'bonzah' && (
          <div style={{ background: 'var(--tile-2)', borderRadius: 15, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {RN.coverage.map(c => (
              <div key={c.key} role="button" onClick={() => set('coverage', { ...f.coverage, [c.key]: !f.coverage[c.key] })} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 6px', cursor: 'pointer', textAlign: 'left' }}>
                <Check on={!!f.coverage[c.key]} onChange={() => set('coverage', { ...f.coverage, [c.key]: !f.coverage[c.key] })} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{c.label}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>{$(c.price)}<span style={{ fontSize: 10, color: 'var(--text-3)' }}>/day</span></span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--tile-border)', paddingTop: 10, marginTop: 4, fontWeight: 800, fontFamily: "'Sora',sans-serif" }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Premium</span><span style={{ color: 'var(--primary-weak-fg)' }}>{$(premium)}<span style={{ fontSize: 11, color: 'var(--text-3)' }}>/day</span></span>
            </div>
          </div>
        )}
        {f.insMode === 'own' && (
          <button type="button" onClick={() => set('ownDoc', f.ownDoc ? '' : 'declaration-page.pdf')} style={{ border: '2px dashed var(--tile-border)', borderRadius: 15, padding: 20, background: 'var(--tile-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' }}>
            <Icon name={f.ownDoc ? 'file' : 'upload'} size={22} style={{ color: 'var(--primary)' }} />
            <div style={{ flex: 1 }}>{f.ownDoc ? <><div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{f.ownDoc}</div><div style={{ fontSize: 11.5, color: 'var(--green)' }}>Scanned & verified by AI</div></> : <><div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>Upload insurance document</div><div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>PDF, JPG or PNG — AI extracts the details</div></>}</div>
          </button>
        )}
        {f.insMode === 'none' && <Hint icon="info" tone="warn">Renting without verified coverage increases liability. Make sure this is allowed.</Hint>}
        {/* verification */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: cust && cust.verified === 'Verified' ? 'var(--green-weak)' : 'var(--warn-bg)' }}>
          <Icon name={cust && cust.verified === 'Verified' ? 'checkCircle' : 'alert'} size={19} style={{ color: cust && cust.verified === 'Verified' ? 'var(--green)' : 'var(--warn-accent)' }} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: cust && cust.verified === 'Verified' ? 'var(--green)' : 'var(--warn-accent)' }}>
            {!cust ? 'Select a customer to check identity verification' : cust.verified === 'Verified' ? 'Identity verified via Veriff' : 'Identity not verified yet'}
          </div>
          {cust && cust.verified !== 'Verified' && <>
            <button onClick={() => toast('Verification link sent')} style={{ border: 'none', background: 'var(--warn-accent)', color: '#fff', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '6px 11px', cursor: 'pointer' }}>Send link</button>
            <button onClick={() => setQr(q=>!q)} style={{ border: '1px solid var(--warn-accent)', background: 'transparent', color: 'var(--warn-accent)', fontWeight: 700, fontSize: 12, borderRadius: 9, padding: '6px 11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="qr" size={13} />QR</button>
          </>}
        </div>
        {qr && <div style={{ display: 'flex', justifyContent: 'center', padding: 14, background: 'var(--tile-2)', borderRadius: 14 }}><FakeQR /></div>}
      </div>
    </SectionCard>
  );
}
function FakeQR() {
  const cells = Array.from({ length: 121 }, (_, i) => (i * 37 + (i % 7) * 13) % 5 < 2);
  return <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(11,9px)', gridAutoRows: 9 }}>{cells.map((on, i) => <div key={i} style={{ width: 9, height: 9, background: on ? '#111' : 'transparent' }} />)}</div></div>;
}

/* 5 — EXTRAS */
function SecExtras({ f, set, derived, refCb }) {
  const total = RN.extras.reduce((s, e) => s + (f.extras[e.key] || 0) * e.price, 0);
  return (
    <SectionCard refCb={refCb} id="sec-extras" icon="tag" num="05" title="Extras & Add-ons" desc="Optional upgrades, priced per day"
      action={total > 0 ? <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--primary-weak-fg)' }}>+{$(total)}/day</span> : null}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {RN.extras.map(e => (
          <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 14, background: 'var(--tile-2)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--tile)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon name={e.icon} size={17} /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{e.name}</div><div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{$(e.price)}/day</div></div>
            <Stepper value={f.extras[e.key] || 0} onChange={v => set('extras', { ...f.extras, [e.key]: v })} />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* 6 — ADDITIONAL DRIVERS */
function SecDrivers({ f, set, refCb }) {
  const drivers = f.drivers;
  const upd = (i, k, v) => { const d = drivers.map((x, j) => j === i ? { ...x, [k]: v } : x); set('drivers', d); };
  return (
    <SectionCard refCb={refCb} id="sec-drivers" icon="userPlus" num="06" title="Additional Drivers" desc="Each gets ID verification + a signing email"
      action={<button onClick={() => set('drivers', [...drivers, { name: '', email: '', phone: '' }])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'var(--primary-weak)', color: 'var(--primary-weak-fg)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', borderRadius: 10, padding: '7px 12px' }}><Icon name="plus" size={14} />Add driver</button>}>
      {drivers.length === 0 ? <Hint icon="info">No additional drivers. Only the primary renter is covered.</Hint> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {drivers.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr', gap: 8 }}>
                <TextInput value={d.name} onChange={v => upd(i, 'name', v)} placeholder="Full name" />
                <TextInput value={d.email} onChange={v => upd(i, 'email', v)} placeholder="Email" />
                <TextInput value={d.phone} onChange={v => upd(i, 'phone', v)} placeholder="Phone" />
              </div>
              <button onClick={() => set('drivers', drivers.filter((_, j) => j !== i))} style={{ width: 40, height: 46, borderRadius: 12, border: 'none', background: 'var(--tile-2)', color: 'var(--danger-fg)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={17} /></button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* 7 — MILEAGE */
function SecMileage({ f, set, derived, refCb }) {
  return (
    <SectionCard refCb={refCb} id="sec-mileage" icon="gauge" num="07" title="Mileage" desc="Allowance and excess charges">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ToggleRow on={f.unlimited} onChange={v => set('unlimited', v)} title="Unlimited mileage" desc="Flat upgrade — no per-mile limit" />
        {!f.unlimited && (
          <div style={grid2}>
            <Field label="Allowance (miles / period)"><TextInput type="number" value={f.mileage} onChange={v => set('mileage', v)} icon="gauge" /></Field>
            <Field label="Excess rate ($ / mile)"><Money value={f.excess} onChange={v => set('excess', v)} /></Field>
          </div>
        )}
        {f.unlimited && <Hint icon="checkCircle" tone="ok">Unlimited mileage upgrade · flat {$(120)} added to the rental.</Hint>}
      </div>
    </SectionCard>
  );
}

/* 8 — DEPOSIT & PAYMENT */
function SecPayment({ f, set, derived, refCb }) {
  const { total } = derived;
  const n = f.installment === 'Weekly' ? 4 : f.installment === 'Bi-weekly' ? 2 : f.installment === 'Monthly' ? 3 : 1;
  return (
    <SectionCard refCb={refCb} id="sec-payment" icon="receipt" num="08" title="Deposit & Payment" desc="How the money is collected">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={grid2}>
          <Field label="Security deposit" hint="Refundable hold"><Money value={f.deposit} onChange={v => set('deposit', v)} /></Field>
          <Field label="Payment mode"><Dropdown value={f.payMode} options={RN.paymentModes.map(p => ({ id: p, label: p }))} onSelect={v => set('payMode', v)} icon="card" /></Field>
        </div>
        <Field label="Payment plan">
          <Segmented options={RN.installments} value={f.installment} onChange={v => set('installment', v)} full />
        </Field>
        {n > 1 && <Hint icon="receipt">{n} payments of {$(total / n)} — first due at pickup, then {f.installment.toLowerCase()}.</Hint>}
        <div style={{ background: 'var(--tile-2)', borderRadius: 13, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Row k="Tax" v={`${(RN.taxRate * 100).toFixed(2)}%`} />
          <Row k="Service fee" v={$(RN.serviceFee)} />
        </div>
      </div>
    </SectionCard>
  );
}
function Row({ k, v }) { return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-3)' }}>{k}</span><span style={{ fontWeight: 700, color: 'var(--text-2)' }}>{v}</span></div>; }

/* 9 — NOTES & AGREEMENT */
function SecNotes({ f, set, refCb }) {
  return (
    <SectionCard refCb={refCb} id="sec-notes" icon="file" num="09" title="Notes & Agreement" desc="Final touches before you create it">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Internal notes" hint="Only visible to your team">
          <textarea value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything the team should know…" rows={3} style={{ ...inp, height: 'auto', padding: 14, resize: 'vertical', lineHeight: 1.5 }} />
        </Field>
        <ToggleRow on={f.sendAgreement} onChange={v => set('sendAgreement', v)} title="Send agreement for e-signature" desc="Email a BoldSign agreement on creation" />
        <ToggleRow on={f.requireSign} onChange={v => set('requireSign', v)} title="Require signature before pickup" desc="Block key handover until signed" />
      </div>
    </SectionCard>
  );
}

window.RN_SEC = { 'sec-customer': SecCustomer, 'sec-period': SecPeriod, 'sec-location': SecLocation, 'sec-insurance': SecInsurance, 'sec-extras': SecExtras, 'sec-drivers': SecDrivers, 'sec-mileage': SecMileage, 'sec-payment': SecPayment, 'sec-notes': SecNotes };
