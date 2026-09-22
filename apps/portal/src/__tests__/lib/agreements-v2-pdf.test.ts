/**
 * Agreements v2: the individual agreement's PDF (lib/agreements-v2/pdf.ts).
 *
 * PARITY. The v2 parser is a copy of app/api/esign/route.ts's, so the two are
 * pinned together: route.ts's own declarations are LIFTED from its source
 * (every top-level function and const, so a helper added there is lifted too)
 * and compiled, and the two parsers must produce deep-equal blocks for every
 * document that has no operator signature. If either drifts, this goes red.
 *
 * THE ONE ADDITION. `<img data-operator-signature="true" src="data:image/png|jpeg;…">`
 * becomes an image block, drawn scaled into 200 × 70 pt; every other <img> is
 * still ignored.
 *
 * BROWSER-SAFE. The PDF is drawn in the browser now, so the module may not use
 * Node APIs: base64 comes from chunked btoa, pinned here against Buffer.
 */
import { deflateSync, crc32 } from 'node:zlib';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage, PDFName, PDFRawStream } from 'pdf-lib';

import { decodeHtmlEntities } from '@/lib/html-entities';
import { OPERATOR_SIGNATURE_ATTR } from '@/lib/agreements-v2/types';
import {
  bannerLabel,
  fitSignatureSize,
  operatorSignatureImage,
  bytesToBase64,
  parseHtmlToBlocks,
  renderAgreementPdf,
  renderAgreementPdfBase64,
  sanitizePdfText,
} from '@/lib/agreements-v2/pdf';
import { compileExpression, liftDeclaration, readPortalSource } from '../helpers/edge-source';

/* ── lifting route.ts ──────────────────────────────────────────────────── */

const ROUTE = readPortalSource('app/api/esign/route.ts');

/** Every top-level function / const name in the route, except the handlers, and every imported binding. */
function topLevel(source: string) {
  const sf = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const imports: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) imports.push(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) imports.push(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if (!el.isTypeOnly) imports.push(el.name.text);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      if (['POST', 'GET', 'PUT', 'DELETE', 'PATCH'].includes(stmt.name.text)) continue;
      names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
  }
  return { names, imports };
}

const KNOWN_IMPORTS: Record<string, unknown> = { decodeHtmlEntities, OPERATOR_SIGNATURE_ATTR };

type Parser = (html: string) => unknown[];
const liftRouteParser = (): Parser => {
  const { names, imports } = topLevel(ROUTE);
  const snippets = names.map((n) => liftDeclaration(ROUTE, n));
  const factory = compileExpression<(...args: unknown[]) => Parser>(imports, snippets, 'parseHtmlToBlocks');
  return factory(...imports.map((name) => KNOWN_IMPORTS[name]));
};

const routeParse = liftRouteParser();

/* ── fixtures ──────────────────────────────────────────────────────────── */

const FIXTURES: Record<string, string> = {
  headings: '<h1>Rental Agreement</h1><h2 style="text-align: center">Parties</h2><h3>Section 1</h3><p>Body text.</p>',
  inline: '<p>Plain <strong>bold <em>bold italic</em></strong> and <u>underlined</u> and <b>b</b> <i>i</i>.</p>',
  alignment:
    '<p style="text-align: center">Centred</p><p style="text-align:right">Right</p><p style="text-align: left">Left</p>',
  table:
    '<table><tbody><tr><th>Item</th><th>Amount</th></tr>\n<tr><td>Deposit</td><td>$200.00</td></tr>\n<tr><td>Empty</td><td></td></tr>\n<tr><td>Rent</td><td>$50</td></tr></tbody></table>',
  lists: '<ul><li>One</li><li><strong>Two</strong> bold</li><li></li></ul><ol><li>First</li><li>Second</li></ol>',
  entities: '<p>The Renter&rsquo;s card &mdash; &ldquo;quoted&rdquo; &amp; 5 &lt; 6 &nbsp;space&nbsp;here</p>',
  textTags:
    '<p><strong>Signature:</strong> {{@sig1}}</p><p>Initials {{@init1}} and date {{@date1}}</p><table><tr><td>Sign</td><td>{{@sig1}}</td></tr></table>',
  emptyFields: '<p><strong>Phone:</strong> </p><p><strong>Email:</strong>&nbsp;</p><p></p><p>kept</p>',
  hrAndRaw: 'Loose text before<hr><p>After the rule</p>\r\nTrailing raw line',
  signaturesSection: [
    '<h2>Signatures</h2>',
    '<h3>FOR THE COMPANY</h3>',
    '<p><strong>Company:</strong> Northwind Rentals</p>',
    '<p><strong>Signature:</strong> </p>',
    '<p><strong>Date:</strong> September 21, 2026</p>',
    '<h3>FOR THE CUSTOMER</h3>',
    '<p><strong>Signature:</strong> {{@sig1}}</p>',
    '<p><strong>Date signed:</strong> {{@date1}}</p>',
  ].join('\n'),
  otherImagesIgnored:
    '<p>Logo <img src="https://example.com/logo.png"> here</p><img src="data:image/png;base64,AAAA"><p>End</p>',
};

describe('parity with app/api/esign/route.ts', () => {
  it('lifted the real parser', () => {
    expect(typeof routeParse).toBe('function');
    expect(routeParse('<p>x</p>')).toEqual([
      { type: 'paragraph', runs: [{ text: 'x', bold: false, italic: false, underline: false }], align: 'left' },
    ]);
  });

  it.each(Object.entries(FIXTURES))('%s parses to the same blocks', (_name, html) => {
    const ours = parseHtmlToBlocks(html);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).toEqual(routeParse(html));
  });

  it('never strips the text tags', () => {
    const text = JSON.stringify(parseHtmlToBlocks(FIXTURES.textTags));
    expect(text).toContain('{{@sig1}}');
    expect(text).toContain('{{@init1}}');
    expect(text).toContain('{{@date1}}');
  });

  it('only differs from route.ts on the characters route.ts lost', () => {
    // route.ts's first seven WINANSI_REPLACEMENTS keys are empty strings, so a
    // ballot box prints "?" there. Here it prints what the comment says.
    expect(sanitizePdfText('☐ agree ✓')).toBe('[ ] agree Y');
    expect(sanitizePdfText('a → b c 中')).toBe('a -> b c ?');
  });
});

/* ── the operator signature ────────────────────────────────────────────── */

/** A real PNG of `w` × `h` (8-bit greyscale), built by hand. */
function png(w: number, h: number): string {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0; // filter byte
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return bytes.toString('base64');
}

const sigTag = (b64: string, format = 'png') =>
  `<img ${OPERATOR_SIGNATURE_ATTR}="true" src="data:image/${format};base64,${b64}" alt="Signature">`;

describe('the operator signature image', () => {
  const WIDE = png(400, 100);

  it('a stand-alone signature becomes an image block, in document order', () => {
    const blocks = parseHtmlToBlocks(`<p>Before</p>${sigTag(WIDE)}<p>After</p>`);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(blocks[1].image).toEqual({ format: 'png', base64: WIDE });
  });

  it('a signature inside a paragraph is split out of it', () => {
    const blocks = parseHtmlToBlocks(`<p><strong>Signature:</strong> ${sigTag(WIDE)} (director)</p>`);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(blocks[0].runs?.[0]).toMatchObject({ text: 'Signature:', bold: true });
    expect(blocks[2].runs?.[0].text).toBe('(director)');
  });

  it('accepts JPEG, and single-quoted attributes', () => {
    expect(operatorSignatureImage(`<img src='data:image/jpeg;base64,/9j/AA==' ${OPERATOR_SIGNATURE_ATTR}='true'>`)).toEqual({
      format: 'jpeg',
      base64: '/9j/AA==',
    });
  });

  it('ignores every other image, exactly as before', () => {
    const others = [
      '<img src="data:image/png;base64,AAAA">', // not marked
      `<img ${OPERATOR_SIGNATURE_ATTR}="false" src="data:image/png;base64,AAAA">`,
      `<img ${OPERATOR_SIGNATURE_ATTR}="true" src="https://example.com/sig.png">`, // remote
      `<img ${OPERATOR_SIGNATURE_ATTR}="true" src="data:image/svg+xml;base64,PHN2Zz4=">`, // svg
      `<img ${OPERATOR_SIGNATURE_ATTR}="true" src="data:image/png;base64,${'A'.repeat(512_001)}">`, // too big
    ];
    for (const tag of others) {
      expect(operatorSignatureImage(tag)).toBeNull();
      const html = `<p>x</p>${tag}<p>y ${tag}</p>`;
      expect(parseHtmlToBlocks(html)).toEqual(routeParse(html));
    }
  });

  it('a signature in a table cell or heading is not drawn (the cell is text)', () => {
    const blocks = parseHtmlToBlocks(`<table><tr><td>${sigTag(WIDE)}</td><td>x</td></tr></table><h3>${sigTag(WIDE)} Head</h3>`);
    expect(blocks.some((b) => b.type === 'image')).toBe(false);
  });

  it('fits 200 × 70 pt, keeping the aspect ratio, never enlarging', () => {
    expect(fitSignatureSize(400, 100)).toEqual({ width: 200, height: 50 });
    expect(fitSignatureSize(140, 140)).toEqual({ width: 70, height: 70 });
    expect(fitSignatureSize(100, 30)).toEqual({ width: 100, height: 30 });
    expect(fitSignatureSize(0, 10)).toEqual({ width: 0, height: 0 });
  });
});

/* ── rendering ─────────────────────────────────────────────────────────── */

type DrawTextCall = { text: string; color: unknown };

afterEach(() => vi.restoreAllMocks());

describe('renderAgreementPdf', () => {
  it('draws the signature as a real image, scaled to fit', async () => {
    const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage');
    const bytes = await renderAgreementPdf(`<p>Hello</p>${sigTag(png(400, 100))}<p>{{@sig1}}</p>`, { title: 'Consulting agreement' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0][1]).toMatchObject({ width: 200, height: 50, x: 50 });

    const doc = await PDFDocument.load(bytes);
    const images = doc.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(1);
  });

  it('draws the text tags in white and the title, uppercased, in the banner', async () => {
    const calls: DrawTextCall[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text: string, options?: any) {
      calls.push({ text, color: options?.color });
      return original.call(this, text, options);
    });
    await renderAgreementPdf('<p>Signed: {{@sig1}} on {{@date1}}</p>', { title: 'Consulting agreement' });
    expect(calls[0].text).toBe('CONSULTING AGREEMENT');
    const white = { type: 'RGB', red: 1, green: 1, blue: 1 };
    expect(calls.find((c) => c.text === '{{@sig1}}')?.color).toEqual(white);
    expect(calls.find((c) => c.text === '{{@date1}}')?.color).toEqual(white);
    expect(calls.find((c) => c.text === 'Signed:')?.color).not.toEqual(white);
    // The platform disclaimer still closes the document.
    expect(calls.some((c) => c.text === 'Disclaimer')).toBe(true);
  });

  it('draws no image for a document without a signature', async () => {
    const drawImage = vi.spyOn(PDFPage.prototype, 'drawImage');
    await renderAgreementPdf('<p>Logo <img src="https://example.com/x.png"></p><p>{{@sig1}}</p>', { title: 'A' });
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('refuses a "signature" whose bytes are not an image rather than dropping it', async () => {
    await expect(renderAgreementPdf(`${sigTag('AAAAAAAA')}<p>{{@sig1}}</p>`, { title: 'A' })).rejects.toThrow();
  });

  it('cuts a long title to fit the banner', () => {
    const measure = (t: string) => t.length * 6;
    expect(bannerLabel('short', measure, 100)).toBe('SHORT');
    const cut = bannerLabel('a'.repeat(50), measure, 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(60);
    expect(bannerLabel('', measure, 100)).toBe('AGREEMENT');
  });
});

describe('browser-safe base64', () => {
  it('the module uses no Node API', () => {
    const source = readPortalSource('lib/agreements-v2/pdf.ts');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bBuffer\b|\bprocess\.|from ['"]node:|require\(/);
  });

  it('bytesToBase64 matches Buffer, across chunk boundaries', () => {
    for (const size of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 + 1, 100_003]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('renderAgreementPdfBase64 is the same PDF, as base64, with the banner as its title', async () => {
    const calls: string[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text: string, options?: any) {
      calls.push(text);
      return original.call(this, text, options);
    });
    const b64 = await renderAgreementPdfBase64('<p>Hello {{@sig1}}</p>', { banner: 'Consulting agreement' });
    const bytes = Buffer.from(b64, 'base64');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls[0]).toBe('CONSULTING AGREEMENT');
    expect(calls).toContain('{{@sig1}}');
    await expect(PDFDocument.load(bytes)).resolves.toBeTruthy();
  });
});
