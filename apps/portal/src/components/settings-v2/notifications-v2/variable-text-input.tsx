"use client";

/**
 * Notifications v2: a plain text field that takes `{{variables}}`, for the
 * email subject, the push title and body, and the in-app title and message
 * (build-spec, components). v2 only.
 *
 * Deliberately simple: a ui-v2 Input or Textarea holding the raw template text,
 * an "Insert variable" menu that puts `{{key}}` where the caret was, and a
 * character counter when there is a limit. No chips and no overlay, so what the
 * operator sees is exactly what is stored.
 *
 * `InsertVariableMenu` is exported for the email body editor, which offers the
 * same menu beside it. This file must not import Tiptap (or
 * `editor-extensions.ts`): the page loads it eagerly, while the editor is
 * loaded on demand.
 */

import { forwardRef, useCallback, useId, useRef, useState, type ChangeEvent, type Ref } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NotificationVariable, NotificationVariableGroup } from "@/lib/notifications-v2/types";

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
 * Puts `token` in place of the selection `[start, end)` of `value`. The
 * selection is clamped to the text (it can be stale after an outside change).
 * Refuses, rather than truncating, when the result would exceed `maxLength`.
 */
export function insertAtSelection(
  value: string,
  token: string,
  selection: { start: number; end: number } | null | undefined,
  maxLength?: number,
): InsertResult {
  const text = value ?? "";
  const clamp = (n: number) => Math.min(Math.max(0, Number.isFinite(n) ? n : text.length), text.length);
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

export const VARIABLE_GROUP_LABELS: Record<NotificationVariableGroup, string> = {
  customer: "Customer",
  rental: "Booking",
  vehicle: "Car",
  money: "Amounts",
  company: "Your company",
  links: "Links",
};

const GROUP_ORDER: readonly NotificationVariableGroup[] = ["customer", "rental", "vehicle", "money", "company", "links"];

/** The variables, grouped for the Insert variable menu; empty groups are left out. */
export function groupVariables(
  variables: readonly NotificationVariable[],
): { group: NotificationVariableGroup; label: string; items: NotificationVariable[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: VARIABLE_GROUP_LABELS[group],
    items: variables.filter((v) => v.group === group),
  })).filter((g) => g.items.length > 0);
}


export interface InsertVariableMenuProps {
  variables: readonly NotificationVariable[];
  onPick: (key: string) => void;
  disabled?: boolean;
  /** Names the field it inserts into, for screen readers ("Insert variable into Subject"). */
  fieldLabel?: string;
  align?: "start" | "end";
  className?: string;
}

/** A small "Insert variable" button with the variables grouped by what they describe. */
export function InsertVariableMenu({ variables, onPick, disabled, fieldLabel, align = "end", className }: InsertVariableMenuProps) {
  const groups = groupVariables(variables);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled || variables.length === 0}
          aria-label={fieldLabel ? `Insert variable into ${fieldLabel}` : undefined}
          className={cn("text-muted-foreground hover:text-foreground", className)}
        >
          <Braces data-icon="inline-start" />
          Insert variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="max-h-80 w-72"
        // Focus goes back to the field (the caller does it), not to this button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {groups.map((g) => (
          <DropdownMenuGroup key={g.group}>
            <DropdownMenuLabel className="pb-1 pt-2">{g.label}</DropdownMenuLabel>
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

export interface VariableTextInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: readonly NotificationVariable[];
  id: string;
  /** Multi-line (push body, in-app message). */
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** Use when there is no visible <label htmlFor={id}>. */
  ariaLabel?: string;
  readOnly?: boolean;
  invalid?: boolean;
  /** Extra ids for aria-describedby (a hint or an error under the field). */
  describedBy?: string;
  className?: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

export const VariableTextInput = forwardRef<Field, VariableTextInputProps>(function VariableTextInput(
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
  const text = value ?? "";

  const setRefs = useCallback(
    (el: Field | null) => {
      fieldRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  // The caret is remembered on every move, because opening the menu blurs the field.
  const remember = () => {
    const el = fieldRef.current;
    if (el) selectionRef.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  };

  const insert = (key: string) => {
    const variable = variables.find((v) => v.key === key);
    const result = insertAtSelection(text, `{{${key}}}`, selectionRef.current, maxLength);
    if (!result.ok) {
      setNotice(`There's no room for ${variable?.label ?? key}. Shorten the text first.`);
      return;
    }
    setNotice(null);
    selectionRef.current = { start: result.caret, end: result.caret };
    onChange(result.value);
    // After the parent re-renders with the new value, put the caret after the token.
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
  const describedByIds = [describedBy, maxLength != null ? counterId : null, notice ? noticeId : null].filter(Boolean).join(" ") || undefined;

  const shared = {
    id,
    value: text,
    placeholder,
    readOnly,
    maxLength,
    "aria-label": ariaLabel,
    "aria-invalid": invalid || over || undefined,
    "aria-describedby": describedByIds,
    onSelect: remember,
    onKeyUp: remember,
    onClick: remember,
    onBlur: remember,
    onChange: (e: ChangeEvent<Field>) => {
      selectionRef.current = { start: e.target.selectionStart ?? e.target.value.length, end: e.target.selectionEnd ?? e.target.value.length };
      if (notice) setNotice(null);
      onChange(e.target.value);
    },
  };

  return (
    <div className={cn("space-y-1", className)}>
      {multiline ? (
        <Textarea ref={setRefs as Ref<HTMLTextAreaElement>} rows={rows} className="text-sm" {...shared} />
      ) : (
        <Input ref={setRefs as Ref<HTMLInputElement>} type="text" className="text-sm" {...shared} />
      )}
      {(!readOnly || maxLength != null) && (
        <div className="flex min-h-6 items-center justify-between gap-2">
          {!readOnly ? (
            <InsertVariableMenu variables={variables} onPick={insert} fieldLabel={ariaLabel} align="start" className="-ml-2" />
          ) : (
            <span />
          )}
          {maxLength != null && (
            <span
              id={counterId}
              className={cn(
                "text-xs tabular-nums",
                over ? "text-destructive" : near ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
              )}
            >
              <span className="sr-only">Characters used: </span>
              {text.length} / {maxLength}
            </span>
          )}
        </div>
      )}
      {notice && (
        <p id={noticeId} role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {notice}
        </p>
      )}
    </div>
  );
});

export default VariableTextInput;
