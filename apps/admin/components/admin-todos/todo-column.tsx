"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdminTodo, TodoStatus } from "@/hooks/use-admin-todos";
import { TodoCard } from "./todo-card";

interface Props {
  status: TodoStatus;
  label: string;
  accent: string; // tailwind colour for the dot/header
  todos: AdminTodo[];
  onCardClick: (todo: AdminTodo) => void;
  onCreate: () => void;
}

export function TodoColumn({ status, label, accent, todos, onCardClick, onCreate }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}`, data: { columnId: status } });

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center justify-between px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("inline-block w-2 h-2 rounded-full", accent)} />
          <h3 className="text-sm font-medium">{label}</h3>
          <span className="text-xs text-muted-foreground">{todos.length}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onCreate}
          aria-label={`Add a new card to ${label}`}
          title={`Add a new card to ${label}`}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 min-h-[200px] p-2 space-y-2 rounded-md border border-dashed transition",
          isOver
            ? "border-primary/60 bg-primary/5"
            : "border-border/60 bg-muted/20",
        )}
      >
        <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {todos.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-3">
              Drag a card here, or click + to add one.
            </p>
          ) : (
            todos.map((t) => <TodoCard key={t.id} todo={t} onClick={() => onCardClick(t)} />)
          )}
        </SortableContext>
      </div>
    </div>
  );
}
