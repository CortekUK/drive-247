'use client';

/**
 * Notifications v2, SYSTEM set: the email body editor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO — swap in the portal's rich editor if the Tiptap dependency is approved
 *
 * The operator portal edits this same HTML in
 * `apps/portal/src/components/settings-v2/notifications-v2/template-editor.tsx`
 * (Tiptap, with `editor-extensions.ts` beside it — a Notion-like editor with
 * real variable chips, a bubble menu and a Button block). apps/admin has no
 * Tiptap and adding `@tiptap/react` + its extensions is a dependency decision
 * the user has not taken, so this app edits the body as markdown-light text.
 *
 * To swap: port those two files onto this app's UI kit and replace
 * <BodyEditor> here — the prop shape (value: HTML in, HTML out, `variables`,
 * `readOnly`) is deliberately the same, and nothing else on the page knows
 * which editor is mounted. Everything in `markdown-light.ts` then becomes
 * dead and should go with it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE VALUE IS ALWAYS HTML, in and out — the same HTML the portal stores, the
 * same HTML `notification-test-v2` sends, the same HTML the catalog holds as
 * the default. markdown-light.ts guarantees the round trip is exact for the
 * catalog's whole vocabulary (see its header and its test), so opening a
 * notification never rewrites its body and never turns a default into a
 * customised copy.
 *
 * The markdown is component state, derived from the HTML once. It is re-derived
 * only when the HTML changes for a reason other than this editor's own emit —
 * "Reset to default", or another notification opening in the same slot —
 * because re-deriving on every keystroke would fight the admin's cursor.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bold, Italic, Heading3, List, ListOrdered, Link2, MousePointerClick, Minus, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SystemNotificationVariable } from '@/lib/notifications-v2/variables';
import { InsertVariableMenu, insertAtSelection } from './variable-text-field';
import { applyMarkdownAction, htmlToMarkdownLight, markdownLightToHtml, type MarkdownAction } from './markdown-light';

interface ToolbarButton {
  action: MarkdownAction;
  label: string;
  hint: string;
  Icon: typeof Bold;
}

const TOOLBAR: readonly ToolbarButton[] = [
  { action: 'bold', label: 'Bold', hint: '**bold**', Icon: Bold },
  { action: 'italic', label: 'Italic', hint: '*italic*', Icon: Italic },
  { action: 'heading', label: 'Heading', hint: '### Heading', Icon: Heading3 },
  { action: 'bullet', label: 'Bulleted list', hint: '- item', Icon: List },
  { action: 'numbered', label: 'Numbered list', hint: '1. item', Icon: ListOrdered },
  { action: 'quote', label: 'Quote', hint: '> quote', Icon: Quote },
  { action: 'link', label: 'Link', hint: '[label](url)', Icon: Link2 },
  { action: 'button', label: 'Button', hint: '[[label]](url)', Icon: MousePointerClick },
  { action: 'divider', label: 'Divider', hint: '---', Icon: Minus },
];

export const BODY_EDITOR_HELP =
  'Markdown: **bold**, *italic*, ### heading, - list, > quote, [label](url), [[label]](url) for a button.';

export interface BodyEditorProps {
  /** The stored body, as HTML. */
  value: string;
  /** The edited body, as HTML. */
  onChange: (html: string) => void;
  variables: readonly SystemNotificationVariable[];
  readOnly?: boolean;
  ariaLabel: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

export function BodyEditor({
  value,
  onChange,
  variables,
  readOnly = false,
  ariaLabel,
  invalid = false,
  describedBy,
  className,
}: BodyEditorProps) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const helpId = useId();

  const [markdown, setMarkdown] = useState(() => htmlToMarkdownLight(value));
  /** The HTML this editor last sent up, so its own echo does not re-derive. */
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (emitted.current !== null && value === emitted.current) return;
    emitted.current = null;
    setMarkdown(htmlToMarkdownLight(value));
  }, [value]);

  const emit = useCallback(
    (nextMarkdown: string) => {
      setMarkdown(nextMarkdown);
      const html = markdownLightToHtml(nextMarkdown);
      emitted.current = html;
      onChange(html);
    },
    [onChange],
  );

  const remember = (): void => {
    const el = fieldRef.current;
    if (el) {
      selectionRef.current = {
        start: el.selectionStart ?? el.value.length,
        end: el.selectionEnd ?? el.value.length,
      };
    }
  };

  /** Puts the caret (or the selection) back after React has re-rendered. */
  const restore = (start: number, end: number): void => {
    selectionRef.current = { start, end };
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(start, end);
      } catch {
        // Focus is enough.
      }
    });
  };

  const runAction = (action: MarkdownAction): void => {
    const edit = applyMarkdownAction(markdown, selectionRef.current, action);
    emit(edit.value);
    restore(edit.start, edit.end);
  };

  const insertVariable = (key: string): void => {
    // The body has no length cap of its own (only the email's 100KB CHECK), so
    // no maxLength is passed and the insert can never be refused.
    const result = insertAtSelection(markdown, `{{${key}}}`, selectionRef.current);
    emit(result.value);
    restore(result.caret, result.caret);
  };

  return (
    <div
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card', className)}
      data-body-editor=""
    >
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
          {TOOLBAR.map(({ action, label, hint, Icon }) => (
            <Tooltip key={action}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={label}
                  data-editor-action={action}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runAction(action)}
                  className="h-7 w-7 rounded-lg p-0"
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {label} <span className="font-mono text-xs text-muted-foreground">{hint}</span>
              </TooltipContent>
            </Tooltip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <InsertVariableMenu variables={variables} onPick={insertVariable} fieldLabel={ariaLabel} />
        </div>
      )}
      <Textarea
        ref={fieldRef}
        value={markdown}
        readOnly={readOnly}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, helpId].filter(Boolean).join(' ') || undefined}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        onBlur={remember}
        onChange={(e) => {
          selectionRef.current = {
            start: e.target.selectionStart ?? e.target.value.length,
            end: e.target.selectionEnd ?? e.target.value.length,
          };
          emit(e.target.value);
        }}
        rows={10}
        className="min-h-[220px] flex-1 resize-y rounded-none border-0 bg-transparent font-mono text-[13px] leading-relaxed focus-visible:ring-0"
      />
      <p id={helpId} className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        {BODY_EDITOR_HELP}
      </p>
    </div>
  );
}

export default BodyEditor;
