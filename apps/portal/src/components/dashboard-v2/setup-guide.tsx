"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Maximize2, Minimize2, X } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import {
  useSetupGuide,
  type SetupGuideGroup,
  type SetupGuideItem,
} from "@/hooks/use-setup-guide";
import {
  ExplainerChip,
  ExplainerShelfButton,
} from "@/components/explainers/explainer";
import { listReadyExplainers } from "@/lib/explainers";

type PanelState = "expanded" | "minimized" | "closed";

/**
 * The pill itself is deliberately quiet — this ring is the one loud thing on
 * it, drawn in the tenant's brand colour against a faint track so progress
 * reads at a glance without the whole control shouting.
 */
function ProgressRing({ progress }: { progress: number }) {
  const size = 18;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90 shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-primary/15"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (progress / 100) * circumference}
        className="text-primary transition-[stroke-dashoffset] duration-700 ease-out"
      />
    </svg>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function PanelButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Group({
  group,
  isOpen,
  onToggle,
  onNavigate,
}: {
  group: SetupGuideGroup;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <div className={isOpen ? "bg-muted/40" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
      >
        <span
          className={`text-sm font-medium ${
            group.isComplete
              ? "text-muted-foreground line-through"
              : "text-foreground"
          }`}
        >
          {group.title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!group.isComplete && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {group.completedCount}/{group.items.length}
            </span>
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {isOpen && (
        <ul className="space-y-0.5 px-2 pb-2.5">
          {group.items.map((item) => (
            // The row is a flex CONTAINER, not a button, so the video slot can
            // sit beside the navigation target. A <button> inside a <button> is
            // invalid HTML and React hydrates it wrong, so the label keeps the
            // button and the chip is its sibling.
            <li key={item.id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => onNavigate(item.href)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-background"
              >
                {item.isComplete ? (
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
                    <Check
                      className="size-2.5 text-primary-foreground"
                      strokeWidth={3}
                    />
                  </span>
                ) : (
                  <span className="mt-0.5 size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/40" />
                )}
                <span
                  className={`text-sm leading-snug ${
                    item.isComplete
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {item.label}
                </span>
              </button>

              {/* The highest-value slot in the product: the operator is stuck
                  on this exact task right now. Renders nothing until the video
                  exists, so the row is unchanged today. */}
              {item.explainerId && (
                <ExplainerChip
                  id={item.explainerId}
                  variant="link"
                  className="mt-2"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Stripe-style setup guide.
 *
 * Two pieces that move together:
 *  - a pill in the dashboard's primary action slot (where New Rental lives once
 *    setup is finished), carrying the progress ring;
 *  - a card docked to the bottom-right of the viewport with three states —
 *    expanded (all groups), minimized (just "Next: …"), and closed.
 *
 * The card is portalled to `document.body` rather than rendered in place. It is
 * `position: fixed`, and any ancestor with a transform or filter would silently
 * become its containing block and drag it back into the header.
 *
 * It defaults to MINIMIZED rather than closed or expanded: present enough to
 * name the single next action, small enough not to sit on top of the dashboard.
 */
export function SetupGuide() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { groups, progressPercent, completedItems, totalItems, isVisible } =
    useSetupGuide();

  const stateKey = tenant?.id ? `setup-guide-state-${tenant.id}` : null;

  // Null until the stored preference for THIS tenant has been read, so we never
  // flash the expanded panel at someone who minimized it.
  const [panelState, setPanelState] = useState<PanelState | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!stateKey) return;
    const stored = localStorage.getItem(stateKey);
    setPanelState(
      stored === "expanded" || stored === "minimized" || stored === "closed"
        ? stored
        : "minimized"
    );
  }, [stateKey]);

  const setState = (next: PanelState) => {
    setPanelState(next);
    if (stateKey) localStorage.setItem(stateKey, next);
  };

  const firstIncompleteGroupId = useMemo(
    () => groups.find((g) => !g.isComplete)?.id ?? null,
    [groups]
  );

  const nextItem: SetupGuideItem | null = useMemo(() => {
    for (const group of groups) {
      const item = group.items.find((i) => !i.isComplete);
      if (item) return item;
    }
    return null;
  }, [groups]);

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  // Read once per render rather than inside the footer, so the footer's border
  // is dropped along with the button it would otherwise wrap around nothing.
  const hasGuides = listReadyExplainers().length > 0;

  // Land the operator on the group they are actually working on, the way
  // Stripe opens "Test Connect" for you. Only ever seeds the initial value —
  // once a group has been opened by hand, a background refetch that completes
  // an item must not yank the panel to a different section mid-read.
  //
  // The `isVisible` guard is load-bearing. Effects still run during the render
  // that returns null below, and with no data loaded yet every item reads as
  // incomplete — so seeding early would always latch onto the FIRST group and
  // then refuse to move, opening the panel on "Tell us about your business"
  // for an operator who finished that part weeks ago.
  useEffect(() => {
    if (!isVisible) return;
    setOpenGroupId((current) => current ?? firstIncompleteGroupId);
  }, [isVisible, firstIncompleteGroupId]);

  if (!isVisible) return null;

  const handleNavigate = (href: string) => {
    router.push(href);
  };

  const pill = (
    <button
      type="button"
      onClick={() =>
        setState(panelState === "expanded" ? "closed" : "expanded")
      }
      className="flex h-9 items-center gap-2.5 rounded-full border border-border/60 bg-card pl-4 pr-3 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
    >
      Setup guide
      <ProgressRing progress={progressPercent} />
    </button>
  );

  // Sits tight to the bottom-right corner. It overlaps the QuickDock — pinned
  // to the right edge at half height — only while expanded, and wins on
  // z-index, which is the right call for a panel the operator just opened.
  const dockClasses =
    "fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl";

  const card =
    panelState === "minimized" ? (
      <div className={dockClasses}>
        <div className="px-4 pb-3.5 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Setup guide</h3>
            <div className="flex items-center gap-0.5">
              <PanelButton
                label="Expand setup guide"
                onClick={() => setState("expanded")}
              >
                <Maximize2 className="size-3.5" />
              </PanelButton>
              <PanelButton
                label="Close setup guide"
                onClick={() => setState("closed")}
              >
                <X className="size-4" />
              </PanelButton>
            </div>
          </div>

          <div className="mt-2.5">
            <ProgressBar progress={progressPercent} />
          </div>

          {nextItem && (
            <p className="mt-3 text-sm text-muted-foreground">
              Next:{" "}
              <button
                type="button"
                onClick={() => handleNavigate(nextItem.href)}
                className="text-left font-medium text-primary hover:underline"
              >
                {nextItem.label}
              </button>
            </p>
          )}
        </div>
      </div>
    ) : panelState === "expanded" ? (
      <div className={dockClasses}>
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">Setup guide</h3>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {completedItems} of {totalItems}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <PanelButton
                label="Minimize setup guide"
                onClick={() => setState("minimized")}
              >
                <Minimize2 className="size-3.5" />
              </PanelButton>
              <PanelButton
                label="Close setup guide"
                onClick={() => setState("closed")}
              >
                <X className="size-4" />
              </PanelButton>
            </div>
          </div>

          <div className="mt-2.5">
            <ProgressBar progress={progressPercent} />
          </div>
        </div>

        <div className="max-h-[min(60vh,520px)] divide-y divide-border overflow-y-auto border-t border-border">
          {groups.map((group) => (
            <Group
              key={group.id}
              group={group}
              isOpen={openGroupId === group.id}
              onToggle={() =>
                setOpenGroupId((current) =>
                  current === group.id ? null : group.id
                )
              }
              onNavigate={handleNavigate}
            />
          ))}
        </div>

        {/* The browse-and-re-find shelf, for the operator who watched something
            once and wants it again. Hung off the guide rather than given its
            own route: an unmapped route in lib/permissions.ts is treated as
            ALLOWED, so a /guides page would silently widen what a manager with
            no grants can reach. The whole strip is dropped — not just the
            button — while no video exists, so there is no empty footer. */}
        {hasGuides && (
          <div className="border-t border-border px-4 py-2.5">
            <ExplainerShelfButton />
          </div>
        )}
      </div>
    ) : null;

  return (
    <>
      {pill}
      {mounted && card ? createPortal(card, document.body) : null}
    </>
  );
}
