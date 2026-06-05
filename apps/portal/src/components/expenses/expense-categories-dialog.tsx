"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Lock, Tag, Car, Building2 } from "lucide-react";
import {
  useExpenseCategories,
  type CategoryType,
  type ExpenseCategory,
} from "@/hooks/use-expense-categories";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExpenseCategoriesDialog({ open, onOpenChange }: Props) {
  const { categories, addCategory, deleteCategory, getUsageCount, isMutating } =
    useExpenseCategories();

  const [name, setName] = useState("");
  const [type, setType] = useState<CategoryType>("business");

  // Inline delete confirmation (avoids a nested modal inside this dialog).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmUsage, setConfirmUsage] = useState<number | null>(null);

  const groups = useMemo(
    () => ({
      business: categories.filter((c) => c.category_type === "business"),
      vehicle: categories.filter((c) => c.category_type === "vehicle"),
    }),
    [categories]
  );

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addCategory({ name: trimmed, category_type: type });
    setName("");
  };

  const requestDelete = async (c: ExpenseCategory) => {
    setConfirmId(c.id);
    setConfirmUsage(null);
    try {
      setConfirmUsage(await getUsageCount(c.name));
    } catch {
      setConfirmUsage(0);
    }
  };

  const cancelDelete = () => {
    setConfirmId(null);
    setConfirmUsage(null);
  };

  const doDelete = (c: ExpenseCategory) => {
    deleteCategory(c.id);
    cancelDelete();
  };

  const renderGroup = (label: string, Icon: typeof Car, list: ExpenseCategory[]) => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {list.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground/70">None yet.</p>
      ) : (
        list.map((c) => {
          const confirming = confirmId === c.id;
          return (
            <div
              key={c.id}
              className={
                "rounded-md border px-3 py-2 " +
                (confirming ? "border-destructive/40 bg-destructive/5" : "")
              }
            >
              {confirming ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">
                    Delete <span className="font-medium">{c.name}</span>?
                    {confirmUsage === null ? (
                      <span className="text-muted-foreground"> checking…</span>
                    ) : confirmUsage > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        {confirmUsage} expense{confirmUsage === 1 ? "" : "s"} keep the label.
                      </span>
                    ) : null}
                  </span>
                  <Button variant="ghost" size="sm" className="h-8" onClick={cancelDelete}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    onClick={() => doDelete(c)}
                    disabled={isMutating}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                  {c.is_default && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Lock className="h-3 w-3" />
                      Default
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    disabled={c.is_default}
                    title={c.is_default ? "Default categories can't be deleted" : "Delete"}
                    onClick={() => requestDelete(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Expense Categories
          </DialogTitle>
          <DialogDescription>
            Create the categories your team can pick. Each is tagged Business or Vehicle.
          </DialogDescription>
        </DialogHeader>

        {/* Add new */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              New category
            </label>
            <Input
              value={name}
              placeholder="e.g. Parking, Tyres, Software"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
          </div>
          <div className="w-full sm:w-[140px]">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Type
            </label>
            <Select value={type} onValueChange={(v) => setType(v as CategoryType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="vehicle">Vehicle</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={!name.trim() || isMutating}>
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        {/* Grouped list */}
        <ScrollArea className="-mx-2 max-h-[360px] px-2">
          <div className="space-y-4">
            {renderGroup("Business", Building2, groups.business)}
            {renderGroup("Vehicle", Car, groups.vehicle)}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
