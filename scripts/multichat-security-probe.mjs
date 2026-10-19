#!/usr/bin/env node
/**
 * multichat-security-probe.mjs — prove the Multi Chat §1 boundaries against a
 * live project (docs/multi-chat/02-security-verification.md).
 *
 * It creates its own fixture — one staff user (role `ops`) and two customers
 * (A with a login, B without) on the tenant you name — runs every check with
 * the public anon key, the customer's session and the staff session, then
 * TEARS THE FIXTURE DOWN in `finally`, including the notifications the chat
 * trigger writes. Nothing is left in the tenant.
 *
 * Nothing is ever sent: send-sms/email probes target customers with no phone or
 * email on file, so a vulnerable build stops before Twilio/Resend.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/multichat-security-probe.mjs --tenant test
 *
 * Exits 1 if anything is EXPOSED or a legitimate path is BROKEN. Keys come from
 * the environment only and are never printed.
 */
import { createRequire } from 'node:module';
import { randomBytes, createHmac } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const slugArg = process.argv.indexOf('--tenant');
const SLUG = slugArg > -1 ? process.argv[slugArg + 1] : 'test';
if (!URL || !ANON || !SVC) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const svc = createClient(URL, SVC, { auth: { persistSession: false } });
const rows = [];
const rec = (check, as, status, detail, exposed) => rows.push({ check, as, status, detail, result: exposed ? 'EXPOSED' : 'blocked' });
const must = (check, as, status, detail, ok) => rows.push({ check, as, status, detail, result: ok ? 'ok' : 'BROKEN' });

async function http(method, path, bearer, body, headers = {}) {
  const res = await fetch(URL + path, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${bearer ?? ANON}`, ...(body && !(body instanceof URLSearchParams) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : body instanceof URLSearchParams ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}
const count = (r) => (Array.isArray(r.json) ? r.json.length : 0);

const fx = { authIds: [], customerIds: [], appUserIds: [] };

async function createFixture(tenantId) {
  const pw = randomBytes(18).toString('base64url');
  const tag = randomBytes(4).toString('hex');
  const mkUser = async (kind) => {
    const email = `multichat-probe-${kind}-${tag}@drive-247.test`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true });
    if (error) throw error;
    fx.authIds.push(data.user.id);
    return { id: data.user.id, email };
  };
  const cu = await mkUser('customer');
  const st = await mkUser('staff');
  const mkCustomer = async (name) => {
    const { data, error } = await svc.from('customers').insert({ tenant_id: tenantId, type: 'Individual', name }).select('id').single();
    if (error) throw error;
    fx.customerIds.push(data.id);
    return data.id;
  };
  const customerA = await mkCustomer(`Probe Customer A ${tag}`);
  const customerB = await mkCustomer(`Probe Customer B ${tag}`);
  await svc.from('customer_users').insert({ auth_user_id: cu.id, customer_id: customerA, tenant_id: tenantId }).throwOnError();
  const { data: au } = await svc.from('app_users')
    .insert({ auth_user_id: st.id, email: st.email, role: 'ops', tenant_id: tenantId, name: `Probe Staff ${tag}`, is_active: true })
    .select('id').single().throwOnError();
  fx.appUserIds.push(au.id);
  const channelOf = async (id) => (await svc.from('chat_channels').select('id').eq('customer_id', id).single().throwOnError()).data.id;
  const login = async (email) => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;
    c.realtime.setAuth(data.session.access_token);
    return { client: c, token: data.session.access_token };
  };
  return {
    customerA, customerB, appUserId: au.id,
    channelA: await channelOf(customerA), channelB: await channelOf(customerB),
    customer: await login(cu.email), staff: await login(st.email),
  };
}

async function teardown() {
  const ids = fx.customerIds;
  if (ids.length) {
    const { data: chans } = await svc.from('chat_channels').select('id').in('customer_id', ids);
    const chanIds = (chans ?? []).map((c) => c.id);
    for (const cid of chanIds) {
      await svc.from('notifications').delete().eq('metadata->>channel_id', cid);
      await svc.from('customer_notifications').delete().eq('metadata->>channel_id', cid);
    }
    if (chanIds.length) {
      await svc.from('chat_channel_messages').delete().in('channel_id', chanIds);
      await svc.from('chat_channels').delete().in('id', chanIds);
    }
    await svc.from('customer_users').delete().in('customer_id', ids);
    await svc.from('customers').delete().in('id', ids);
  }
  if (fx.appUserIds.length) await svc.from('app_users').delete().in('id', fx.appUserIds);
  for (const id of fx.authIds) await svc.auth.admin.deleteUser(id);
}

async function main() {
  const { data: tenant } = await svc.from('tenants').select('id, twilio_account_sid').eq('slug', SLUG).single().throwOnError();
  // A customer of ANOTHER tenant with no phone/email on file — the cross-tenant target.
  const { data: other } = await svc.from('chat_channels').select('id, customer_id, customers!inner(phone, email, tenant_id)')
    .neq('tenant_id', tenant.id).is('customers.phone', null).is('customers.email', null).limit(1).single().throwOnError();
  const f = await createFixture(tenant.id);
  const who = { anon: null, customer: f.customer.token };

  for (const [as, bearer] of Object.entries(who)) {
    let r = await http('GET', '/rest/v1/tenants?select=id&twilio_auth_token=not.is.null', bearer);
    rec('read tenants.twilio_auth_token', as, r.status, `${count(r)} rows`, count(r) > 0);
    r = await http('GET', '/rest/v1/tenants?select=id&twilio_api_key_secret=not.is.null', bearer);
    rec('read tenants.twilio_api_key_secret', as, r.status, `${count(r)} rows`, count(r) > 0);
    const own = as === 'customer' ? f.channelA : '00000000-0000-0000-0000-000000000000';
    r = await http('GET', `/rest/v1/chat_channel_messages?select=id&channel_id=neq.${own}&limit=5000`, bearer);
    rec("read other conversations' messages", as, r.status, `${count(r)} rows`, count(r) > 0);
    r = await http('GET', `/rest/v1/chat_channels?select=id&id=neq.${own}&limit=5000`, bearer);
    rec('read other chat_channels', as, r.status, `${count(r)} rows`, count(r) > 0);
    r = await http('POST', '/rest/v1/chat_channel_messages', bearer,
      { channel_id: f.channelB, sender_type: 'tenant', sender_id: f.appUserId, content: 'probe', channel: 'in_app' }, { Prefer: 'return=representation' });
    rec("insert into another customer's thread as staff", as, r.status, '', r.status < 300);
    r = await http('GET', '/rest/v1/voicemail_recordings?select=id&limit=5000', bearer);
    rec('read voicemail_recordings', as, r.status, `${count(r)} rows`, count(r) > 0);
    for (const bucket of ['voicemails', 'bonzah-onboarding-files', 'chat-attachments']) {
      r = await http('POST', `/storage/v1/object/list/${bucket}`, bearer, { prefix: '', limit: 100 });
      rec(`list private bucket ${bucket}`, as, r.status, `${count(r)} entries`, count(r) > 0);
    }
  }
  for (const [as, bearer] of [...Object.entries(who), ['staff', f.staff.token]]) {
    const r = await http('POST', '/rest/v1/rpc/twilio_get_secrets', bearer, { p_tenant_id: tenant.id });
    rec('call Vault RPC twilio_get_secrets', as, r.status, '', r.status === 200);
  }

  // Legitimate paths that must keep working.
  let r = await http('GET', `/rest/v1/chat_channel_messages?select=id&channel_id=eq.${f.channelA}`, f.customer.token);
  must('customer reads own thread', 'customer', r.status, '', r.status === 200);
  r = await http('POST', '/rest/v1/chat_channel_messages', f.customer.token,
    { channel_id: f.channelA, sender_type: 'customer', sender_id: f.customerA, content: 'probe', channel: 'in_app' }, { Prefer: 'return=representation' });
  must('customer sends in own thread', 'customer', r.status, '', r.status < 300);
  r = await http('POST', '/rest/v1/chat_channel_messages', f.customer.token,
    { channel_id: f.channelA, sender_type: 'tenant', sender_id: f.appUserId, content: 'probe', channel: 'in_app' }, { Prefer: 'return=representation' });
  rec('customer posts as staff in own thread', 'customer', r.status, '', r.status < 300);
  r = await http('GET', `/rest/v1/chat_channels?select=id&tenant_id=eq.${tenant.id}&limit=5000`, f.staff.token);
  must('staff reads own tenant channels', 'staff', r.status, `${count(r)} rows`, r.status === 200 && count(r) > 0);
  r = await http('GET', `/rest/v1/chat_channels?select=id&tenant_id=neq.${tenant.id}&limit=5000`, f.staff.token);
  rec("staff reads other tenants' channels", 'staff', r.status, `${count(r)} rows`, count(r) > 0);

  // Internal tools.
  for (const [as, bearer] of [...Object.entries(who), ['staff', f.staff.token]]) {
    for (const [fn, body] of [['send-tenant-sms', { tenantId: tenant.id }], ['diag-twilio-a2p', { slug: 'zz-no-such-tenant' }],
                              ['diag-twilio-voice', { slug: 'zz-no-such-tenant' }], ['ops-twilio-repoint-sms', { slug: 'zz-no-such-tenant' }]]) {
      const res = await http('POST', `/functions/v1/${fn}`, bearer, body);
      rec(`call ${fn}`, as, res.status, '', ![401, 403].includes(res.status));
    }
  }

  // Cross-tenant sends (target has no phone/email, so nothing can go out).
  for (const fn of ['send-sms-message', 'send-email-message']) {
    const res = await http('POST', `/functions/v1/${fn}`, f.staff.token, { channelId: other.id, customerId: other.customer_id, content: 'probe' });
    rec(`${fn} to another tenant's customer`, 'staff', res.status, res.json?.error ?? '', res.status !== 404);
  }

  // Webhook signature, checked with the token read from Vault (nothing exists for this MessageSid).
  if (tenant.twilio_account_sid) {
    const { data: sec } = await svc.rpc('twilio_get_secrets', { p_tenant_id: tenant.id });
    const token = sec?.[0]?.auth_token;
    const url = `${URL}/functions/v1/twilio-sms-status`;
    const params = { AccountSid: tenant.twilio_account_sid, MessageSid: 'SMprobe' + randomBytes(13).toString('hex'), MessageStatus: 'delivered' };
    const sign = (t) => createHmac('sha1', t).update(url + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
    for (const [label, sig, want] of [['valid signature', token && sign(token), 200], ['wrong signature', sign('not-the-token'), 403], ['unsigned', null, 403]]) {
      const res = await http('POST', '/functions/v1/twilio-sms-status', SVC, new URLSearchParams(params), {
        'Content-Type': 'application/x-www-form-urlencoded', ...(sig ? { 'X-Twilio-Signature': sig } : {}),
      });
      must(`twilio-sms-status: ${label}`, 'twilio', res.status, '', res.status === want);
    }
  }

  // Realtime: staff and customer get their own inserts; anon gets no data.
  const got = { staff: [], customer: [], anon: [] };
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const sub = (client, key, filter) => new Promise((resolve) => client.channel(`probe-${key}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_channel_messages', ...(filter ? { filter } : {}) }, (p) => got[key].push(p.new?.channel_id))
    .subscribe((s) => { if (s === 'SUBSCRIBED') resolve(); }));
  await Promise.all([sub(f.staff.client, 'staff'), sub(f.customer.client, 'customer', `channel_id=eq.${f.channelA}`), sub(anon, 'anon')]);
  await new Promise((res) => setTimeout(res, 1500));
  await svc.from('chat_channel_messages').insert({ channel_id: f.channelA, sender_type: 'tenant', sender_id: f.appUserId, content: 'probe', channel: 'in_app', is_read: true }).throwOnError();
  await new Promise((res) => setTimeout(res, 6000));
  must('realtime: staff gets own-tenant insert', 'staff', '', '', got.staff.includes(f.channelA));
  must('realtime: customer gets own-channel insert', 'customer', '', '', got.customer.includes(f.channelA));
  rec('realtime: anon receives row data', 'anon', '', '', got.anon.some(Boolean));
  for (const c of [f.staff.client, f.customer.client, anon]) await c.removeAllChannels();
}

let failed = false;
try {
  await main();
} catch (e) {
  console.error('Probe aborted:', e?.message ?? e);
  failed = true;
} finally {
  await teardown().catch((e) => { console.error('TEARDOWN FAILED — clean up by hand:', e?.message ?? e); failed = true; });
}
console.log('| check | as | HTTP | detail | result |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.check} | ${r.as} | ${r.status} | ${String(r.detail).replace(/\|/g, '/')} | ${r.result} |`);
const bad = rows.filter((r) => r.result === 'EXPOSED' || r.result === 'BROKEN').length;
console.log(`\n${rows.length} checks, ${bad} failing.`);
process.exit(failed || bad ? 1 : 0);
