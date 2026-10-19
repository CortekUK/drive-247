/**
 * Contact requests: the row shape, labels and the CSV round trip, kept free of
 * React so the page and its dialogs share one definition.
 */

export interface ContactRequest {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: ContactStatus;
  notes: string | null;
  source: string | null;
  fleet_size: string | null;
  current_platform: string | null;
  main_booking_source: string | null;
  budget: string | null;
  readiness: string | null;
  challenge: string | null;
  promo_code: string | null;
  is_favorite: boolean;
  source_detail: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string | null;
}

export const CONTACT_COLUMNS =
  'id,company_name,contact_name,email,phone,message,status,notes,source,fleet_size,current_platform,main_booking_source,budget,readiness,challenge,promo_code,is_favorite,source_detail,is_test,created_at,updated_at';

export const CONTACT_STATUSES = ['pending', 'contacted', 'converted', 'rejected'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const STATUS_LABEL: Record<ContactStatus, string> = {
  pending: 'Pending',
  contacted: 'Contacted',
  converted: 'Converted',
  rejected: 'Rejected',
};

/** Coloured text, as status reads in every v2 table. */
export const STATUS_TEXT: Record<ContactStatus, string> = {
  pending: 'text-warning',
  contacted: 'text-primary',
  converted: 'text-success',
  rejected: 'text-destructive',
};

export const SOURCE_LABEL: Record<string, string> = {
  'strategy-call': 'Website',
  website: 'Website',
  'meta-ads': 'Meta Ads',
  'google-ads': 'Google Ads',
  manual: 'Added by hand',
  import: 'Imported',
};

/** Filter groups: the website's two forms read as one source. */
export const SOURCE_GROUPS = [
  { key: 'website', label: 'Website', sources: ['strategy-call', 'website'] },
  { key: 'meta-ads', label: 'Meta Ads', sources: ['meta-ads'] },
  { key: 'google-ads', label: 'Google Ads', sources: ['google-ads'] },
  { key: 'manual', label: 'Added by hand', sources: ['manual'] },
  { key: 'import', label: 'Imported', sources: ['import'] },
] as const;

/** The dot beside a source's name: each platform in its own colour. */
export const SOURCE_DOT: Record<string, string> = {
  'strategy-call': 'bg-primary',
  website: 'bg-primary',
  'meta-ads': 'bg-[#0866FF]',
  'google-ads': 'bg-[#34A853]',
  manual: 'bg-muted-foreground/50',
  import: 'bg-muted-foreground/50',
};

export const sourceLabel = (s: string | null) => (s ? (SOURCE_LABEL[s] ?? s) : '—');

/** The strategy-call form has no company field, so its rows say "Unknown". */
export const companyOf = (r: Pick<ContactRequest, 'company_name'>) =>
  r.company_name && r.company_name.trim().toLowerCase() !== 'unknown' ? r.company_name : null;

/** The fields a person can type, in form and CSV order. */
export const EDITABLE_FIELDS = [
  { key: 'contact_name', label: 'Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone' },
  { key: 'company_name', label: 'Company' },
  { key: 'fleet_size', label: 'Fleet size' },
  { key: 'current_platform', label: 'Current platform' },
  { key: 'main_booking_source', label: 'Main booking source' },
  { key: 'budget', label: 'Budget' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'promo_code', label: 'Promo code' },
  { key: 'message', label: 'Message', long: true },
  { key: 'notes', label: 'Notes', long: true },
] as const;

export type EditableKey = (typeof EDITABLE_FIELDS)[number]['key'];
export type ContactDraft = Record<EditableKey, string> & { status: ContactStatus };

export const EMPTY_DRAFT: ContactDraft = {
  contact_name: '',
  email: '',
  phone: '',
  company_name: '',
  fleet_size: '',
  current_platform: '',
  main_booking_source: '',
  budget: '',
  readiness: '',
  promo_code: '',
  message: '',
  notes: '',
  status: 'pending',
};

export function draftOf(r: ContactRequest): ContactDraft {
  const d = { ...EMPTY_DRAFT, status: r.status };
  for (const f of EDITABLE_FIELDS) d[f.key] = (r[f.key] as string | null) ?? '';
  if (!companyOf(r)) d.company_name = '';
  return d;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A draft as a row to write: blanks become null, company falls back to "Unknown" (NOT NULL). */
export function rowOf(d: ContactDraft) {
  const row: Record<string, string | null> = { status: d.status };
  for (const f of EDITABLE_FIELDS) {
    const v = d[f.key].trim();
    row[f.key] = v === '' ? null : v;
  }
  row.company_name = row.company_name ?? 'Unknown';
  row.email = (row.email ?? '').toLowerCase();
  return row;
}

/* --------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS: { header: string; get: (r: ContactRequest) => string }[] = [
  { header: 'Name', get: (r) => r.contact_name },
  { header: 'Email', get: (r) => r.email },
  { header: 'Phone', get: (r) => r.phone ?? '' },
  { header: 'Company', get: (r) => companyOf(r) ?? '' },
  { header: 'Status', get: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: 'Source', get: (r) => sourceLabel(r.source) },
  { header: 'Fleet size', get: (r) => r.fleet_size ?? '' },
  { header: 'Current platform', get: (r) => r.current_platform ?? '' },
  { header: 'Main booking source', get: (r) => r.main_booking_source ?? '' },
  { header: 'Budget', get: (r) => r.budget ?? '' },
  { header: 'Readiness', get: (r) => r.readiness ?? '' },
  { header: 'Promo code', get: (r) => r.promo_code ?? '' },
  { header: 'Message', get: (r) => r.message ?? '' },
  { header: 'Notes', get: (r) => r.notes ?? '' },
  { header: 'Favourite', get: (r) => (r.is_favorite ? 'Yes' : '') },
  { header: 'Submitted', get: (r) => r.created_at },
];

const cell = (v: string) => (/[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: ContactRequest[]): string {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => cell(c.get(r))).join(','));
  return lines.join('\r\n');
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES: Record<string, EditableKey | 'status'> = {
  name: 'contact_name',
  'contact name': 'contact_name',
  contact: 'contact_name',
  'full name': 'contact_name',
  email: 'email',
  'email address': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  company: 'company_name',
  'company name': 'company_name',
  business: 'company_name',
  status: 'status',
  'fleet size': 'fleet_size',
  fleet: 'fleet_size',
  'current platform': 'current_platform',
  platform: 'current_platform',
  'main booking source': 'main_booking_source',
  'booking source': 'main_booking_source',
  budget: 'budget',
  readiness: 'readiness',
  'promo code': 'promo_code',
  promo: 'promo_code',
  message: 'message',
  notes: 'notes',
  note: 'notes',
};

export interface ImportPlan {
  rows: Record<string, string | null>[];
  skipped: { line: number; reason: string }[];
  unknownHeaders: string[];
}

/** Maps a CSV's headers onto the table and checks each row. Exported CSVs import back as-is. */
export function planImport(text: string, existingEmails: Set<string>): ImportPlan {
  const [header, ...body] = parseCsv(text);
  const plan: ImportPlan = { rows: [], skipped: [], unknownHeaders: [] };
  if (!header) return plan;
  const keys = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  // Our own export's read-only columns are expected, not worth a warning.
  const ownExtras = new Set(['source', 'favourite', 'submitted']);
  plan.unknownHeaders = header
    .filter((h, i) => !keys[i] && h.trim() !== '' && !ownExtras.has(h.trim().toLowerCase()))
    .map((h) => h.trim());
  const seen = new Set<string>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const d: ContactDraft = { ...EMPTY_DRAFT };
    keys.forEach((k, j) => {
      const v = (cells[j] ?? '').trim();
      if (!k || !v) return;
      if (k === 'status') {
        const s = v.toLowerCase() as ContactStatus;
        if ((CONTACT_STATUSES as readonly string[]).includes(s)) d.status = s;
      } else d[k] = v;
    });
    const email = d.email.trim().toLowerCase();
    if (!d.contact_name.trim()) return plan.skipped.push({ line, reason: 'No name' });
    if (!EMAIL_RE.test(email)) return plan.skipped.push({ line, reason: 'No valid email' });
    if (existingEmails.has(email) || seen.has(email)) return plan.skipped.push({ line, reason: `${email} is already here` });
    seen.add(email);
    plan.rows.push({ ...rowOf(d), source: 'import' });
  });
  return plan;
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
