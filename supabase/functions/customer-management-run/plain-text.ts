// Plain-English email bodies -> the small HTML the branded shell expects.
//
// Super admins write these emails as ordinary text in a textarea, not HTML.
// The rules are the ones anybody would guess:
//
//   a blank line           starts a new paragraph
//   a line starting "- "   is a bullet (consecutive ones form one list)
//   a web address          becomes a link
//
// Everything else is escaped, so a stray "<" in the copy (or in a tenant's
// company name filled into it) prints as text instead of becoming markup.
//
// A TEMPLATE that already contains HTML tags is passed through untouched,
// which keeps anything written in HTML before this existed working exactly as
// it did. `renderBody` decides that on the template BEFORE the variables are
// filled in: a company name like "<b>Fast</b> Cars" must not flip a plain-text
// email into HTML mode.
//
// Dependency-free on purpose: the admin app's tests import this file directly.

const HTML_TAG = /<\s*\/?\s*(p|ul|ol|li|h[1-6]|br|strong|em|b|i|a|div|span|table)\b[^>]*>/i;

export function looksLikeHtml(body: string): boolean {
  return HTML_TAG.test(body);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a line, then turn each http(s) address in it into a link. */
function inline(line: string): string {
  const escaped = escapeHtml(line);
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);
}

/** Fill a template and turn it into body HTML, choosing the mode from the template. */
export function renderBody(template: string, fill: (text: string) => string): string {
  return looksLikeHtml(template) ? fill(template) : plainTextToEmailHtml(fill(template));
}

/** Plain text -> HTML. Always escapes; use `renderBody` to honour HTML templates. */
export function plainTextToEmailHtml(body: string): string {
  const blocks = body.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let paragraph: string[] = [];
    let bullets: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length) out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    };
    const flushBullets = () => {
      if (bullets.length) out.push(`<ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`);
      bullets = [];
    };

    for (const line of lines) {
      const bullet = /^[-*•]\s+(.*)$/.exec(line);
      if (bullet) {
        flushParagraph();
        bullets.push(inline(bullet[1]));
      } else {
        flushBullets();
        paragraph.push(inline(line));
      }
    }
    flushParagraph();
    flushBullets();
  }

  return out.join('\n');
}
