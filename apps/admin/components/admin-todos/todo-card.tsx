"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, MessageCircle } from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";
import type { AdminTodo } from "@/hooks/use-admin-todos";
import { PriorityDot } from "./priority-badge";
import { AssigneeAvatar } from "./assignee-avatar";

interface Props {
  todo: AdminTodo;
  onClick: () => void;
  isOverlay?: boolean;
}

function dueChip(due: string) {
  try {
    const days = differenceInCalendarDays(parseISO(due), new Date());
    const label = format(parseISO(due), "MMM d");
    if (days < 0)
      return {
        label,
        title: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`,
        cls: "border-red-400/60 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300",
      };
    if (days === 0)
      return { label, title: "Due today", cls: "border-amber-400/60 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300" };
    return { label, title: `Due ${label}`, cls: "border-border text-muted-foreground bg-background" };
  } catch {
    return null;
  }
}

export function TodoCard({ todo, onClick, isOverlay }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const due = todo.due_date ? dueChip(todo.due_date) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // dnd-kit's activation distance ensures click vs drag distinction.
        if (!isDragging) onClick();
      }}
      className={cn(
        "group bg-card border border-border rounded-md overflow-hidden cursor-grab active:cursor-grabbing transition",
        "hover:border-primary/40 hover:shadow-sm",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "shadow-lg ring-2 ring-primary/30 rotate-1",
      )}
    >
      {todo.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={todo.image_url}
          alt=""
          className="w-full aspect-[16/9] object-cover bg-muted"
          draggable={false}
        />
      )}
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <PriorityDot priority={todo.priority} className="mt-1.5" />
          <h3
            className="text-sm font-medium leading-snug line-clamp-2 flex-1"
            title={todo.title}
          >
            {todo.title}
          </h3>
        </div>
        {todo.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {todo.description}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            {due && (
              <span
                title={due.title}
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border",
                  due.cls,
                )}
              >
                <CalendarDays className="w-3 h-3" />
                {due.label}
              </span>
            )}
            {(todo.comment_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <MessageCircle className="w-3 h-3" />
                {todo.comment_count}
              </span>
            )}
          </div>
          <AssigneeAvatar user={todo.assignee} size="xs" />
        </div>
      </div>
    </div>
  );
}
