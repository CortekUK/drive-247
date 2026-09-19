import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { crc32 } from 'node:zlib';
import { toCsv, toXlsx, toPdf, render, MEDIA_TYPES, type ReportTable } from '../../../../../supabase/functions/trax-support/support/report-format';

/*
 * The report writers, checked with parsers that had no part in writing them:
 * JSZip opens the XLSX package, pdf-lib loads the PDF, and node's own zlib.crc32
 * re-computes the checksums in the ZIP. A writer that only satisfies its own
 * reader proves nothing, so nothing here uses the module's internals.
 */
/** Copy into this realm: pdf-lib type-checks against its own Uint8Array. */
const local = (bytes: Uint8Array) => new Uint8Array(bytes.slice());

const table: ReportTable = {
  title: 'Payments received — August 2026',
  subtitle: 'Acme Hire · Europe/London',
  notes: [
    'Collected: money the application records as received, excluding authorizations awaiting capture, net of refunds recorded against the same payment.',
    'Period: 2026-08-01 to 2026-08-31 (Europe/London).',
  ],
  columns: ['Customer', 'Payments', 'Collected', 'Currency'],
  rows: [
    ['Ada Okafor', '3', '1234.50', 'GBP'],
    ['Ben "Benny" Marsh', '1', '400.00', 'GBP'],
    ['Chloé Ngô, Ltd', '2', '99.99', 'GBP'],
    ['=cmd|calc', '1', '10.00', 'GBP'],
  ],
  numericColumns: [1, 2],
};

describe('CSV', () => {
  const text = () => new TextDecoder().decode(toCsv(table));

  it('starts with a UTF-8 BOM so Excel reads accented names correctly', () => {
    // Checked on the BYTES: TextDecoder strips the BOM, so decoding first would
    // hide whether it was ever written.
    const bytes = toCsv(table);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text()).toContain('Chloé Ngô');
  });

  it('quotes by RFC 4180 and doubles embedded quotes', () => {
    expect(text()).toContain('"Ben ""Benny"" Marsh"');
    expect(text()).toContain('"Chloé Ngô, Ltd"');
  });

  it('neutralises a cell that would otherwise run as a formula', () => {
    // An exported value beginning with = is a spreadsheet injection risk.
    expect(text()).toContain("'=cmd|calc");
    expect(text()).not.toMatch(/(^|\r\n)=cmd/);
  });

  it('keeps the figures exactly as the query layer formatted them', () => {
    expect(text()).toContain('1234.50');
    expect(text()).toContain('99.99');
    expect(text()).not.toContain('1234.5,');
  });

  it('separates rows with CRLF and ends with a newline', () => {
    expect(text().endsWith('\r\n')).toBe(true);
    expect(text().split('\r\n').filter((line) => line.includes('GBP'))).toHaveLength(4);
  });
});

describe('XLSX', () => {
  const open = () => JSZip.loadAsync(toXlsx(table));

  it('is a ZIP that JSZip opens, with the parts Excel requires', async () => {
    const archive = await open();
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      expect(archive.file(part), `missing ${part}`).toBeTruthy();
    }
  });

  it('carries checksums that node computes to the same value', async () => {
    // A wrong CRC is the classic way a hand-written ZIP opens in one reader and
    // is rejected by another, so it is verified against a different implementation.
    const bytes = toXlsx(table);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0, checked = 0;
    while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
      const stored = view.getUint32(offset + 14, true);
      const size = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const start = offset + 30 + nameLength + extraLength;
      const content = bytes.subarray(start, start + size);
      expect(crc32(Buffer.from(content)) >>> 0).toBe(stored);
      checked += 1;
      offset = start + size;
    }
    expect(checked).toBe(6);
  });

  it('writes figures as numbers and labels as text', async () => {
    const sheet = await (await open()).file('xl/worksheets/sheet1.xml')!.async('string');
    // A money value must be a numeric cell, or Excel cannot sum the column.
    expect(sheet).toContain('<v>1234.50</v>');
    expect(sheet).toContain('<v>99.99</v>');
    // A label is an inline string.
    expect(sheet).toContain('Ada Okafor');
    expect(sheet).toMatch(/t="inlineStr"[^>]*><is><t[^>]*>Customer</);
  });

  it('escapes XML rather than producing a corrupt package', async () => {
    const hostile: ReportTable = {
      ...table,
      title: 'Report <&> "quoted"',
      rows: [["O'Brien & Sons <tag>", '1', '5.00', 'GBP']],
    };
    const archive = await JSZip.loadAsync(toXlsx(hostile));
    const sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('&lt;&amp;&gt;');
    expect(sheet).toContain('O&apos;Brien &amp; Sons');
    expect(sheet).not.toContain('<tag>');
  });

  it('survives a control character in stored data', async () => {
    // A BEL byte is not legal in XML 1.0 and would make the package unreadable.
    const dirty: ReportTable = { ...table, rows: [['Bell' + String.fromCharCode(7) + 'Name', '1', '5.00', 'GBP']] };
    const archive = await JSZip.loadAsync(toXlsx(dirty));
    const sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).not.toContain(String.fromCharCode(7));
    expect(sheet).toContain('BellName');
  });

  it('addresses cells beyond column Z correctly', async () => {
    const wide: ReportTable = {
      title: 'Wide', columns: Array.from({ length: 30 }, (_, i) => `C${i}`),
      rows: [Array.from({ length: 30 }, (_, i) => String(i))],
    };
    const sheet = await (await JSZip.loadAsync(toXlsx(wide))).file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('r="Z');
    expect(sheet).toContain('r="AA');
    expect(sheet).toContain('r="AD');
  });
});

describe('PDF', () => {
  it('is a document pdf-lib can load', async () => {
    const document = await PDFDocument.load(local(toPdf(table)));
    expect(document.getPageCount()).toBe(1);
    const [page] = document.getPages();
    // Landscape A4-ish, as the writer declares.
    expect(Math.round(page.getWidth())).toBe(842);
    expect(Math.round(page.getHeight())).toBe(595);
  });

  it('paginates a long report and loads every page', async () => {
    const long: ReportTable = {
      ...table,
      rows: Array.from({ length: 95 }, (_, i) => [`Customer ${i}`, '1', `${i}.00`, 'GBP']),
    };
    const bytes = toPdf(long);
    const document = await PDFDocument.load(local(bytes));
    expect(document.getPageCount()).toBe(4);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('Page 1 of 4');
    // The writer escapes parentheses, so the marker appears escaped in the stream.
    expect(text).toContain('continued');
    expect(text).toContain(String.raw`\(continued\)`);
  });

  it('contains the figures and the definition', () => {
    const text = new TextDecoder('latin1').decode(toPdf(table));
    expect(text).toContain('1234.50');
    expect(text).toContain('Collected: money the application records as received');
    expect(text).toContain('Europe/London');
  });

  it('escapes parentheses and backslashes instead of breaking the stream', async () => {
    const hostile: ReportTable = { ...table, rows: [['Smith (Holdings) \\ Co', '1', '5.00', 'GBP']] };
    const bytes = toPdf(hostile);
    await expect(PDFDocument.load(local(bytes))).resolves.toBeTruthy();
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('Smith \\(Holdings\\) \\\\ Co');
  });

  it('renders an empty result without producing a broken file', async () => {
    const empty: ReportTable = { title: 'No matching records', columns: ['Customer'], rows: [] };
    const document = await PDFDocument.load(local(toPdf(empty)));
    expect(document.getPageCount()).toBe(1);
  });
});

describe('the format selector', () => {
  it('produces each format with its own signature and media type', async () => {
    const csv = render('csv', table);
    const xlsx = render('xlsx', table);
    const pdf = render('pdf', table);
    expect([csv[0], csv[1], csv[2]]).toEqual([0xef, 0xbb, 0xbf]);
    // PK.. for a ZIP, %PDF for a PDF.
    expect([xlsx[0], xlsx[1]]).toEqual([0x50, 0x4b]);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    expect(MEDIA_TYPES.xlsx).toContain('spreadsheetml');
    expect(MEDIA_TYPES.csv).toContain('charset=utf-8');
    await expect(PDFDocument.load(local(pdf))).resolves.toBeTruthy();
    await expect(JSZip.loadAsync(xlsx)).resolves.toBeTruthy();
  });
});
