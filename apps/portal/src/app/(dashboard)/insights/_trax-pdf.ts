/**
 * Insights — the Trax summary as a PDF.
 *
 * A clean A4 document, text-first: company and period on top, Trax's verdict,
 * the four score figures, the podiums, every section with its findings, the
 * actions as a numbered checklist and what to keep an eye on. The charts stay
 * on screen; a PDF of words prints and forwards better than screenshots.
 *
 * Every string here is set with `doc.text` (no HTML), so operator-entered
 * names can only ever be text. jsPDF loads on demand.
 */

export type PdfSummary = {
  headline: string;
  tone: string;
  summary: string;
  sections: {
    heading: string;
    area?: string;
    rating?: string;
    metric?: { label: string; value: string } | null;
    paragraphs: string[];
    bullets: string[];
  }[];
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  plan?: { days30: string[]; days60: string[]; days90: string[] };
  actions: { title: string; detail: string; impact: string; when: string; estimate: string | null }[];
  watch: string[];
  customer_pick?: { customer: string; why: string } | null;
};

export type PdfExtras = {
  company: string;
  period: string;
  writtenAt: string;
  scores: { label: string; value: string }[];
  topCars: { name: string; value: string }[];
  topCustomers: { name: string; value: string }[];
};

/** jsPDF's built-in fonts are WinAnsi: swap the few characters it lacks. */
const safe = (s: string) =>
  s
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/…/g, '...');

export async function traxSummaryPdf(s: PdfSummary, x: PdfExtras): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const usable = W - M * 2;
  let y = M;

  const INK: [number, number, number] = [8, 8, 18];
  const MUTED: [number, number, number] = [115, 115, 115];
  const ACCENT: [number, number, number] = [79, 70, 229];

  const room = (h: number) => {
    if (y + h > H - M - 16) {
      doc.addPage();
      y = M;
    }
  };
  const write = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number; lh?: number } = {},
  ) => {
    const size = opts.size ?? 10.5;
    const lh = opts.lh ?? size * 1.45;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK));
    const lines = doc.splitTextToSize(safe(text), usable - (opts.indent ?? 0)) as string[];
    for (const line of lines) {
      room(lh);
      doc.text(line, M + (opts.indent ?? 0), y);
      y += lh;
    }
    y += opts.gap ?? 0;
  };
  const rule = (gap = 14) => {
    room(gap);
    doc.setDrawColor(230, 230, 236);
    doc.line(M, y, W - M, y);
    y += gap;
  };

  // Masthead
  write(x.company.toUpperCase(), { size: 8.5, bold: true, color: MUTED, gap: 2 });
  write(`Trax summary  ·  ${x.period}`, { size: 9.5, color: MUTED, gap: 14 });
  write(s.headline, { size: 19, bold: true, lh: 24, gap: 8 });
  write(s.summary, { size: 11, color: [64, 64, 64], gap: 12 });

  // Score strip
  room(46);
  const cell = usable / Math.max(1, x.scores.length);
  doc.setFillColor(238, 242, 255);
  doc.roundedRect(M, y, usable, 42, 8, 8, 'F');
  x.scores.forEach((sc, i) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(safe(sc.label), M + 12 + i * cell, y + 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(safe(sc.value), M + 12 + i * cell, y + 32);
  });
  y += 58;

  // Podiums + pick
  const list = (title: string, rows: { name: string; value: string }[]) => {
    if (!rows.length) return;
    write(title, { size: 11, bold: true, gap: 2 });
    rows.forEach((r, i) => {
      room(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...ACCENT);
      doc.text(`${i + 1}`, M, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK);
      doc.text(safe(r.name), M + 16, y);
      doc.text(safe(r.value), W - M, y, { align: 'right' });
      y += 16;
    });
    y += 8;
  };
  if (s.customer_pick) {
    write('Customer of the period', { size: 8.5, bold: true, color: ACCENT, gap: 1 });
    write(s.customer_pick.customer, { size: 13, bold: true, gap: 1 });
    write(s.customer_pick.why, { size: 10, color: [64, 64, 64], gap: 12 });
  }
  list('Top cars', x.topCars);
  list('Top customers', x.topCustomers);
  rule(18);

  // Sections
  s.sections.forEach((sec, i) => {
    if (sec.area) {
      write(`${sec.area.toUpperCase()}${sec.rating ? `  ·  ${sec.rating.toUpperCase()}` : ''}`, {
        size: 8.5,
        bold: true,
        color: ACCENT,
        gap: 1,
      });
    }
    write(`${String(i + 1).padStart(2, '0')}   ${sec.heading}`, { size: 13, bold: true, gap: 2 });
    if (sec.metric) write(`${sec.metric.label}: ${sec.metric.value}`, { size: 10, bold: true, color: MUTED, gap: 4 });
    sec.paragraphs.forEach((p) => write(p, { gap: 6 }));
    sec.bullets.forEach((b) => {
      room(14);
      doc.setFillColor(...ACCENT);
      doc.circle(M + 3, y - 3.5, 1.6, 'F');
      write(b, { indent: 12, gap: 2 });
    });
    y += 10;
  });
  rule(18);

  // SWOT
  if (s.swot) {
    write('Where you stand', { size: 13, bold: true, gap: 6 });
    (
      [
        ['Strengths', s.swot.strengths],
        ['Weaknesses', s.swot.weaknesses],
        ['Opportunities', s.swot.opportunities],
        ['Threats', s.swot.threats],
      ] as const
    ).forEach(([t, items]) => {
      if (!items.length) return;
      write(t, { size: 10, bold: true, color: ACCENT, gap: 2 });
      items.forEach((b) => write(`-  ${b}`, { indent: 6, gap: 2 }));
      y += 4;
    });
    rule(18);
  }

  // Plan
  if (s.plan) {
    write('Your 30 / 60 / 90-day plan', { size: 13, bold: true, gap: 6 });
    (
      [
        ['Next 30 days', s.plan.days30],
        ['By day 60', s.plan.days60],
        ['By day 90', s.plan.days90],
      ] as const
    ).forEach(([t, items]) => {
      if (!items.length) return;
      write(t, { size: 10, bold: true, color: ACCENT, gap: 2 });
      items.forEach((b) => write(`-  ${b}`, { indent: 6, gap: 2 }));
      y += 4;
    });
    rule(18);
  }

  // Actions
  write('Do this now', { size: 13, bold: true, gap: 6 });
  s.actions.forEach((a, i) => {
    room(30);
    doc.setDrawColor(200, 200, 210);
    doc.roundedRect(M, y - 9, 10, 10, 2, 2, 'S');
    write(`${i + 1}. ${a.title}`, { indent: 18, bold: true, gap: 1 });
    write(a.detail, { indent: 18, color: [64, 64, 64], gap: 1 });
    write([`${a.impact} impact`, a.when, a.estimate].filter(Boolean).join('  ·  '), { indent: 18, size: 9, color: MUTED, gap: 8 });
  });

  if (s.watch.length) {
    y += 4;
    write('Keep an eye on', { size: 13, bold: true, gap: 4 });
    s.watch.forEach((w) => write(`-  ${w}`, { gap: 2 }));
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(safe(`Written by Trax · ${x.writtenAt} · Drive247`), M, H - 22);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 22, { align: 'right' });
  }
  return doc.output('blob');
}
