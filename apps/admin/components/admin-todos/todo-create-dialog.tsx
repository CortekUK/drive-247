"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  type CreateTodoInput,
  type TodoPriority,
  type TodoStatus,
} from "@/hooks/use-admin-todos";
import { useSuperAdmins } from "@/hooks/use-super-admins";
import { TodoImageUpload, type UploadedImage } from "./todo-image-upload";

interface Props {
  open: boolean;
  defaultStatus: TodoStatus;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateTodoInput) => Promise<unknown>;
}

const UNASSIGNED = "__none__";

// Hide native scrollbar but keep scroll behaviour.
const SCROLL_HIDDEN =
  "overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

export function TodoCreateDialog({ open, defaultStatus, onOpenChange, onSubmit }: Props) {
  const { admins } = useSuperAdmins();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [status, setStatus] = useState<TodoStatus>(defaultStatus);
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus(defaultStatus);
      setDueDate("");
      setAssigneeId(UNASSIGNED);
      setImage(null);
    }
  }, [open, defaultStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        due_date: dueDate || null,
        assignee_id: assigneeId === UNASSIGNED ? null : assigneeId,
        image_url: image?.image_url ?? null,
        image_path: image?.image_path ?? null,
      });
      toast.success("Card created");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create card");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-lg max-h-[88vh] ${SCROLL_HIDDEN}`}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New todo</DialogTitle>
            <DialogDescription>Add a card to the global Drive247 board.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div className="space-y-1">
              <Label htmlFor="todo-title" className="text-xs">Title *</Label>
              <Input
                id="todo-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                autoFocus
                placeholder="What needs to be done?"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="todo-desc" className="text-xs">Description</Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {description.length} / 5000
                </span>
              </div>
              <Textarea
                id="todo-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Optional details, links, context…"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Cover image</Label>
              <TodoImageUpload
                imageUrl={image?.image_url ?? null}
                imagePath={image?.image_path ?? null}
                onChange={(next) => setImage(next)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TodoPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TodoStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">Not started</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="todo-due" className="text-xs">Due date</Label>
                <Input
                  id="todo-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assignee</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                    {admins.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create card
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
