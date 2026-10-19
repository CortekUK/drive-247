// Turns a lead from an ad platform into a contact_requests row.
//
// Meta Lead Ads and Google Ads lead forms both hand over a flat list of
// (question, answer) pairs. Known questions map onto columns; everything else
// is kept, readable, in `message`, and the whole payload in `raw`.

// deno-lint-ignore no-explicit-any
type Supabase = any;

export interface LeadField {
  /** Provider's key: Meta `full_name` / custom slug, Google `FULL_NAME` / `column_name`. */
  key: string;
  /** Human question text when the provider gives one. */
  label?: string;
  value: string;
}

const NORMALISE = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const COLUMN_FOR: Record<string, string> = {
  full_name: 'contact_name',
  name: 'contact_name',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  work_email: 'email',
  phone_number: 'phone',
  phone: 'phone',
  work_phone_number: 'phone',
  company_name: 'company_name',
  company: 'company_name',
  fleet_size: 'fleet_size',
  how_many_vehicles_do_you_have: 'fleet_size',
  how_many_cars_do_you_have: 'fleet_size',
  number_of_vehicles: 'fleet_size',
  current_platform: 'current_platform',
  budget: 'budget',
};

export interface LeadInput {
  source: 'meta-ads' | 'google-ads';
  connectionId: string;
  externalId: string;
  sourceDetail: string | null;
  isTest: boolean;
  createdAt?: string;
  fields: LeadField[];
  raw: unknown;
}

export function rowFromLead(input: LeadInput) {
  const row: Record<string, unknown> = {};
  let first = '';
  let last = '';
  const extras: string[] = [];

  for (const f of input.fields) {
    const value = (f.value ?? '').toString().trim();
    if (!value) continue;
    const col = COLUMN_FOR[NORMALISE(f.key)] ?? COLUMN_FOR[NORMALISE(f.label ?? '')];
    if (col === 'first_name') first = value;
    else if (col === 'last_name') last = value;
    else if (col && !row[col]) row[col] = value;
    else extras.push(`${f.label || f.key.replace(/_/g, ' ')}: ${value}`);
  }

  const name = (row.contact_name as string | undefined) || [first, last].filter(Boolean).join(' ');
  return {
    contact_name: name || (row.email as string | undefined) || 'Unknown',
    company_name: (row.company_name as string | undefined) || 'Unknown',
    email: ((row.email as string | undefined) ?? '').toLowerCase(),
    phone: (row.phone as string | undefined) ?? null,
    fleet_size: (row.fleet_size as string | undefined) ?? null,
    current_platform: (row.current_platform as string | undefined) ?? null,
    budget: (row.budget as string | undefined) ?? null,
    message: extras.length ? extras.join('\n') : null,
    status: 'pending',
    source: input.source,
    connection_id: input.connectionId,
    external_id: input.externalId,
    source_detail: input.sourceDetail,
    is_test: input.isTest,
    raw: input.raw,
    ...(input.createdAt ? { created_at: input.createdAt } : {}),
  };
}

/** Inserts the lead; a retry of the same lead (same source + external id) is a no-op. */
export async function saveLead(supabase: Supabase, input: LeadInput): Promise<'created' | 'duplicate'> {
  const { error } = await supabase.from('contact_requests').insert(rowFromLead(input));
  if (!error) return 'created';
  if (error.code === '23505') return 'duplicate';
  throw new Error(`contact_requests insert failed: ${error.message}`);
}

export async function markConnectionError(supabase: Supabase, connectionId: string, message: string) {
  await supabase
    .from('lead_connections')
    .update({ status: 'error', last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', connectionId);
}

/** Constant-time string compare, for webhook keys and signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const GRAPH = 'https://graph.facebook.com/v21.0';

export function metaAppCredentials() {
  const appId = Deno.env.get('META_LEADS_APP_ID') || Deno.env.get('META_WHATSAPP_APP_ID') || '';
  const appSecret = Deno.env.get('META_LEADS_APP_SECRET') || Deno.env.get('META_WHATSAPP_APP_SECRET') || '';
  return { appId, appSecret };
}

/**
 * The verify token Meta echoes when the webhook is (re)subscribed. Derived from
 * the app secret when not set explicitly, so there is one less secret to keep.
 */
export async function metaVerifyToken(): Promise<string> {
  const explicit = Deno.env.get('META_LEADS_VERIFY_TOKEN');
  if (explicit) return explicit;
  const { appSecret } = metaAppCredentials();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`drive247-leads:${appSecret}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
