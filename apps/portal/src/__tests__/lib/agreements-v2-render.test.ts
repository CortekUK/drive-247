/**
 * Agreements v2 — the one substitution pipeline the preview and the
 * individual send share (lib/agreements-v2/render.ts).
 *
 * The defect classes this pins are the four that have already reached signed
 * contracts (brace count, our own entities, unresolved names, picker/engine
 * mismatch), plus the one that would make a document unsignable: a BoldSign
 * text tag that does not survive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildIndividualData,
  ensureSignatureTag,
  escapeHtml,
  renderAgreementHtml,
  UNRESOLVED_ATTR,
} from '@/lib/agreements-v2/render';
import { TEMPLATE_VARIABLES } from '@/lib/template-variables';

const MODES = ['preview', 'send'] as const;
const TAGS = ['{{@sig1}}', '{{@init1}}', '{{@date1}}'];
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const data = { customer_name: 'Ivita Berzina', company_name: 'Moore Luxe LLC' };

describe('BoldSign text tags', () => {
  const doc =
    '<p>Renter: {{customer_name}}</p>' +
    '<p>Signature: {{@sig1}} Initials: {{@init1}} Date: {{@date1}}</p>' +
    // Adjacent to a name that IS stripped, and inside a table cell.
    '<p>{{customer_signature}}{{@sig1}}</p><table><tr><td>Initials</td><td>{{@init1}}</td></tr></table>';

  it.each(MODES)('survive %s mode byte for byte', (mode) => {
    const out = renderAgreementHtml(doc, data, { mode });
    expect(count(out, '{{@sig1}}')).toBe(2);
    expect(count(out, '{{@init1}}')).toBe(2);
    expect(count(out, '{{@date1}}')).toBe(1);
  });

  it.each(MODES)('are never marked as unresolved in %s mode', (mode) => {
    const out = renderAgreementHtml('<p>{{@sig1}} {{@init1}} {{@date1}}</p>', {}, { mode });
    expect(out).not.toContain(UNRESOLVED_ATTR);
    for (const tag of TAGS) expect(out).toContain(tag);
  });

  it.each(MODES)('survive a template with no data at all (%s)', (mode) => {
    const out = renderAgreementHtml('<p>{{@sig1}}</p>', {}, { mode });
    expect(out).toBe('<p>{{@sig1}}</p>');
  });
});

describe('brace tolerance', () => {
  it.each([
    ['{{customer_name}}'],
    ['{{{customer_name}}}'],
    ['{{{customer_name}}'],
    ['{{customer_name}}}'],
    ['{{ customer_name }}'],
    ['{{&nbsp;customer_name&nbsp;}}'],
  ])('substitutes %s with no stray braces', (placeholder) => {
    for (const mode of MODES) {
      const out = renderAgreementHtml(`<p>between us and ${placeholder} ("Renter")</p>`, data, { mode });
      expect(out).toBe('<p>between us and Ivita Berzina ("Renter")</p>');
    }
  });

  it('substitutes names the send engine supplies that are not in the picker', () => {
    const out = renderAgreementHtml('<p>Dated {{today_date}} / {{{current_date}}}</p>', { today_date: 'May 1, 2026', current_date: 'May 1, 2026' }, { mode: 'send' });
    expect(out).toBe('<p>Dated May 1, 2026 / May 1, 2026</p>');
  });

  it('never treats a regex-looking value as a replacement pattern in the extra keys', () => {
    // `$&` as a replacement STRING would re-insert the matched placeholder.
    // (The bare `&` a raw value brings in comes out escaped; see "entities".)
    const out = renderAgreementHtml('<p>{{promo_code}}</p>', { promo_code: '$& $1 $$' }, { mode: 'send' });
    expect(out).toBe('<p>$&amp; $1 $$</p>');
  });
});

describe('entities', () => {
  it('decodes our own typographic entities to the characters', () => {
    const out = renderAgreementHtml('<p>the Renter&rsquo;s card &mdash; 5&ndash;10 days&hellip; &#8217; &#x2019;</p>', {}, { mode: 'send' });
    expect(out).toBe('<p>the Renter’s card — 5–10 days… ’ ’</p>');
  });

  it('decodes &amp; LAST, so correctly escaped text is not decoded twice', () => {
    // An operator who typed the literal text "&rsquo;" is stored as
    // "&amp;rsquo;". It must still READ "&rsquo;", never become an apostrophe.
    const out = renderAgreementHtml('<p>Type &amp;rsquo; for an apostrophe</p>', {}, { mode: 'send' });
    expect(out).toBe('<p>Type &amp;rsquo; for an apostrophe</p>');
    expect(out).not.toContain('’');
  });

  it('keeps markup characters escaped: typed text never becomes a tag', () => {
    const out = renderAgreementHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>', {}, { mode: 'preview' });
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>');
    expect(out).not.toContain('<script');
  });

  it('escapes a bare ampersand a raw value brought in', () => {
    const out = renderAgreementHtml('<p>{{company_name}}</p>', { company_name: 'Smith & Sons' }, { mode: 'send' });
    expect(out).toBe('<p>Smith &amp; Sons</p>');
  });

  it('leaves tags and attributes alone, including the operator signature image', () => {
    const img = '<img data-operator-signature="true" src="data:image/png;base64,iVBORw0KGgo+/=">';
    const doc = `<p style="text-align: center">${img}</p><p><a href="https://x.test/?a=1&amp;b=2">x</a></p>`;
    for (const mode of MODES) {
      expect(renderAgreementHtml(doc, {}, { mode })).toBe(doc);
    }
  });
});

describe('unresolved names: stripped to send, marked to preview', () => {
  const doc = '<p>Authorized Signature: {{owner_signature}}</p>';

  it('send strips them, exactly as /api/esign does', () => {
    const out = renderAgreementHtml(doc, data, { mode: 'send' });
    expect(out).toBe('<p>Authorized Signature: </p>');
    expect(out).not.toContain('{{');
  });

  it('preview marks them visibly and keeps the name readable', () => {
    const out = renderAgreementHtml(doc, data, { mode: 'preview' });
    expect(out).toContain(`<span ${UNRESOLVED_ATTR}="owner_signature"`);
    expect(out).toContain('>{{owner_signature}}</span>');
  });

  it('marks every occurrence, and only unresolved names', () => {
    const out = renderAgreementHtml('<p>{{customer_name}} {{starting_odometer}} {{{starting_odometer}}}</p>', data, { mode: 'preview' });
    expect(count(out, `${UNRESOLVED_ATTR}="starting_odometer"`)).toBe(2);
    expect(out).toContain('Ivita Berzina');
    expect(out).not.toContain(`${UNRESOLVED_ATTR}="customer_name"`);
  });

  it('never wraps a placeholder that sits inside an attribute', () => {
    const out = renderAgreementHtml('<p><a href="https://x.test/{{booking_link}}">Book</a></p>', {}, { mode: 'preview' });
    expect(out).toBe('<p><a href="https://x.test/{{booking_link}}">Book</a></p>');
  });

  it('blanks a catalogued variable the data does not carry, in both modes', () => {
    // An individual agreement has no vehicle: the sent document prints blank,
    // so the preview must not promise a value.
    for (const mode of MODES) {
      expect(renderAgreementHtml('<p>Vehicle: {{vehicle_reg}}.</p>', data, { mode })).toBe('<p>Vehicle: .</p>');
    }
  });

  it('keeps the gig-driver conditional working', () => {
    const tpl = '<p>A</p>{{#if is_gig_driver}}<p>Gig terms</p>{{/if}}';
    expect(renderAgreementHtml(tpl, { is_gig_driver: 'Yes' }, { mode: 'send' })).toBe('<p>A</p><p>Gig terms</p>');
    expect(renderAgreementHtml(tpl, { is_gig_driver: 'No' }, { mode: 'send' })).toBe('<p>A</p>');
  });
});

describe('the send path’s own clean-up, mirrored', () => {
  it('drops a table row whose value came out empty, in both modes', () => {
    const tpl = '<table><tr><td>Renter</td><td>{{customer_name}}</td></tr><tr><td>Plate</td><td>{{vehicle_reg}}</td></tr></table>';
    for (const mode of MODES) {
      expect(renderAgreementHtml(tpl, data, { mode })).toBe('<table><tr><td>Renter</td><td>Ivita Berzina</td></tr></table>');
    }
  });

  it('removes only the empty row, even when the whole table is on one line', () => {
    // /api/esign's own pattern would delete the "Renter" row here too: its lazy
    // `.*?` runs across </tr> when there is no newline to stop it.
    const tpl = '<table><tr><td>Renter</td><td>{{customer_name}}</td></tr><tr><td>Plate</td><td>{{vehicle_reg}}</td></tr><tr><td>Owner</td><td>{{company_name}}</td></tr></table>';
    expect(renderAgreementHtml(tpl, data, { mode: 'send' })).toBe(
      '<table><tr><td>Renter</td><td>Ivita Berzina</td></tr><tr><td>Owner</td><td>Moore Luxe LLC</td></tr></table>',
    );
  });

  it('matches /api/esign on the built-in templates, one row per line', () => {
    const tpl = '<table>\n<tr><td><strong>Make</strong></td><td>{{vehicle_make}}</td></tr>\n<tr><td><strong>Name</strong></td><td>{{customer_name}}</td></tr>\n</table>';
    expect(renderAgreementHtml(tpl, data, { mode: 'send' })).toBe(
      '<table>\n\n<tr><td><strong>Name</strong></td><td>Ivita Berzina</td></tr>\n</table>',
    );
  });

  it('keeps a row an unresolved marker sits in, so the preview shows it', () => {
    const tpl = '<table><tr><td>Odometer</td><td>{{starting_odometer}}</td></tr></table>';
    expect(renderAgreementHtml(tpl, {}, { mode: 'send' })).toBe('<table></table>');
    expect(renderAgreementHtml(tpl, {}, { mode: 'preview' })).toContain(`${UNRESOLVED_ATTR}="starting_odometer"`);
  });

  it('lifts a block-level value out of the paragraph it was substituted into', () => {
    const out = renderAgreementHtml('<p>{{terms_and_conditions}}</p>', { terms_and_conditions: '<h2>Terms &amp; Conditions</h2><p>Be kind.</p>' }, { mode: 'send' });
    expect(out).toBe('<h2>Terms &amp; Conditions</h2><p>Be kind.</p>');
  });
});

describe('ensureSignatureTag', () => {
  const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'esign', 'route.ts'), 'utf8');

  it('appends the same block /api/esign appends when {{@sig1}} is absent', () => {
    const out = ensureSignatureTag('<p>Terms</p>');
    const appended = out.slice('<p>Terms</p>'.length);
    expect(appended).toBe('<hr><h3>Signature</h3><p>Customer Signature: {{@sig1}}</p>');
    // The rule's source of truth. If /api/esign ever changes its fallback,
    // the two paths would produce different documents from one template.
    expect(route).toContain(`processedHtml += '${appended}';`);
  });

  it('leaves a document that already has the tag unchanged', () => {
    const doc = '<p>Sign here: {{@sig1}}</p>';
    expect(ensureSignatureTag(doc)).toBe(doc);
  });

  it('is idempotent', () => {
    const once = ensureSignatureTag('<p>Terms</p>');
    expect(ensureSignatureTag(once)).toBe(once);
    expect(count(once, '{{@sig1}}')).toBe(1);
  });

  it('does not count initials or date as a signature', () => {
    const out = ensureSignatureTag('<p>{{@init1}} {{@date1}}</p>');
    expect(count(out, '{{@sig1}}')).toBe(1);
    expect(out.startsWith('<p>{{@init1}} {{@date1}}</p>')).toBe(true);
  });

  it('handles an empty document', () => {
    expect(ensureSignatureTag('')).toBe('<hr><h3>Signature</h3><p>Customer Signature: {{@sig1}}</p>');
  });
});

describe('buildIndividualData', () => {
  const input = {
    companyName: 'Northwind Rentals',
    companyEmail: 'hello@northwind.test',
    companyPhone: '+1 702 555 0100',
    companyAddress: '1 Main St, Las Vegas, NV',
    recipientName: 'Ivita Berzina',
    recipientEmail: 'ivita@example.com',
    date: new Date('2026-01-10T03:00:00Z'),
    timeZone: 'America/Los_Angeles',
  };

  it('fills exactly these keys', () => {
    expect(Object.keys(buildIndividualData(input)).sort()).toEqual(
      [
        'agreement_date',
        'company_address',
        'company_email',
        'company_name',
        'company_phone',
        'current_date',
        'customer_email',
        'customer_name',
        'tenant_name',
        'today_date',
      ].sort(),
    );
  });

  it('uses real catalogue keys for everything but the two engine-only dates', () => {
    const catalogue = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
    const notCatalogued = Object.keys(buildIndividualData(input)).filter((k) => !catalogue.has(k));
    expect(notCatalogued.sort()).toEqual(['current_date', 'today_date']);
    // …and /api/esign supplies both of those, so rental templates render the same.
    const route = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'esign', 'route.ts'), 'utf8');
    expect(route).toMatch(/today_date: _todayInTenantZone/);
    expect(route).toMatch(/current_date: _todayInTenantZone/);
  });

  it('maps the tenant and the recipient onto the right keys', () => {
    const d = buildIndividualData(input);
    expect(d.company_name).toBe('Northwind Rentals');
    expect(d.tenant_name).toBe('Northwind Rentals');
    expect(d.company_email).toBe('hello@northwind.test');
    expect(d.company_phone).toBe('+1 702 555 0100');
    expect(d.company_address).toBe('1 Main St, Las Vegas, NV');
    expect(d.customer_name).toBe('Ivita Berzina');
    expect(d.customer_email).toBe('ivita@example.com');
  });

  it("stamps the date in the tenant's zone, not the server's", () => {
    // 03:00 UTC on Jan 10 is still Jan 9 in Las Vegas.
    const d = buildIndividualData(input);
    expect(d.agreement_date).toBe('January 9, 2026');
    expect(d.today_date).toBe('January 9, 2026');
    expect(d.current_date).toBe('January 9, 2026');
  });

  it('escapes every value, because every one is text a person typed', () => {
    const d = buildIndividualData({ ...input, recipientName: '<img src=x onerror=alert(1)> "Bo" & Co' });
    expect(d.customer_name).toBe('&lt;img src=x onerror=alert(1)&gt; &quot;Bo&quot; &amp; Co');
    const out = renderAgreementHtml('<p>{{customer_name}}</p>', d, { mode: 'preview' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves optional company fields blank rather than undefined', () => {
    const d = buildIndividualData({ companyName: 'N', recipientName: 'R', recipientEmail: 'r@x.test' });
    expect(d.company_email).toBe('');
    expect(d.company_phone).toBe('');
    expect(d.company_address).toBe('');
    expect(d.agreement_date).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it('renders a whole agreement with no leftover markup except the tags', () => {
    const tpl =
      '<h1>Agreement</h1><p>Between {{company_name}} ({{company_email}}) and {{{customer_name}}} ({{customer_email}}), {{agreement_date}}.</p>' +
      '<p>Witness: {{witness_name}}</p><p>Signature: {{@sig1}} Date: {{@date1}}</p>';
    const out = ensureSignatureTag(renderAgreementHtml(tpl, buildIndividualData(input), { mode: 'send' }));
    expect(out).toContain('Between Northwind Rentals (hello@northwind.test) and Ivita Berzina (ivita@example.com), January 9, 2026.');
    expect(out.replace(/\{\{@(sig1|date1)\}\}/g, '')).not.toMatch(/[{}]/);
    expect(count(out, '{{@sig1}}')).toBe(1);
    expect(count(out, '{{@date1}}')).toBe(1);
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`<a href="x">Tom's & Co</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; Co&lt;/a&gt;');
  });
});

describe("renderAgreementHtml markMissing (preview only)", () => {
  const content = "<p>Car: {{vehicle_reg}}. Name: {{customer_name}}. Address: {{company_address}}. Signed {{@sig1}}</p>";
  const data = { customer_name: "Ana", company_address: "" };

  it("highlights a known variable with no value, instead of silently blanking it", () => {
    const html = renderAgreementHtml(content, data, { mode: "preview", markMissing: true });
    expect(html).toMatch(/data-unresolved="vehicle_reg"/);
    expect(html).toContain("Ana");
    // A deliberate blank stays blank, and the signature tag is untouched.
    expect(html).not.toMatch(/data-unresolved="company_address"/);
    expect(html).toContain("{{@sig1}}");
  });

  it("is off by default, and never affects the send path", () => {
    expect(renderAgreementHtml(content, data, { mode: "preview" })).not.toMatch(/data-unresolved="vehicle_reg"/);
    const sent = renderAgreementHtml(content, data, { mode: "send", markMissing: true });
    expect(sent).not.toContain("vehicle_reg");
    expect(sent).not.toMatch(/data-unresolved/);
    expect(sent).toContain("{{@sig1}}");
  });
});
