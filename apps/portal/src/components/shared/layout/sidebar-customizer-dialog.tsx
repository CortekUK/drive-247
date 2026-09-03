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
import { ArrowUp, ArrowDown, GripVertical, Eye, EyeOff } from "lucide-react";
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
  type NavPreferences,
  type OverlayNavGroup,
  type OverlayNavItem,
} from "@/lib/nav-preferences";

/**
 * Working shape while the dialog is open. Deliberately concrete lists rather
 * than the sparse `NavPreferences` overlay — dragging a row is an operation on
 * a list, and converting on save keeps the drag code from having to reason
 * about "unlisted means end of the line".
 */
interface Draft {
  top: string[];
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
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
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
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
      {hidden ? (
        <button
          type="button"
          onClick={onShow}
          aria-label={`Show ${label}`}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Eye className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${label}`}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
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

export function SidebarCustomizerDialog({
  open,
  onOpenChange,
  topLevel,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sidebar as COMPUTED this render — before any overlay is applied. */
  topLevel: OverlayNavItem[];
  groups: OverlayNavGroup[];
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
    for (const group of groups)
      for (const item of group.items) byHref.set(item.href, item);
    return byHref;
  }, [topLevel, groups]);

  const originalTopHrefs = useMemo(
    () => new Set(topLevel.map((item) => item.href)),
    [topLevel]
  );

  const buildDraft = (): Draft => {
    const applied = applyNavPreferences({ topLevel, groups, preferences });
    const visible = new Set<string>();
    applied.topLevel.forEach((item) => visible.add(item.href));
    applied.groups.forEach((group) =>
      group.items.forEach((item) => visible.add(item.href))
    );

    return {
      top: applied.topLevel.map((item) => item.href),
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
   * All three kinds of row — rail items, group headers, group items — live in
   * one `DndContext` and are interleaved down a single column. Plain
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

    // Ids are namespaced so one DndContext can host three kinds of list
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
    setDraft((current) => ({
      top: current.top.filter((h) => h !== href),
      groups: current.groups.map((group) => ({
        ...group,
        items: group.items.filter((h) => h !== href),
      })),
      hidden: current.hidden.includes(href)
        ? current.hidden
        : [...current.hidden, href],
    }));

  const show = (href: string) =>
    setDraft((current) => {
      const home = groups.find((group) =>
        group.items.some((item) => item.href === href)
      );
      return {
        // Restoring returns a link to where it came from, not to wherever the
        // user happens to be looking.
        top: home ? current.top : [...current.top, href],
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

  const toPreferences = (value: Draft): NavPreferences => ({
    topLevelOrder: value.top,
    groupOrder: value.groups.map((group) => group.label),
    groupItemOrder: Object.fromEntries(
      value.groups.map((group) => [group.label, group.items])
    ),
    hidden: value.hidden,
    // Anything sitting in the rail that did not start there was promoted.
    pinned: value.top.filter((href) => !originalTopHrefs.has(href)),
  });

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:max-w-*`, not `max-w-*`: DialogContent's base carries
          `sm:max-w-md`, and an unprefixed utility loses to it above 640px —
          which is every screen this dialog is used on. */}
      <DialogContent className="gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-7 py-5">
          <DialogTitle>Customise sidebar</DialogTitle>
          <DialogDescription>
            Drag to reorder, and hide anything you don&apos;t use. This only
            changes your own sidebar.
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
            <div className="grid max-h-[62vh] grid-cols-1 divide-y divide-border overflow-y-auto sm:grid-cols-[280px_1fr] sm:divide-x sm:divide-y-0">
              {/* Hidden pool */}
              <div className="px-6 py-5">
                <h4 className="mb-1 text-[13px] font-semibold">Hidden</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  Links you&apos;ve removed from your sidebar.
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
                          onShow={() => show(href)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* The sidebar itself */}
              <div className="px-6 py-5">
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
                          // Only a promoted item can go back down; the three
                          // stock rail items have no group to return to.
                          onUnpin={
                            originalTopHrefs.has(href)
                              ? undefined
                              : () => unpin(href)
                          }
                          onHide={() => hide(href)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

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
