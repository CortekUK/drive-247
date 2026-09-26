"use client";

/**
 * The few v2 pieces the balance panel draws with — northwind's grammar
 * (components/ui-v2): rounded-4xl surfaces with a ring, rounded-3xl controls on
 * `bg-input/50`, Manrope on titles, `size-N` icons.
 *
 * Selects are native <select>s wearing the v2 input skin: they are the one
 * control a screen reader, a phone and a test all drive the same way, and the
 * lists here are short.
 */

import { cn } from "@/lib/utils";

export const surfaceCls =
  "rounded-4xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";

export const controlCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export const noteCls =
  "flex min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-3 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export function BalanceField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BalanceSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(controlCls, "cursor-pointer pr-2", !value && "text-muted-foreground")}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function MoneyInput({
  id,
  value,
  onChange,
  symbol = "$",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  symbol?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">
        {symbol}
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlCls, "pl-7 tabular-nums")}
      />
    </div>
  );
}

/** Two or three mutually exclusive choices, as pills. */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-3xl bg-muted/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-3xl px-3.5 py-1.5 text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
            value === o.value
              ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/5"
              : "cursor-pointer text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A plain-language callout. `tone` is meaning, not decoration: destructive only for a real failure. */
export function Callout({ tone = "muted", children }: { tone?: "muted" | "destructive" | "primary"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-3xl px-4 py-3 text-sm leading-relaxed",
        tone === "muted" && "bg-muted/40",
        tone === "destructive" && "bg-destructive/10 text-destructive",
        tone === "primary" && "bg-primary-light text-foreground",
      )}
    >
      {children}
    </div>
  );
}
