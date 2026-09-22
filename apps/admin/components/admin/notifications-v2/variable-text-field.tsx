'use client';

/**
 * Notifications v2, SYSTEM set: a plain text field that takes `{{variables}}`
 * — the email subject, the push title and message, the in-app title and
 * message.
 *
 * The admin twin of apps/portal/src/components/settings-v2/notifications-v2/
 * variable-text-input.tsx, on this app's own UI kit (components/ui/*, not the
 * portal's ui-v2) and this app's own variable groups (tenant / billing /
 * person / event / links, from lib/notifications-v2/variables.ts).
 *
 * Deliberately simple: the raw template text in an Input or Textarea, an
 * "Insert variable" menu that drops `{{key}}` where the caret was, and a
 * character counter. No overlay and no chips inside the field, so what is on
 * screen is exactly what is stored.
 */

import { forwardRef, useCallback, useId, useRef, useState, type ChangeEvent, type Ref } from 'react';
import { Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SystemNotificationVariable, SystemVariableGroup } from '@/lib/notifications-v2/variables';

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

export interface InsertResult {
  /** False when the token would take the text past `maxLength`; nothing changed. */
  ok: boolean;
  value: string;
  /** Where the caret goes: just after the inserted token. */
  caret: number;
}

/**
 * Puts `token` in place of the selection `[start, end)`. The selection is
 * clamped to the text (it can be stale after an outside change). Refuses,
 * rather than truncating, when the result would pass `maxLength`.
 */
export function insertAtSelection(
  value: string,
  token: string,
  selection: { start: number; end: number } | null | undefined,
  maxLength?: number,
): InsertResult {
  const text = value ?? '';
  const clamp = (n: number): number =>
    Math.min(Math.max(0, Number.isFinite(n) ? n : text.length), text.length);
  const start = clamp(selection?.start ?? text.length);
  const end = Math.max(start, clamp(selection?.end ?? start));
  const next = text.slice(0, start) + token + text.slice(end);
  if (maxLength != null && maxLength > 0 && next.length > maxLength && next.length > text.length) {
    return { ok: false, value: text, caret: end };
  }
  return { ok: true, value: next, caret: start + token.length };
}

/* -------------------------------------------------------------------------- */
/* Insert variable menu                                                        */
/* -------------------------------------------------------------------------- */

export const VARIABLE_GROUP_LABELS: Record<SystemVariableGroup, string> = {
  tenant: 'Operator',
  billing: 'Billing',
  person: 'Person',
  event: 'What happened',
  links: 'Links',
};

const GROUP_ORDER: readonly SystemVariableGroup[] = ['tenant', 'billing', 'person', 'event', 'links'];

/** The variables grouped for the menu; empty groups are left out. */
export function groupVariables(
  variables: readonly SystemNotificationVariable[],
): { group: SystemVariableGroup; label: string; items: SystemNotificationVariable[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: VARIABLE_GROUP_LABELS[group],
    items: variables.filter((v) => v.group === group),
  })).filter((g) => g.items.length > 0);
}

export interface InsertVariableMenuProps {
  variables: readonly SystemNotificationVariable[];
  onPick: (key: string) => void;
  disabled?: boolean;
  /** Names the field it inserts into, for screen readers. */
  fieldLabel?: string;
  align?: 'start' | 'end';
  className?: string;
}

export function InsertVariableMenu({
  variables,
  onPick,
  disabled,
  fieldLabel,
  align = 'start',
  className,
}: InsertVariableMenuProps) {
  const groups = groupVariables(variables);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || variables.length === 0}
          aria-label={fieldLabel ? `Insert variable into ${fieldLabel}` : 'Insert variable'}
          className={cn('h-7 px-2 text-xs text-muted-foreground hover:text-foreground', className)}
        >
          <Braces aria-hidden="true" className="size-3.5" />
          Insert variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-80 w-72 overflow-y-auto"
        // Focus goes back to the field (the caller does it), not to this button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {groups.map((g) => (
          <DropdownMenuGroup key={g.group}>
            <DropdownMenuLabel className="pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              {g.label}
            </DropdownMenuLabel>
            {g.items.map((v) => (
              <DropdownMenuItem
                key={v.key}
                onSelect={() => onPick(v.key)}
                title={v.description}
                className="flex-col items-start gap-0 py-1.5"
              >
                <span className="text-sm">{v.label}</span>
                <span className="font-mono text-xs font-normal text-muted-foreground">{`{{${v.key}}}`}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/* The field                                                                   */
/* -------------------------------------------------------------------------- */

export interface VariableTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  variables: readonly SystemNotificationVariable[];
  id: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** Use when there is no visible <label htmlFor={id}>. */
  ariaLabel?: string;
  readOnly?: boolean;
  invalid?: boolean;
  /** Extra ids for aria-describedby. */
  describedBy?: string;
  className?: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

export const VariableTextField = forwardRef<Field, VariableTextFieldProps>(function VariableTextField(
  {
    value,
    onChange,
    variables,
    id,
    multiline = false,
    rows = 3,
    maxLength,
    placeholder,
    ariaLabel,
    readOnly = false,
    invalid = false,
    describedBy,
    className,
  },
  forwardedRef,
) {
  const fieldRef = useRef<Field | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const counterId = useId();
  const noticeId = useId();
  const text = value ?? '';

  const setRefs = useCallback(
    (el: Field | null) => {
      fieldRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  // The caret is remembered on every move: opening the menu blurs the field.
  const remember = (): void => {
    const el = fieldRef.current;
    if (el) {
      selectionRef.current = {
        start: el.selectionStart ?? el.value.length,
        end: el.selectionEnd ?? el.value.length,
      };
    }
  };

  const insert = (key: string): void => {
    const variable = variables.find((v) => v.key === key);
    const result = insertAtSelection(text, `{{${key}}}`, selectionRef.current, maxLength);
    if (!result.ok) {
      setNotice(`There’s no room for ${variable?.label ?? key}. Shorten the text first.`);
      return;
    }
    setNotice(null);
    selectionRef.current = { start: result.caret, end: result.caret };
    onChange(result.value);
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(result.caret, result.caret);
      } catch {
        // Some input types refuse selection ranges; the focus is enough.
      }
    });
  };

  const over = maxLength != null && text.length > maxLength;
  const near = maxLength != null && !over && text.length >= Math.floor(maxLength * 0.9);
  const describedByIds =
    [describedBy, maxLength != null ? counterId : null, notice ? noticeId : null].filter(Boolean).join(' ') ||
    undefined;

  const shared = {
    id,
    value: text,
    placeholder,
    readOnly,
    maxLength,
    'aria-label': ariaLabel,
    'aria-invalid': invalid || over || undefined,
    'aria-describedby': describedByIds,
    onSelect: remember,
    onKeyUp: remember,
    onClick: remember,
    onBlur: remember,
    onChange: (e: ChangeEvent<Field>) => {
      selectionRef.current = {
        start: e.target.selectionStart ?? e.target.value.length,
        end: e.target.selectionEnd ?? e.target.value.length,
      };
      if (notice) setNotice(null);
      onChange(e.target.value);
    },
  };

  return (
    <div className={cn('space-y-1', className)}>
      {multiline ? (
        <Textarea ref={setRefs as Ref<HTMLTextAreaElement>} rows={rows} className="text-sm" {...shared} />
      ) : (
        <Input ref={setRefs as Ref<HTMLInputElement>} type="text" className="text-sm" {...shared} />
      )}
      {(!readOnly || maxLength != null) && (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {!readOnly ? (
            <InsertVariableMenu
              variables={variables}
              onPick={insert}
              fieldLabel={ariaLabel}
              align="start"
              className="-ml-2"
            />
          ) : (
            <span />
          )}
          {maxLength != null && (
            <span
              id={counterId}
              className={cn(
                'text-xs tabular-nums',
                over ? 'text-destructive' : near ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              <span className="sr-only">Characters used: </span>
              {text.length} / {maxLength}
            </span>
          )}
        </div>
      )}
      {notice && (
        <p id={noticeId} role="status" className="text-xs text-warning">
          {notice}
        </p>
      )}
    </div>
  );
});

export default VariableTextField;
