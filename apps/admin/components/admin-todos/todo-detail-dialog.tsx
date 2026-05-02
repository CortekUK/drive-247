"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  type AdminTodo,
  type TodoPriority,
  type TodoStatus,
  type UpdateTodoInput,
} from "@/hooks/use-admin-todos";
import { useSuperAdmins } from "@/hooks/use-super-admins";
import { TodoImageUpload, type UploadedImage } from "./todo-image-upload";
import { TodoComments } from "./todo-comments";

interface Props {
  todo: AdminTodo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, patch: UpdateTodoInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

const UNASSIGNED = "__none__";

export function TodoDetailDialog({ todo, open, onOpenChange, onUpdate, onDelete }: Props) {
  const { admins } = useSuperAdmins();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [status, setStatus] = useState<TodoStatus>("not_started");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Hydrate fields when the todo changes.
  useEffect(() => {
    if (!todo) return;
    setTitle(todo.title);
    setDescription(todo.description ?? "");
    setPriority(todo.priority);
    setStatus(todo.status);
    setDueDate(todo.due_date ?? "");
    setAssigneeId(todo.assignee_id ?? UNASSIGNED);
    setImageUrl(todo.image_url);
    setImagePath(todo.image_path);
    setConfirmDelete(false);
  }, [todo?.id, open]);

  if (!todo) return null;

  const isDirty =
    title !== todo.title ||
    (description || "") !== (todo.description ?? "") ||
    priority !== todo.priority ||
    status !== todo.status ||
    (dueDate || null) !== todo.due_date ||
    (assigneeId === UNASSIGNED ? null : assigneeId) !== todo.assignee_id ||
    imageUrl !== todo.image_url ||
    imagePath !== todo.image_path;

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    const ok = await onUpdate(todo.id, {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      status,
      due_date: dueDate || null,
      assignee_id: assigneeId === UNASSIGNED ? null : assigneeId,
      image_url: imageUrl,
      image_path: imagePath,
    });
    setSaving(false);
    if (ok) {
      toast.success("Card updated");
      onOpenChange(false);
    } else {
      toast.error("Could not update card");
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    const ok = await onDelete(todo.id);
    setSaving(false);
    if (ok) {
      toast.success("Card deleted");
      onOpenChange(false);
    } else {
      toast.error("Could not delete card");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <DialogHeader>
          <DialogTitle className="text-base">Edit card</DialogTitle>
          <DialogDescription>
            Created {format(parseISO(todo.created_at), "PPp")}
            {todo.creator?.name || todo.creator?.email
              ? ` by ${todo.creator?.name || todo.creator?.email}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label>Cover image</Label>
            <TodoImageUpload
              imageUrl={imageUrl}
              imagePath={imagePath}
              onChange={async (next) => {
                // Persist immediately so the storage object is referenced.
                const ok = await onUpdate(todo.id, {
                  image_url: next?.image_url ?? null,
                  image_path: next?.image_path ?? null,
                });
                if (ok) {
                  setImageUrl(next?.image_url ?? null);
                  setImagePath(next?.image_path ?? null);
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="detail-title">Title *</Label>
            <Input
              id="detail-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="detail-desc">Description</Label>
            <Textarea
              id="detail-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={5000}
            />
            <p className="text-[10px] text-muted-foreground">{description.length} / 5000</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TodoPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TodoStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Not started</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="detail-due">Due date</Label>
              <Input
                id="detail-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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

          <Separator />

          <TodoComments todoId={todo.id} />
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">Delete this card permanently?</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={saving}>
                Keep
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isDirty || saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
