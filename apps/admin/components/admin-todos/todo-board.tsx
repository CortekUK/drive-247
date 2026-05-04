"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  type AdminTodo,
  type TodoStatus,
  useAdminTodos,
} from "@/hooks/use-admin-todos";
import { TodoColumn } from "./todo-column";
import { TodoCard } from "./todo-card";
import { TodoCreateDialog } from "./todo-create-dialog";
import { TodoDetailDialog } from "./todo-detail-dialog";

const COLUMNS: { status: TodoStatus; label: string; accent: string }[] = [
  { status: "not_started", label: "Not started", accent: "bg-slate-400" },
  { status: "in_progress", label: "In progress", accent: "bg-blue-500" },
  { status: "done",        label: "Done",        accent: "bg-green-500" },
];

const POSITION_GAP = 1024;

function clampStatus(s: string): TodoStatus | null {
  return s === "not_started" || s === "in_progress" || s === "done" ? s : null;
}

export function TodoBoard({ tenantId }: { tenantId: string }) {
  const {
    todos,
    loading,
    refetch,
    createTodo,
    updateTodo,
    deleteTodo,
    applyOptimistic,
    isDraggingRef,
  } = useAdminTodos(tenantId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<TodoStatus>("not_started");
  const [detailId, setDetailId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const grouped = useMemo(() => {
    const map: Record<TodoStatus, AdminTodo[]> = {
      not_started: [],
      in_progress: [],
      done: [],
    };
    for (const t of todos) {
      const arr = map[t.status];
      if (arr) arr.push(t);
    }
    for (const k of Object.keys(map) as TodoStatus[]) {
      map[k].sort((a, b) => a.position - b.position);
    }
    return map;
  }, [todos]);

  const detailTodo = todos.find((t) => t.id === detailId) ?? null;
  // Auto-close the dialog if the underlying card disappears (deleted by another admin).
  if (detailId && !detailTodo) {
    setTimeout(() => setDetailId(null), 0);
  }
  const activeTodo = activeId ? todos.find((t) => t.id === activeId) ?? null : null;

  const handleDragStart = (e: DragStartEvent) => {
    isDraggingRef.current = true;
    setActiveId(String(e.active.id));
  };

  const handleDragCancel = () => {
    isDraggingRef.current = false;
    setActiveId(null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    isDraggingRef.current = false;
    const { active, over } = e;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const moving = todos.find((t) => t.id === activeId);
    if (!moving) return;

    // Resolve destination column: either dropped on a column container or on another card.
    let destStatus: TodoStatus = moving.status;
    let destIndex: number;
    let destColumn: AdminTodo[];

    if (overId.startsWith("column:")) {
      const s = clampStatus(overId.slice("column:".length));
      if (!s) return;
      destStatus = s;
      destColumn = grouped[destStatus];
      destIndex = destColumn.length; // append
    } else {
      const overTodo = todos.find((t) => t.id === overId);
      if (!overTodo) return;
      destStatus = overTodo.status;
      destColumn = grouped[destStatus];
      destIndex = destColumn.findIndex((t) => t.id === overId);
      if (destIndex < 0) destIndex = destColumn.length;
    }

    // No-op: dropped on itself.
    if (destStatus === moving.status && destColumn[destIndex]?.id === moving.id) return;

    // Compute new position based on neighbours in the destination column,
    // *excluding* the moving card if it was already there.
    const filteredCol = destColumn.filter((t) => t.id !== moving.id);
    const insertAt = Math.max(0, Math.min(destIndex, filteredCol.length));
    const before = filteredCol[insertAt - 1];
    const after = filteredCol[insertAt];
    let newPos: number;
    if (!before && !after) newPos = POSITION_GAP;
    else if (!before && after) newPos = after.position - POSITION_GAP;
    else if (before && !after) newPos = before.position + POSITION_GAP;
    else newPos = (before!.position + after!.position) / 2;
    if (!Number.isFinite(newPos) || Math.abs((before?.position ?? 0) - (after?.position ?? newPos)) < 1e-9) {
      console.warn("Position values converging; consider rebalance.");
    }

    // Optimistic local update.
    const snapshot = todos;
    applyOptimistic((prev) =>
      prev.map((t) => (t.id === moving.id ? { ...t, status: destStatus, position: newPos } : t)),
    );

    const ok = await updateTodo(moving.id, { status: destStatus, position: newPos });
    if (!ok) {
      // Roll back.
      applyOptimistic(() => snapshot);
      return;
    }
    // Sync with server (covers other concurrent moves).
    await refetch();
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-4 overflow-x-auto pb-2">
          {COLUMNS.map((c) => (
            <TodoColumn
              key={c.status}
              status={c.status}
              label={c.label}
              accent={c.accent}
              todos={grouped[c.status]}
              onCardClick={(t) => setDetailId(t.id)}
              onCreate={() => {
                setCreateStatus(c.status);
                setCreateOpen(true);
              }}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTodo ? <TodoCard todo={activeTodo} onClick={() => {}} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      {loading && todos.length === 0 && (
        <p className="text-xs text-muted-foreground mt-4">Loading…</p>
      )}

      <TodoCreateDialog
        open={createOpen}
        defaultStatus={createStatus}
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          await createTodo(input);
        }}
      />

      <TodoDetailDialog
        todo={detailTodo}
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        onUpdate={async (id, patch) => {
          const ok = await updateTodo(id, patch);
          if (ok) await refetch();
          return ok;
        }}
        onDelete={async (id) => {
          const ok = await deleteTodo(id);
          return ok;
        }}
      />
    </>
  );
}
