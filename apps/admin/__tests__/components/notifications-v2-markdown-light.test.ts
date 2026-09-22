/**
 * The body editor's dialect: apps/admin has no Tiptap, so an email body is
 * edited as markdown-light and stored as the same HTML the portal stores.
 *
 * The load-bearing test is `round-trips every email default in the catalog`.
 * If HTML → markdown → HTML lost anything, simply OPENING a notification would
 * rewrite its body, and settings-model would then record every template an
 * admin looked at as a hand-written copy instead of leaving it at the catalog
 * default (`body: null`). That is the whole reason this file exists.
 */

import { describe, expect, it } from 'vitest';
import {
  applyMarkdownAction,
  decodeEntities,
  escapeHtmlText,
  htmlToMarkdownLight,
  inlineToHtml,
  markdownLightToHtml,
} from '@/components/admin/notifications-v2/markdown-light';
import { SYSTEM_NOTIFICATION_CATALOG } from '@/lib/notifications-v2/catalog';
import { rowFromEdit } from '@/lib/notifications-v2/settings-model';
import { forSettingsModel } from '@/components/admin/notifications-v2/system-notifications-model';

const emailItems = SYSTEM_NOTIFICATION_CATALOG.filter((item) => !!item.channels.email);

describe('markdown-light: the catalog round trip', () => {
  it('has email defaults to check', () => {
    expect(emailItems.length).toBeGreaterThan(10);
  });

  it.each(emailItems.map((item) => [item.key, item] as const))(
    'round-trips %s byte for byte',
    (_key, item) => {
      const html = item.channels.email!.defaultTemplate.body;
      const markdown = htmlToMarkdownLight(html);
      expect(markdownLightToHtml(markdown)).toBe(html);
    },
  );

  it('opening a template does not turn it into a customised copy', () => {
    // The real consequence: a body that came back from the editor unchanged
    // must still diff as "the default", i.e. rowFromEdit stores body: null.
    for (const item of emailItems) {
      const spec = item.channels.email!;
      const reopened = markdownLightToHtml(htmlToMarkdownLight(spec.defaultTemplate.body));
      const row = rowFromEdit(
        item.key,
        'email',
        { enabled: spec.defaultEnabled, template: { subject: spec.defaultTemplate.subject, body: reopened } },
        forSettingsModel(item),
      );
      expect(row.body, `${item.key} was rewritten by the editor`).toBeNull();
      expect(row.subject).toBeNull();
    }
  });

  it('round-trips the markdown too, so a second open is stable', () => {
    for (const item of emailItems) {
      const once = htmlToMarkdownLight(item.channels.email!.defaultTemplate.body);
      expect(htmlToMarkdownLight(markdownLightToHtml(once))).toBe(once);
    }
  });
});

describe('markdown-light: HTML to markdown', () => {
  it('reads paragraphs, headings and lists', () => {
    expect(htmlToMarkdownLight('<p>Hello</p>')).toBe('Hello');
    expect(htmlToMarkdownLight('<h3>Title</h3><p>Body</p>')).toBe('### Title\n\nBody');
    expect(htmlToMarkdownLight('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
    expect(htmlToMarkdownLight('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two');
  });

  it('reads the marks and both kinds of link', () => {
    expect(htmlToMarkdownLight('<p><strong>a</strong> and <em>b</em></p>')).toBe('**a** and *b*');
    expect(htmlToMarkdownLight('<p><a href="https://x.test">go</a></p>')).toBe('[go](https://x.test)');
    expect(htmlToMarkdownLight('<p><a data-email-button href="{{portal_url}}">Open</a></p>')).toBe(
      '[[Open]]({{portal_url}})',
    );
  });

  it('leaves {{variables}} exactly as they are', () => {
    expect(htmlToMarkdownLight('<p>Hi {{tenant_admin_name}},</p>')).toBe('Hi {{tenant_admin_name}},');
  });

  it('unwraps a tag it does not know, keeping the text (as the sanitiser does)', () => {
    expect(htmlToMarkdownLight('<p><span class="x">kept</span></p>')).toBe('kept');
  });

  it('turns text outside any block into a paragraph', () => {
    expect(markdownLightToHtml(htmlToMarkdownLight('loose text'))).toBe('<p>loose text</p>');
  });

  it('escapes a literal asterisk or bracket so it is not read as markup', () => {
    const html = '<p>2 * 3 [see]</p>';
    expect(htmlToMarkdownLight(html)).toBe('2 \\* 3 \\[see\\]');
    expect(markdownLightToHtml(htmlToMarkdownLight(html))).toBe(html);
  });

  it('decodes entities and re-encodes them the same way', () => {
    expect(htmlToMarkdownLight('<p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry');
    expect(markdownLightToHtml('Tom & Jerry')).toBe('<p>Tom &amp; Jerry</p>');
  });

  it('reads a <br> as a line break inside the paragraph', () => {
    expect(htmlToMarkdownLight('<p>one<br>two</p>')).toBe('one\ntwo');
    expect(markdownLightToHtml('one\ntwo')).toBe('<p>one<br>two</p>');
  });

  it('reads a blockquote and a divider', () => {
    expect(htmlToMarkdownLight('<blockquote><p>said</p></blockquote>')).toBe('> said');
    expect(markdownLightToHtml('> said')).toBe('<blockquote><p>said</p></blockquote>');
    expect(htmlToMarkdownLight('<hr>')).toBe('---');
    expect(markdownLightToHtml('---')).toBe('<hr>');
  });
});

describe('markdown-light: escaping', () => {
  it('escapes only what a text node needs', () => {
    expect(escapeHtmlText(`a & b < c > d " e ' f`)).toBe(`a &amp; b &lt; c &gt; d " e ' f`);
  });

  it('decodes named and numeric entities, leaving unknown ones alone', () => {
    expect(decodeEntities('&amp;&lt;&gt;&#39;&#x27;&nbsp;')).toBe(`&<>'' `);
    expect(decodeEntities('&notareal;')).toBe('&notareal;');
  });

  it('never emits a tag the email sanitiser would strip', () => {
    const html = markdownLightToHtml('<script>alert(1)</script>');
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain('<script');
  });

  it('escapes a quote inside a link URL', () => {
    expect(inlineToHtml('[x](https://a.test/"onx)')).toContain('href="https://a.test/&quot;onx"');
  });
});

describe('markdown-light: toolbar actions', () => {
  it('wraps the selection in bold and italic', () => {
    expect(applyMarkdownAction('hello world', { start: 6, end: 11 }, 'bold').value).toBe('hello **world**');
    expect(applyMarkdownAction('hello world', { start: 6, end: 11 }, 'italic').value).toBe('hello *world*');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const edit = applyMarkdownAction('', null, 'bold');
    expect(edit.value).toBe('**bold text**');
    // The placeholder is selected, so typing replaces it.
    expect(edit.value.slice(edit.start, edit.end)).toBe('bold text');
  });

  it('prefixes whole lines for lists, quotes and headings', () => {
    expect(applyMarkdownAction('one\ntwo', { start: 0, end: 7 }, 'bullet').value).toBe('- one\n- two');
    expect(applyMarkdownAction('one\ntwo', { start: 0, end: 7 }, 'numbered').value).toBe('1. one\n2. two');
    expect(applyMarkdownAction('one', { start: 0, end: 3 }, 'quote').value).toBe('> one');
    expect(applyMarkdownAction('one', { start: 0, end: 3 }, 'heading').value).toBe('### one');
  });

  it('replaces an existing line marker rather than stacking one on top', () => {
    expect(applyMarkdownAction('- one', { start: 0, end: 5 }, 'numbered').value).toBe('1. one');
  });

  it('leaves the caret inside the empty URL of a new link or button', () => {
    const link = applyMarkdownAction('', null, 'link');
    expect(link.value).toBe('[this link](https://)');
    expect(link.value[link.start - 1]).toBe('/');
    expect(link.value[link.start]).toBe(')');

    const button = applyMarkdownAction('Pay now', { start: 0, end: 7 }, 'button');
    expect(button.value).toBe('[[Pay now]](https://)');
  });

  it('a button the admin never finished is what validateTemplate calls out', () => {
    // applyMarkdownAction leaves "https://" behind; an admin who deletes it
    // gets <a data-email-button href=""> — the case settings-model rejects.
    expect(markdownLightToHtml('[[Pay]]()')).toBe('<p><a data-email-button href="">Pay</a></p>');
  });
});
