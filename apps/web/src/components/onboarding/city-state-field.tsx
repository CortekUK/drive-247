"use client";

/**
 * "City and state" as a pick-from-the-list field (Ghulam, 2026-11-23).
 *
 * Typing shows up to six US places, largest first ("hou" puts Houston, TX at
 * the top); a tap, or the arrow keys and Enter, puts "Houston, TX" in the box.
 * A place that is not listed can still be typed in full, so nobody is stuck:
 * the field's rule (`validateCityState`) is unchanged.
 *
 * The list (lib/us-cities.ts) loads the first time the field is focused. The
 * suggestions open in a popover raised above the full-screen signup (z-[250],
 * like the "How did you hear about us?" dropdown), so they are never cut off
 * by the screen and flip upwards when there is no room below. Focus stays in
 * the box the whole time: the options are picked with the pointer or keys,
 * never focused.
 */

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { MapPin } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { loadUsCities, searchCities, type CityOption } from "@/lib/us-cities";

interface CityStateFieldProps {
  id: string;
  value: string;
  placeholder?: string;
  busy: boolean;
  maxLength: number;
  invalid: boolean;
  describedBy?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
  onChange(value: string): void;
}

export function CityStateField({
  id,
  value,
  placeholder,
  busy,
  maxLength,
  invalid,
  describedBy,
  inputRef,
  className,
  onChange,
}: CityStateFieldProps) {
  const listId = `${id}-options`;
  const [cities, setCities] = React.useState<CityOption[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef<HTMLInputElement | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      boxRef.current = node;
      if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  const load = () => {
    if (cities) return;
    loadUsCities()
      .then(setCities)
      // Without the list it is a plain text box, which still works.
      .catch((e) => console.warn("[signup] city list did not load", e));
  };

  const options = React.useMemo(
    () => (cities && value.trim() ? searchCities(cities, value) : []),
    [cities, value],
  );
  const shown = open && options.length > 0;

  const pick = (option: CityOption) => {
    onChange(option.label);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={shown} onOpenChange={(next) => !next && setOpen(false)}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          ref={setRefs}
          id={id}
          name="cityState"
          type="text"
          // `off`, not `address-level2`: that autofills the city alone and
          // leaves the state out without anyone noticing.
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown ? `${listId}-${active}` : undefined}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={value}
          disabled={busy}
          maxLength={maxLength}
          onFocus={load}
          onChange={(e) => {
            load();
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!shown) {
                setActive(0);
                setOpen(true);
              } else {
                setActive((i) => (i + 1) % options.length);
              }
            } else if (e.key === "ArrowUp" && shown) {
              e.preventDefault();
              setActive((i) => (i - 1 + options.length) % options.length);
            } else if (e.key === "Enter" && shown && options[active]) {
              // Picks the place instead of submitting the form.
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === "Escape" && shown) {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
          className={className}
        />
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          // The box keeps the focus and the caret.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // A tap back in the box is not "outside".
          onInteractOutside={(e) => {
            if (e.target instanceof Node && boxRef.current?.contains(e.target)) e.preventDefault();
          }}
          className="z-[250] max-h-[min(17rem,var(--radix-popper-available-height))] w-[var(--radix-popper-anchor-width)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1 text-[15px] text-zinc-900 shadow-lg shadow-indigo-950/10 dark:border-white/10 dark:bg-[#17171f] dark:text-zinc-100"
        >
          <ul role="listbox" id={listId} aria-label="Cities">
            {options.map((option, i) => (
              <li
                key={option.label}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Keeps the focus in the box while the option is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2.5 rounded-lg py-2 pr-3 pl-2.5",
                  i === active && "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
                )}
              >
                <MapPin aria-hidden className="size-4 shrink-0 opacity-50" />
                <span className="truncate">
                  {option.city}
                  <span className="text-muted-foreground">, {option.state}</span>
                </span>
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
