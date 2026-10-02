"use client";

// ── Screens: the one standard every integration dialog follows ────────────────
//
// Set by the Bonzah dialog and rolled out to all of them (Ghulam, Oct 2 2026):
//
//   • Logo top-left, status top-right, no close ×, a soft brand wash — that
//     frame is the board's (integrations-board.tsx).
//   • The first three or four screens EDUCATE: a picture, a headline and a line
//     or two in Trax's voice, stacked and centred, with Back bottom-left and
//     Next bottom-right. The last one carries the one button that starts.
//   • An integration that is already active skips the education and opens on
//     its working screens.
//   • Nothing in a dialog scrolls. Working content is paged into screens that
//     fit, with the same Back / Next in the same corners.
//
// Bonzah predates this file and draws the same pieces itself; everything new
// uses these.

import {
  type ComponentType,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, PlugZap, RefreshCw, Unplug } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

/* ─────────────────────────────── width ──────────────────────────────────── */

/**
 * Education screens sit in a NARROW, near-square dialog; forms and working
 * screens get the wide one (Ghulam, Oct 2 2026: the wide dialog left a picture
 * and two lines of text floating in empty space at the sides). The board owns
 * the dialog and provides the setter; a hero screen asks for narrow while it
 * is mounted, and the dialog goes back to wide the moment it unmounts.
 */
export const DialogWidthContext = createContext<((narrow: boolean) => void) | null>(null);

export function useNarrowDialog() {
  const setNarrow = useContext(DialogWidthContext);
  useEffect(() => {
    setNarrow?.(true);
    return () => setNarrow?.(false);
  }, [setNarrow]);
}

/* ─────────────────────────────── the hero ───────────────────────────────── */

/** Picture on top, a few words and one action under it — stacked, centred. */
export function Hero({
  art: Art,
  eyebrow,
  title,
  children,
  actions,
  footer,
}: {
  art: ComponentType<{ className?: string }>;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  useNarrowDialog();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 py-1 text-center">
      <Art className="max-w-[400px]" />
      <div className="space-y-2">
        {eyebrow && (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        )}
        <h3 className="text-xl font-medium leading-snug text-foreground [text-wrap:balance]">{title}</h3>
        {/* Balanced lines, a little narrower than the column: no stray last
            word on a line of its own (Ghulam, Oct 2). */}
        {children && (
          <div className="mx-auto max-w-[34rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
            {children}
          </div>
        )}
      </div>
      {actions && <div className="w-full text-left">{actions}</div>}
      {footer && <div className="flex w-full flex-col items-center">{footer}</div>}
    </div>
  );
}

/** Back bottom-left, Next bottom-right. An empty span holds a corner. */
export function ScreenNav({
  onBack,
  onNext,
  nextLabel = "Next",
  className,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-between", className)}>
      {onBack ? (
        <Button variant="outline" data-screen-nav="back" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" />
          Back
        </Button>
      ) : (
        <span />
      )}
      {onNext ? (
        <Button variant="outline" data-screen-nav="next" onClick={onNext}>
          {nextLabel}
          <ArrowRight className="ml-1.5 size-4" />
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/** Secondary destinations, as quiet text — never a second button. */
export function QuietNav({ items }: { items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.onClick}
          disabled={it.disabled}
          className="text-xs text-muted-foreground underline-offset-4 transition-colors duration-200 hover:text-foreground hover:underline disabled:opacity-50 motion-reduce:transition-none"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A small focused screen behind a quiet link: a title, a line, its content,
 * and Back in the bottom-left corner. Narrow, like the hero screens.
 */
export function SubScreen({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  useNarrowDialog();
  return (
    <div className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
      <div className="mx-auto w-full max-w-xl space-y-4 py-2">
        <div className="space-y-1">
          <h3 className="text-lg font-medium leading-snug text-foreground">{title}</h3>
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
      <ScreenNav className="mt-8" onBack={onBack} />
    </div>
  );
}

/**
 * The one "is it still working?" control every connectable integration uses
 * (Ghulam, Oct 2) — a card at the foot of its Account details screen: a plug
 * icon whose colour is the answer, one line saying what is checked (or what
 * came back), and a compact Test button. `run` resolves to a short success
 * line ("Reached Zoho Books · 42 accounts") or throws the provider's own
 * words. With no truthful check available, pass `run={null}` and an
 * `unavailable` line instead — never a button that cannot prove anything.
 */
export function ConnectionTest({
  idle,
  run,
  unavailable,
  disabled,
  title = "Connection",
  icon: IdleIcon = PlugZap,
  confirm,
}: {
  /** What a test checks, shown before one is run. */
  idle: string;
  /**
   * The check. `say` puts each step on screen while it runs ("Checking the
   * number with Twilio…"), so a multi-step test reads as one.
   */
  run: ((say: (step: string) => void) => Promise<string>) | null;
  unavailable?: string;
  disabled?: boolean;
  title?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Ask first — for a test that costs money (a real call, a real text). */
  confirm?: { title: string; description: React.ReactNode; action: string };
}) {
  const [state, setState] = useState<{ kind: "idle" | "checking" | "ok" | "error"; text?: string }>({ kind: "idle" });
  const [asking, setAsking] = useState(false);
  const tone =
    state.kind === "ok"
      ? "bg-success/10 text-success"
      : state.kind === "error"
        ? "bg-warning/10 panel-ink-warn"
        : "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]";
  const Icon = state.kind === "ok" ? CheckCircle2 : state.kind === "error" ? AlertTriangle : IdleIcon;
  const start = async () => {
    if (!run) return;
    setState({ kind: "checking", text: "Checking…" });
    try {
      const text = await run((step) => setState({ kind: "checking", text: step }));
      setState({ kind: "ok", text });
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "The check failed." });
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-background/70 px-4 py-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200", tone)}>
        {state.kind === "checking" ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p
          className={cn(
            "truncate text-xs",
            state.kind === "ok" ? "text-success" : state.kind === "error" ? "panel-ink-warn" : "text-muted-foreground",
          )}
          title={state.text}
        >
          {run === null ? unavailable : state.text ?? idle}
        </p>
      </div>
      {run && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 rounded-full"
          disabled={disabled || state.kind === "checking"}
          onClick={() => (confirm ? setAsking(true) : void start())}
        >
          <RefreshCw className={cn("size-3.5", state.kind === "checking" && "animate-spin")} />
          {state.kind === "idle" ? "Test" : "Test again"}
        </Button>
      )}
      {confirm && (
        <AlertDialog open={asking} onOpenChange={setAsking}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setAsking(false);
                  void start();
                }}
              >
                {confirm.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/** A short pause so a demo check reads as a check, not an instant answer. */
export const demoCheck = (text: string) => new Promise<string>((r) => window.setTimeout(() => r(text), 1100));

/**
 * The one Disconnect screen every connectable integration uses (Ghulam, Oct 2:
 * unlinking is allowed from here — a button, then a confirmation). The
 * consequence is said beside the icon; the button asks once more before
 * `onConfirm` runs. Hidden for anyone who may not manage the integration.
 */
export function DisconnectScreen({
  name,
  consequence,
  canManage,
  pending,
  onConfirm,
  onBack,
}: {
  name: string;
  consequence: ReactNode;
  canManage: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SubScreen title={`Disconnecting ${name}`} onBack={onBack}>
      <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Unplug className="mt-0.5 size-4 shrink-0" />
        <span>{consequence}</span>
      </p>
      {canManage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="rounded-2xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen(true)}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Unplug />}
            {pending ? "Disconnecting…" : `Disconnect ${name}`}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">Only an admin or head admin can disconnect.</p>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
            <AlertDialogDescription>{consequence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SubScreen>
  );
}

/* ─────────────────────────────── the intro ──────────────────────────────── */

export type IntroSlide = {
  art: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

export type IntroSpec = {
  slides: readonly IntroSlide[];
  /** The one button on the last screen. */
  cta: string;
  /**
   * A preview integration (nothing to connect yet): the last button closes the
   * dialog instead of opening working screens that would only repeat the intro.
   */
  preview?: boolean;
};

/**
 * Three or four screens that teach what an integration is, then the one
 * button that starts it. Each screen fades and lifts in (V2_PLAN §12).
 */
export function IntroFlow({ spec, onStart }: { spec: IntroSpec; onStart: () => void }) {
  const [i, setI] = useState(0);
  const slide = spec.slides[i];
  const last = i === spec.slides.length - 1;
  return (
    <div
      key={i}
      className="duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
    >
      <Hero
        art={slide.art}
        title={slide.title}
        actions={
          last && (
            // A compact, centred button — not a full-width bar (Ghulam, Oct 2).
            <div className="flex justify-center">
              <Button className="h-10 rounded-2xl px-6" data-screen-nav="start" onClick={onStart}>
                {spec.cta}
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
            </div>
          )
        }
      >
        {slide.body}
      </Hero>
      <ScreenNav
        className="mt-8"
        onBack={i > 0 ? () => setI(i - 1) : undefined}
        onNext={!last ? () => setI(i + 1) : undefined}
      />
    </div>
  );
}

/* ─────────────────────────────── the pager ──────────────────────────────── */

const HIDDEN_ATTR = "data-sp-hidden";
/** Room kept under the last block so a focus ring or a descender is never clipped. */
const SAFETY = 24;

const spHide = (el: Element) => {
  el.setAttribute(HIDDEN_ATTR, "");
  el.setAttribute("hidden", "");
};
const spShow = (el: Element) => {
  if (!el.hasAttribute(HIDDEN_ATTR)) return;
  el.removeAttribute(HIDDEN_ATTR);
  el.removeAttribute("hidden");
};

/**
 * Pages a panel's working content into screens that fit the dialog — the
 * panel itself is unchanged. Top-level blocks (sections, notes, cards) are
 * packed in order; a block taller than a whole screen is split into its own
 * children. Hidden blocks stay MOUNTED, so a form keeps its values and a
 * dialog its state. Re-packs when the content changes (a form opening, data
 * arriving) or the window resizes, keeping the operator on their screen.
 */
export function ScreenPager({
  children,
  onBackFromStart,
}: {
  children: ReactNode;
  /** Back on the first screen — e.g. return to the intro. Hidden if absent. */
  onBackFromStart?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [part, setPart] = useState(0);
  const [count, setCount] = useState(1);
  const [tick, setTick] = useState(0);
  const unitsRef = useRef<{ el: Element; part: number }[]>([]);
  const partRef = useRef(0);
  partRef.current = part;

  const apply = useCallback((p: number) => {
    for (const u of unitsRef.current) {
      if (u.part === p) spShow(u.el);
      else spHide(u.el);
    }
  }, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const anchor = unitsRef.current.find((u) => u.part === partRef.current && u.el.isConnected)?.el ?? null;

    content.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(spShow);
    const limit = parseFloat(getComputedStyle(box).maxHeight) - SAFETY;
    if (!Number.isFinite(limit) || limit <= 0) return;

    const assigned: { el: Element; part: number }[] = [];
    let p = 0;
    let start: number | null = null;
    let onPart = 0;
    const visit = (parent: Element) => {
      for (const el of Array.from(parent.children)) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) {
          assigned.push({ el, part: p });
          continue;
        }
        if (start === null) start = r.top;
        const fits = r.bottom - start <= limit;
        // A wrapper with one child is structure: walk through it. A block
        // too tall for a whole screen has to split into its children.
        if (!fits && (el.children.length === 1 || (r.height > limit && el.children.length >= 2))) {
          visit(el);
          continue;
        }
        if (!fits && onPart > 0) {
          // Never end a screen on a heading or a tab bar — it belongs with
          // what follows it, so it moves to the next screen too.
          const prev = assigned[assigned.length - 1];
          const pr = prev?.el.getBoundingClientRect();
          const lead =
            !!prev &&
            prev.part === p &&
            onPart > 1 &&
            !!pr &&
            pr.height > 0 &&
            (prev.el.matches('[role="tablist"]') ||
              !!prev.el.querySelector('[role="tablist"]') ||
              (pr.height < 64 && !!prev.el.matches("h2, h3, h4, :has(> h2), :has(> h3), :has(> h4)")));
          p += 1;
          onPart = 0;
          start = r.top;
          if (lead) {
            prev.part = p;
            onPart = 1;
            start = pr.top;
          }
        }
        assigned.push({ el, part: p });
        onPart += 1;
      }
    };
    visit(content);

    unitsRef.current = assigned;
    const total = p + 1;
    const next = anchor
      ? assigned.find((u) => u.el === anchor)?.part ?? Math.min(partRef.current, total - 1)
      : Math.min(partRef.current, total - 1);
    apply(next);
    setCount(total);
    setPart(next);
  }, [tick, apply]);

  useLayoutEffect(() => {
    apply(part);
  }, [part, apply]);

  useEffect(() => {
    const content = contentRef.current;
    const box = boxRef.current;
    if (!content || !box) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const mo = new MutationObserver(schedule);
    mo.observe(content, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const paged = count > 1;
  return (
    <div className="flex flex-col">
      <div
        ref={boxRef}
        className={cn(
          // Fixed height once there is more than one screen, so the dialog
          // does not change size from screen to screen.
          "max-h-[calc(94vh_-_12rem)] min-h-0 overflow-hidden [&_[data-sp-hidden]]:!hidden",
          paged && "h-[calc(94vh_-_12rem)]",
        )}
      >
        <div ref={contentRef} key={0} className="px-0.5 pt-0.5">
          {children}
        </div>
      </div>
      {(paged || onBackFromStart) && (
        <ScreenNav
          className="mt-3"
          onBack={part > 0 ? () => setPart(part - 1) : onBackFromStart}
          onNext={part < count - 1 ? () => setPart(part + 1) : undefined}
        />
      )}
    </div>
  );
}
