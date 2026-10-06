import { describe, expect, it } from 'vitest';

import {
  looksLikeHtml,
  plainTextToEmailHtml,
  renderBody,
} from '../../../../supabase/functions/customer-management-run/plain-text';
import { DEFAULT_STEPS } from '@/lib/customer-management/catalog';

/*
 * Super admins write these emails as plain text. The runner turns that into
 * the small HTML the branded shell expects — these are the rules it follows.
 */

describe('plain text becomes email HTML', () => {
  it('splits paragraphs on a blank line', () => {
    expect(plainTextToEmailHtml('Hi Sam,\n\nWelcome aboard.')).toBe(
      '<p>Hi Sam,</p>\n<p>Welcome aboard.</p>',
    );
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(plainTextToEmailHtml('Thanks,\nThe Drive247 team')).toBe(
      '<p>Thanks,<br>The Drive247 team</p>',
    );
  });

  it('turns "- " lines into one bulleted list', () => {
    expect(plainTextToEmailHtml('To do:\n- Add a car\n- Share the page')).toBe(
      '<p>To do:</p>\n<ul><li>Add a car</li><li>Share the page</li></ul>',
    );
  });

  it('links web addresses without swallowing the full stop after them', () => {
    expect(plainTextToEmailHtml('Go to https://app.drive-247.com.')).toBe(
      '<p>Go to <a href="https://app.drive-247.com">https://app.drive-247.com</a>.</p>',
    );
  });

  it('escapes anything that looks like markup', () => {
    expect(plainTextToEmailHtml('Cars <b>fast</b> & cheap')).toBe(
      '<p>Cars &lt;b&gt;fast&lt;/b&gt; &amp; cheap</p>',
    );
  });
});

describe('the mode is decided by the template, not by what is filled in', () => {
  it('a company name containing a tag cannot flip a plain email into HTML', () => {
    const out = renderBody('Hi {{name}}', (t) => t.replace('{{name}}', '<b>Fast</b> Cars'));
    expect(out).toBe('<p>Hi &lt;b&gt;Fast&lt;/b&gt; Cars</p>');
  });

  it('an HTML template written before plain text existed is used as-is', () => {
    const html = '<p>Hi</p><ul><li>One</li></ul>';
    expect(renderBody(html, (t) => t)).toBe(html);
  });
});

describe('the shipped defaults are plain English', () => {
  it('contain no HTML', () => {
    for (const step of DEFAULT_STEPS) {
      expect(looksLikeHtml(step.body_html), step.step_key).toBe(false);
    }
  });
});
