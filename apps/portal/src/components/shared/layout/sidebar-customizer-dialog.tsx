"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
// The source worktree drew these in `@phosphor-icons/react`, which is not a
// dependency here and is not being added for a canary:
//   DotsSixVertical → GripVertical   EyeSlash → EyeOff
import { ArrowUp, ArrowDown, ChevronRight, GripVertical, Eye, EyeOff, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { useToast } from "@/hooks/use-toast";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import {
  applyNavPreferences,
  isPermanentNavHref,
  type NavPreferences,
  type OverlayNavGroup,
  type OverlayNavItem,
} from "@/lib/nav-preferences";

/**
 * Working shape while the dialog is open. Deliberately concrete lists rather
 * than the sparse `NavPreferences` overlay — dragging a row is an operation on
 * a list, and converting on save keeps the drag code from having to reason
 * about "unlisted means end of the line".
 *
 * `more` joined `top` and `groups` on Sep 20 2026, when the flat "More" rows
 * became customisable. It is a THIRD bucket, not a fourth kind of thing: it
 * maps to `NavPreferences.moreOrder` exactly as `top` maps to `topLevelOrder`.
 */
interface Draft {
  top: string[];
  more: string[];
  groups: { label: string; items: string[] }[];
  hidden: string[];
}

interface RowProps {
  label: string;
  icon: any;
  onHide?: () => void;
  onShow?: () => void;
  /** Promote a group item into the main rail. */
  onPin?: () => void;
  /** Send a promoted item back to the group it came from. */
  onUnpin?: () => void;
  hidden?: boolean;
  /** Permanent rows show a lock instead of a hide button. */
  locked?: boolean;
  /** Off by default: the pool offers it as "Add", not "Show". */
  optional?: boolean;
}

const ROW_CLASS =
  "flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2.5";

function RowContent({
  label,
  icon: Icon,
  onHide,
  onShow,
  onPin,
  onUnpin,
  hidden,
  locked,
  optional,
  handle,
}: RowProps & { handle: React.ReactNode }) {
  return (
    <>
      {handle}
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="flex-1 truncate text-[13px]">{label}</span>
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          aria-label={`Pin ${label} to the main rail`}
          title="Pin to main"
          className="rounded-md p-1 text-muted-foreground/60 transition-colors cursor-pointer hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground"
        >
          <ArrowUp className="size-4" />
        </button>
      )}
      {onUnpin && (
        <button
          type="button"
          onClick={onUnpin}
          aria-label={`Return ${label} to its group`}
          title="Return to its group"
          className="rounded-md p-1 text-muted-foreground/60 transition-colors cursor-pointer hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
      {locked ? (
        // No hide button at all, and a reason rather than a disabled control:
        // a greyed-out eye invites a click that will never do anything.
        <span
          title="Always in your sidebar"
          aria-label={`${label} is always in your sidebar`}
          className="flex items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground/70"
        >
          <Lock className="size-3.5" aria-hidden />
        </span>
      ) : hidden ? (
        <button
          type="button"
          onClick={onShow}
          aria-label={`${optional ? "Add" : "Show"} ${label}`}
          title={optional ? "Add to your sidebar" : "Show"}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors cursor-pointer hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground"
        >
          <Eye className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${label}`}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors cursor-pointer hover:bg-[hsl(var(--v2-hover,var(--muted)))] hover:text-foreground"
        >
          <EyeOff className="size-4" />
        </button>
      )}
    </>
  );
}

/**
 * The hidden pool is a plain list, not a sortable one. It used to render
 * `SortableRow`, which registered every hidden link as a droppable with no
 * `SortableContext` around it — those stray droppables then competed for
 * collisions with the real lists and swallowed drops.
 */
function StaticRow(props: RowProps) {
  return (
    <div className={ROW_CLASS}>
      <RowContent {...props} handle={null} />
    </div>
  );
}

function SortableRow({ id, ...props }: RowProps & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${ROW_CLASS} ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <RowContent
        {...props}
        handle={
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
            aria-label={`Reorder ${props.label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  );
}

/** One row of the preview, drawn to read like the rail rather than like a list. */
function PreviewRow({
  item,
  muted,
  chevron,
}: {
  item: { name: string; icon: any };
  muted?: boolean;
  chevron?: boolean;
}) {
  const Icon = item.icon;
  return (
    <div
      className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium ${
        muted ? "text-muted-foreground/70" : "text-foreground/80"
      }`}
    >
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground/70" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {chevron && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />}
    </div>
  );
}

export function SidebarCustomizerDialog({
  open,
  onOpenChange,
  topLevel,
  groups,
  more = [],
  fixed = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sidebar as COMPUTED this render — before any overlay is applied. */
  topLevel: OverlayNavItem[];
  groups: OverlayNavGroup[];
  /** The flat "More" rows, which are customisable as of Sep 20 2026. */
  more?: OverlayNavItem[];
  /**
   * Rows the sidebar renders itself and this dialog does not own — Dashboard,
   * Integrations and Billing. They are passed in ONLY so the preview can show
   * them where they actually sit, above everything else, and so the user can
   * see that they are permanent rather than wonder why they are missing from
   * the lists.
   */
  fixed?: OverlayNavItem[];
}) {
  const { toast } = useToast();
  const { preferences, save, isSaving, isUnavailable, isLoading } =
    useNavPreferences();

  // Every item the user is allowed to see, by href. The catalogue is derived
  // from the computed nav rather than a hardcoded list, so it can never offer
  // a link the user's permissions or the tenant's feature flags exclude.
  const catalogue = useMemo(() => {
    const byHref = new Map<string, OverlayNavItem>();
    for (const item of topLevel) byHref.set(item.href, item);
    for (const item of more) byHref.set(item.href, item);
    for (const group of groups)
      for (const item of group.items) byHref.set(item.href, item);
    return byHref;
  }, [topLevel, groups, more]);

  const originalTopHrefs = useMemo(
    () => new Set(topLevel.map((item) => item.href)),
    [topLevel]
  );
  const moreHrefs = useMemo(() => new Set(more.map((item) => item.href)), [more]);
  /** Off-by-default rows: the pool offers these as "Add" rather than "Show". */
  const optionalHrefs = useMemo(
    () =>
      new Set(
        [...catalogue.values()].filter((item) => item.optional === true).map((i) => i.href)
      ),
    [catalogue]
  );

  const buildDraft = (): Draft => {
    const applied = applyNavPreferences({ topLevel, groups, more, preferences });
    const visible = new Set<string>();
    applied.topLevel.forEach((item) => visible.add(item.href));
    applied.more.forEach((item) => visible.add(item.href));
    applied.groups.forEach((group) =>
      group.items.forEach((item) => visible.add(item.href))
    );

    return {
      top: applied.topLevel.map((item) => item.href),
      more: applied.more.map((item) => item.href),
      // Groups emptied by hiding drop out of `applied`, but the user still has
      // to be able to see and restore what was in them — so the draft keeps
      // every computed group, with only its visible items.
      groups: groups.map((group) => ({
        label: group.label,
        items: (
          applied.groups.find((g) => g.label === group.label)?.items ?? []
        ).map((item) => item.href),
      })),
      hidden: [...catalogue.keys()].filter((href) => !visible.has(href)),
    };
  };

  const [draft, setDraft] = useState<Draft>(buildDraft);

  /**
   * Seed the draft ONCE per opening, on the rising edge of `open`.
   *
   * This effect used to also depend on `preferences`, `topLevel` and `groups`.
   * The latter two are rebuilt as fresh array literals on every AppSidebar
   * render — and AppSidebar re-renders constantly, since it holds the reminder,
   * pending-booking, unread-message, enquiry and subscription queries. So the
   * effect re-fired every few seconds and overwrote the draft with the SAVED
   * preferences: reorder or hide something, and moments later it snapped back.
   *
   * Waiting on `isLoading` matters too. Opening the dialog before the
   * preferences query resolves would otherwise seed from an empty overlay, and
   * saving that would wipe an arrangement the user never touched.
   */
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || isLoading) return;
    setDraft(buildDraft());
    seededRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading]);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so the hide button and the
    // grab handle sitting inches apart don't fight each other.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  /**
   * Restrict every drag to its own list.
   *
   * All four kinds of row — rail items, More rows, group headers, group items
   * — live in one `DndContext` and are interleaved down a single column. Plain
   * `closestCenter` therefore hands back whatever row is nearest, which is
   * routinely one from a DIFFERENT list; the drop is then discarded and the
   * row springs back. That is the "dragging doesn't work properly" — it
   * worked only when the nearest neighbour happened to be the right kind.
   *
   * Filtering the candidates first means the nearest VALID target always wins,
   * so a drop can never be silently thrown away. Group items are scoped by
   * their group as well, which is what keeps an item from jumping groups.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const scopeOf = (id: string) => {
      const kind = id.slice(0, id.indexOf(":"));
      if (kind !== "item") return kind;
      const rest = id.slice(id.indexOf(":") + 1);
      return `item:${rest.split("::")[0]}`;
    };

    const activeScope = scopeOf(String(args.active.id));
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => scopeOf(String(container.id)) === activeScope
      ),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Ids are namespaced so one DndContext can host four kinds of list
    // without a group header ever swapping places with a link.
    const container = (id: string) => id.slice(0, id.indexOf(":"));
    const value = (id: string) => id.slice(id.indexOf(":") + 1);

    if (container(activeId) !== container(overId)) return;

    setDraft((current) => {
      const kind = container(activeId);

      if (kind === "top") {
        const from = current.top.indexOf(value(activeId));
        const to = current.top.indexOf(value(overId));
        if (from < 0 || to < 0) return current;
        return { ...current, top: arrayMove(current.top, from, to) };
      }

      if (kind === "more") {
        const from = current.more.indexOf(value(activeId));
        const to = current.more.indexOf(value(overId));
        if (from < 0 || to < 0) return current;
        return { ...current, more: arrayMove(current.more, from, to) };
      }

      if (kind === "grouphead") {
        const labels = current.groups.map((g) => g.label);
        const from = labels.indexOf(value(activeId));
        const to = labels.indexOf(value(overId));
        if (from < 0 || to < 0) return current;
        return { ...current, groups: arrayMove(current.groups, from, to) };
      }

      // `item:<group label>::<href>` — the label rides along so items can only
      // ever be reordered inside the group they belong to.
      const [label, href] = value(activeId).split("::");
      const [, overHref] = value(overId).split("::");
      return {
        ...current,
        groups: current.groups.map((group) => {
          if (group.label !== label) return group;
          const from = group.items.indexOf(href);
          const to = group.items.indexOf(overHref);
          if (from < 0 || to < 0) return group;
          return { ...group, items: arrayMove(group.items, from, to) };
        }),
      };
    });
  };

  const hide = (href: string) =>
    setDraft((current) => {
      // Belt and braces. The button is not rendered for a permanent row, and
      // `parseNavPreferences` drops one from `hidden` on the way back in — but
      // a group "hide everything" sweep runs over a list, and this is where
      // that list is walked.
      if (isPermanentNavHref(href)) return current;
      return {
        top: current.top.filter((h) => h !== href),
        more: current.more.filter((h) => h !== href),
        groups: current.groups.map((group) => ({
          ...group,
          items: group.items.filter((h) => h !== href),
        })),
        hidden: current.hidden.includes(href)
          ? current.hidden
          : [...current.hidden, href],
      };
    });

  const show = (href: string) =>
    setDraft((current) => {
      const home = groups.find((group) =>
        group.items.some((item) => item.href === href)
      );
      const isMore = moreHrefs.has(href);
      return {
        // Restoring returns a link to where it came from, not to wherever the
        // user happens to be looking.
        top: home || isMore ? current.top : [...current.top, href],
        more: isMore ? [...current.more, href] : current.more,
        groups: current.groups.map((group) =>
          home && group.label === home.label
            ? { ...group, items: [...group.items, href] }
            : group
        ),
        hidden: current.hidden.filter((h) => h !== href),
      };
    });

  /** Promote a group item into the main rail. */
  const pin = (href: string) =>
    setDraft((current) => ({
      ...current,
      top: current.top.includes(href) ? current.top : [...current.top, href],
      groups: current.groups.map((group) => ({
        ...group,
        items: group.items.filter((h) => h !== href),
      })),
    }));

  /** Send a promoted item back to the group it came from. */
  const unpin = (href: string) =>
    setDraft((current) => {
      const home = groups.find((group) =>
        group.items.some((item) => item.href === href)
      );
      if (!home) return current;
      return {
        ...current,
        top: current.top.filter((h) => h !== href),
        groups: current.groups.map((group) =>
          group.label === home.label
            ? { ...group, items: [...group.items, href] }
            : group
        ),
      };
    });

  const toPreferences = (value: Draft): NavPreferences => {
    const visible = new Set<string>([
      ...value.top,
      ...value.more,
      ...value.groups.flatMap((group) => group.items),
    ]);
    return {
      topLevelOrder: value.top,
      moreOrder: value.more,
      groupOrder: value.groups.map((group) => group.label),
      groupItemOrder: Object.fromEntries(
        value.groups.map((group) => [group.label, group.items])
      ),
      // An off-by-default row that is still absent is NOT "hidden" — it was
      // never there. Recording it as hidden would be harmless today and wrong
      // the moment one of them is switched on by default, so the two states
      // are kept apart: `shown` says what was added, `hidden` what was taken
      // away. Permanent rows can appear in neither.
      hidden: value.hidden.filter(
        (href) => !optionalHrefs.has(href) && !isPermanentNavHref(href)
      ),
      shown: [...optionalHrefs].filter((href) => visible.has(href)),
      // Anything sitting in the rail that did not start there was promoted.
      pinned: value.top.filter((href) => !originalTopHrefs.has(href)),
    };
  };

  const persist = async (value: NavPreferences, message: string) => {
    try {
      await save(value);
      toast({ title: message });
      onOpenChange(false);
    } catch {
      toast({
        title: "Could not save your sidebar",
        description: "Your changes were not stored. Please try again.",
        variant: "destructive",
      });
    }
  };

  const visibleGroups = draft.groups.filter((group) => group.items.length > 0);
  const itemsOf = (hrefs: string[]) =>
    hrefs.map((href) => catalogue.get(href)).filter(Boolean) as OverlayNavItem[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:max-w-*`, not `max-w-*`: DialogContent's base carries
          `sm:max-w-md`, and an unprefixed utility loses to it above 640px —
          which is every screen this dialog is used on. Widened 4xl → 5xl → 6xl:
          the preview is a real sidebar at its real width, so the column has to
          fit one without wrapping its labels.

          `max-h-[92vh]` with `overflow-y-auto` is the outer safety net, and it
          is deliberately the LAST resort: the two working columns cap and
          scroll themselves (below), and the preview is never capped, so this
          only engages for a sidebar long enough to outgrow the screen on its
          own. Without it such a preview would be clipped by the dialog edge
          with no way to reach the rest. */}
      <DialogContent className="gap-0 p-0 sm:max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="border-b border-border px-7 py-5">
          <DialogTitle>Customise sidebar</DialogTitle>
          <DialogDescription>
            Drag to reorder, hide anything you don&apos;t use, and add the pages
            you do. A few rows stay put. This only changes your own sidebar.
          </DialogDescription>
        </DialogHeader>

        {isUnavailable ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            Your saved sidebar could not be loaded, so customising is
            unavailable right now.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
          >
            {/* ONE scroller became THREE, and the difference is what the
                preview is for. This grid used to carry `max-h-[62vh]
                overflow-y-auto`, so all three columns scrolled TOGETHER inside
                one box: scrolling to the bottom of "Your sidebar" dragged the
                preview out of view, and the preview — the thing you are
                checking your changes against — could never be seen whole.

                Now the two working columns cap and scroll themselves, and the
                preview is left at its natural height so it never scrolls at
                all. The columns still STRETCH to a shared row height (the grid
                default) rather than each ending at its own content: the
                dividers between them are the column borders, and ragged
                half-height dividers look like a rendering fault. The caps do
                the work instead — the row is as tall as the preview needs, and
                the two working columns scroll inside it.

                Below `sm` the columns stack into a single narrow page, where
                three independent scroll areas would be worse than one: the
                original single-scroller behaviour is kept for that case and
                switched off at `sm`. */}
            <div className="grid max-h-[62vh] grid-cols-1 divide-y divide-border overflow-y-auto sm:max-h-none sm:grid-cols-[260px_1fr_280px] sm:divide-x sm:divide-y-0 sm:overflow-visible">
              {/* Hidden / available pool */}
              <div className="px-6 py-5 sm:max-h-[68vh] sm:min-h-0 sm:overflow-y-auto sm:[scrollbar-width:thin] sm:[scrollbar-color:rgb(120_120_135_/_0.3)_transparent]">
                <h4 className="mb-1 text-[13px] font-semibold">Not shown</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Links you&apos;ve removed, and the ones you can add.
                </p>
                {draft.hidden.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing hidden
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draft.hidden.map((href) => {
                      const item = catalogue.get(href);
                      if (!item) return null;
                      return (
                        <StaticRow
                          key={href}
                          label={item.name}
                          icon={item.icon}
                          hidden
                          optional={optionalHrefs.has(href)}
                          onShow={() => show(href)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* The sidebar itself */}
              <div className="px-6 py-5 sm:max-h-[68vh] sm:min-h-0 sm:overflow-y-auto sm:[scrollbar-width:thin] sm:[scrollbar-color:rgb(120_120_135_/_0.3)_transparent]">
                <h4 className="mb-3.5 text-[13px] font-semibold">Your sidebar</h4>

                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Main
                </p>
                <SortableContext
                  items={draft.top.map((href) => `top:${href}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="mb-5 space-y-2">
                    {draft.top.map((href) => {
                      const item = catalogue.get(href);
                      if (!item) return null;
                      return (
                        <SortableRow
                          key={href}
                          id={`top:${href}`}
                          label={item.name}
                          icon={item.icon}
                          // Only a promoted item can go back down; the stock
                          // rail items have no group to return to.
                          onUnpin={
                            originalTopHrefs.has(href)
                              ? undefined
                              : () => unpin(href)
                          }
                          locked={isPermanentNavHref(href)}
                          onHide={() => hide(href)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

                {draft.more.length > 0 && (
                  <>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      More
                    </p>
                    <SortableContext
                      items={draft.more.map((href) => `more:${href}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="mb-5 space-y-2">
                        {draft.more.map((href) => {
                          const item = catalogue.get(href);
                          if (!item) return null;
                          return (
                            <SortableRow
                              key={href}
                              id={`more:${href}`}
                              label={item.name}
                              icon={item.icon}
                              locked={isPermanentNavHref(href)}
                              onHide={() => hide(href)}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </>
                )}

                <SortableContext
                  items={visibleGroups.map((group) => `grouphead:${group.label}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-5">
                    {visibleGroups.map((group) => {
                      const groupIcon = groups.find(
                        (g) => g.label === group.label
                      )?.icon;
                      return (
                        <div key={group.label}>
                          <SortableRow
                            id={`grouphead:${group.label}`}
                            label={group.label}
                            icon={groupIcon}
                            onHide={() =>
                              group.items.forEach((href) => hide(href))
                            }
                          />
                          <SortableContext
                            items={group.items.map(
                              (href) => `item:${group.label}::${href}`
                            )}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="mt-2 space-y-2 pl-5">
                              {group.items.map((href) => {
                                const item = catalogue.get(href);
                                if (!item) return null;
                                return (
                                  <SortableRow
                                    key={href}
                                    id={`item:${group.label}::${href}`}
                                    label={item.name}
                                    icon={item.icon}
                                    onPin={() => pin(href)}
                                    locked={isPermanentNavHref(href)}
                                    onHide={() => hide(href)}
                                  />
                                );
                              })}
                            </div>
                          </SortableContext>
                        </div>
                      );
                    })}
                  </div>
                </SortableContext>
              </div>

              {/* Preview.
                  Asked for by name ("needs a preview"), and it is the only
                  part of this dialog that answers the question the user
                  actually has: what will the rail look like. It is drawn from
                  the SAME draft the lists are, so it cannot disagree with
                  them, and it is deliberately a picture rather than a second
                  set of controls — two places to drag the same row is how the
                  first version of this dialog went wrong. */}
              <div className="px-6 py-5" data-testid="sidebar-preview">
                <h4 className="mb-1 text-[13px] font-semibold">Preview</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  How your sidebar will look.
                </p>
                <div className="rounded-xl border border-border bg-muted/20 p-2">
                  {fixed.length > 0 && (
                    <div className="mb-2 space-y-0.5">
                      {fixed.map((item) => (
                        <PreviewRow key={item.href} item={item} muted />
                      ))}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {itemsOf(draft.top).map((item) => (
                      <PreviewRow key={item.href} item={item} />
                    ))}
                  </div>
                  {(draft.more.length > 0 || visibleGroups.length > 0) && (
                    <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      More
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {itemsOf(draft.more).map((item) => (
                      <PreviewRow key={item.href} item={item} />
                    ))}
                    {visibleGroups.map((group) => {
                      const groupIcon = groups.find((g) => g.label === group.label)?.icon;
                      return (
                        <PreviewRow
                          key={group.label}
                          item={{ name: group.label, icon: groupIcon }}
                          chevron
                        />
                      );
                    })}
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Dashboard, Integrations, Billing, Customers and Rentals are
                  always in your sidebar.
                </p>
              </div>
            </div>
          </DndContext>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border px-7 py-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving || isUnavailable}
            onClick={() =>
              persist(
                {
                  topLevelOrder: [],
                  groupOrder: [],
                  groupItemOrder: {},
                  hidden: [],
                  pinned: [],
                  moreOrder: [],
                  shown: [],
                },
                "Sidebar reset to default"
              )
            }
          >
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isSaving || isUnavailable}
              onClick={() => persist(toPreferences(draft), "Sidebar updated")}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
