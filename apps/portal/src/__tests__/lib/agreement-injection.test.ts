import { describe, it, expect } from 'vitest';
import { injectAgreementClauses } from '@/lib/agreement-injection';
import {
  BONZAH_INSURANCE_ADDENDUM_HTML,
  BONZAH_INSURANCE_ADDENDUM_TEXT,
  BONZAH_ADDENDUM_PLACEHOLDER,
} from '@/lib/bonzah-addendum';

/** Nothing on, so each test opts in to exactly the clause it is about. */
const OFF = { hasMileage: false, hasTerms: false, hasBonzahAddendum: false };

const ADDENDUM = `{{${BONZAH_ADDENDUM_PLACEHOLDER}}}`;
const TERMS = '{{terms_and_conditions}}';

/** Mirrors the shipped default template's acknowledgement + signature markup. */
const TEMPLATE_ACKNOWLEDGEMENT = `
<h1>Rental Agreement</h1>
<p>Some operator content.</p>
<p><strong>By signing below, the Customer acknowledges the terms.</strong></p>
<hr>
<h2>Signatures</h2>
<p><strong>Customer Signature:</strong> ____</p>
`.trim();

/** The installment template's shape: the marker sits INSIDE a paragraph. */
const TEMPLATE_SIG_TAG = `
<h1>Rental Agreement</h1>
<p>Some operator content.</p>
<p><strong>Signature:</strong> {{@sig1}}</p>
`.trim();

const countOccurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe('injectAgreementClauses — Bonzah addendum gating', () => {
  it('injects the addendum for a tenant with integration_bonzah = true', () => {
    const out = injectAgreementClauses(TEMPLATE_ACKNOWLEDGEMENT, {
      ...OFF,
      hasBonzahAddendum: true,
    });
    expect(countOccurrences(out, ADDENDUM)).toBe(1);
  });

  it('does NOT inject the addendum when the tenant has Bonzah off', () => {
    const out = injectAgreementClauses(TEMPLATE_ACKNOWLEDGEMENT, {
      ...OFF,
      hasBonzahAddendum: false,
    });
    expect(out).not.toContain(ADDENDUM);
    // and leaves a non-Bonzah tenant's template completely untouched
    expect(out).toBe(TEMPLATE_ACKNOWLEDGEMENT);
  });
});

describe('injectAgreementClauses — idempotency', () => {
  it('does not duplicate the addendum when the same agreement is regenerated', () => {
    const opts = { ...OFF, hasBonzahAddendum: true };
    const once = injectAgreementClauses(TEMPLATE_ACKNOWLEDGEMENT, opts);
    const twice = injectAgreementClauses(once, opts);
    const thrice = injectAgreementClauses(twice, opts);

    expect(countOccurrences(thrice, ADDENDUM)).toBe(1);
    expect(thrice).toBe(once);
  });

  it('respects an operator who placed the placeholder themselves', () => {
    const authored = `<h1>Agreement</h1>\n<p>${ADDENDUM}</p>\n<p><strong>Customer Signature:</strong> ____</p>`;
    const out = injectAgreementClauses(authored, { ...OFF, hasBonzahAddendum: true });

    expect(countOccurrences(out, ADDENDUM)).toBe(1);
    expect(out).toBe(authored);
  });

  it('matches a hand-placed placeholder written with inner whitespace', () => {
    const authored = `<p>{{ ${BONZAH_ADDENDUM_PLACEHOLDER} }}</p>\n<p>Customer Signature: ____</p>`;
    const out = injectAgreementClauses(authored, { ...OFF, hasBonzahAddendum: true });
    expect(out).toBe(authored);
  });
});

describe('injectAgreementClauses — placement', () => {
  it('places the addendum above the acknowledgement paragraph', () => {
    const out = injectAgreementClauses(TEMPLATE_ACKNOWLEDGEMENT, {
      ...OFF,
      hasBonzahAddendum: true,
    });
    expect(out.indexOf(ADDENDUM)).toBeLessThan(out.indexOf('By signing below'));
  });

  it('reads terms first, then the addendum, then the signature', () => {
    const out = injectAgreementClauses(TEMPLATE_ACKNOWLEDGEMENT, {
      ...OFF,
      hasTerms: true,
      hasBonzahAddendum: true,
    });
    expect(out.indexOf(TERMS)).toBeLessThan(out.indexOf(ADDENDUM));
    expect(out.indexOf(ADDENDUM)).toBeLessThan(out.indexOf('By signing below'));
  });

  it('never splices into the middle of a paragraph', () => {
    const out = injectAgreementClauses(TEMPLATE_SIG_TAG, {
      ...OFF,
      hasBonzahAddendum: true,
    });
    // The whole <p> that carries {{@sig1}} must survive intact.
    expect(out).toContain('<p><strong>Signature:</strong> {{@sig1}}</p>');
    expect(out.indexOf(ADDENDUM)).toBeLessThan(out.indexOf('<p><strong>Signature:'));
  });

  it('falls back to appending when the template has no signature marker', () => {
    const bare = '<h1>Agreement</h1>\n<p>No signature anywhere.</p>';
    const out = injectAgreementClauses(bare, { ...OFF, hasBonzahAddendum: true });

    expect(countOccurrences(out, ADDENDUM)).toBe(1);
    expect(out.startsWith(bare)).toBe(true);
  });

  it('anchors on a bare "Customer Signature" label', () => {
    const template = '<p>Content.</p>\n<p>Customer Signature: ____</p>';
    const out = injectAgreementClauses(template, { ...OFF, hasBonzahAddendum: true });
    expect(out.indexOf(ADDENDUM)).toBeLessThan(out.indexOf('Customer Signature'));
  });
});

describe('BONZAH_INSURANCE_ADDENDUM — content fidelity', () => {
  const CLAUSE_HEADINGS = [
    'Insurance Requirement.',
    'Bonzah Is a Referral Partner.',
    'Personal Use Only.',
    'Excluded Vehicles.',
    'Coverage Term; 24-Hour Cycles; Continuous Coverage; Extensions.',
    'Your Responsibility to Read the Coverage.',
    'Not "Full Coverage."',
    'Opt-Out of UM / UIM / PIP / Med-Pay.',
    'Authorized Drivers.',
    'Timestamps.',
  ];

  it('carries all ten clauses in both renderings', () => {
    for (const heading of CLAUSE_HEADINGS) {
      expect(BONZAH_INSURANCE_ADDENDUM_HTML).toContain(heading);
      expect(BONZAH_INSURANCE_ADDENDUM_TEXT).toContain(heading);
    }
  });

  it('numbers the clauses 1..10 in both renderings', () => {
    CLAUSE_HEADINGS.forEach((heading, i) => {
      expect(BONZAH_INSURANCE_ADDENDUM_HTML).toContain(`<strong>${i + 1}. ${heading}</strong>`);
      expect(BONZAH_INSURANCE_ADDENDUM_TEXT).toContain(`${i + 1}. ${heading}`);
    });
  });

  it('names Pablow as broker of record and disclaims that we are the insurer', () => {
    expect(BONZAH_INSURANCE_ADDENDUM_HTML).toContain('Pablow, Inc. may act as the broker of record');
    expect(BONZAH_INSURANCE_ADDENDUM_HTML).toContain('We are not the insurer');
  });

  it('renders as a flat sequence of block elements the PDF parser understands', () => {
    // The portal's HTML->PDF parser only treats table/h1-h3/ul/ol/hr/p as blocks;
    // a wrapper <div> would be flattened into stray raw text.
    expect(BONZAH_INSURANCE_ADDENDUM_HTML).not.toContain('<div');
    expect(BONZAH_INSURANCE_ADDENDUM_HTML.startsWith('<h2>')).toBe(true);
    expect(countOccurrences(BONZAH_INSURANCE_ADDENDUM_HTML, '<p><strong>')).toBe(10);
  });

  it('is pure ASCII so htmlToText cannot mangle it', () => {
    // The booking engine's htmlToText replaces every character outside Latin-1
    // with a space, which would turn "doesn't" into "doesn t".
    const nonAscii = [...BONZAH_INSURANCE_ADDENDUM_HTML].filter((c) => c.charCodeAt(0) > 127);
    expect(nonAscii).toEqual([]);
    expect([...BONZAH_INSURANCE_ADDENDUM_TEXT].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    expect(BONZAH_INSURANCE_ADDENDUM_HTML).toContain("doesn't specify a start time");
  });
});
