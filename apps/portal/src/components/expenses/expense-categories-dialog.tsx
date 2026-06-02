"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Lock, Tag } from "lucide-react";
import {
  useExpenseCategories,
  type PnlBucket,
} from "@/hooks/use-expense-categories";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExpenseCategoriesDialog({ open, onOpenChange }: Props) {
  const { categories, addCategory, updateCategory, deleteCategory, isMutating } =
    useExpenseCategories({ activeOnly: false });

  const [name, setName] = useState("");
  const [bucket, setBucket] = useState<PnlBucket>("Expenses");

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addCategory({ name: trimmed, pnl_bucket: bucket });
    setName("");
    setBucket("Expenses");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Expense Categories
          </DialogTitle>
          <DialogDescription>
            Customise the categories your team can pick. The P&amp;L bucket controls how each
            one shows up in your Profit &amp; Loss report.
          </DialogDescription>
        </DialogHeader>

        {/* Add new */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">New category</label>
            <Input
              value={name}
              placeholder="e.g. Parking, Software, Detailing"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
          </div>
          <div className="w-full sm:w-[150px]">
            <label className="text-xs font-medium text-muted-foreground">P&amp;L bucket</label>
            <Select value={bucket} onValueChange={(v) => setBucket(v as PnlBucket)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Expenses">Expenses</SelectItem>
                <SelectItem value="Service">Service</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={!name.trim() || isMutating}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>

        {/* List */}
        <ScrollArea className="max-h-[340px] -mx-2 px-2">
          <div className="space-y-1.5">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.is_default && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Lock className="h-3 w-3" />
                      Default
                    </Badge>
                  )}
                  {!c.is_active && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      Hidden
                    </Badge>
                  )}
                </div>

                <Select
                  value={c.pnl_bucket}
                  onValueChange={(v) =>
                    updateCategory({ id: c.id, pnl_bucket: v as PnlBucket })
                  }
                >
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Expenses">Expenses</SelectItem>
                    <SelectItem value="Service">Service</SelectItem>
                  </SelectContent>
                </Select>

                {/* Show/Hide toggle */}
                <div className="flex items-center gap-1" title={c.is_active ? "Visible" : "Hidden"}>
                  <Switch
                    checked={c.is_active}
                    onCheckedChange={(v) => updateCategory({ id: c.id, is_active: v })}
                  />
                </div>

                {/* Delete (custom categories only) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  disabled={c.is_default}
                  title={c.is_default ? "Default categories can't be deleted" : "Delete"}
                  onClick={() => deleteCategory(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No categories yet.
              </p>
            )}
          </div>
        </ScrollArea>

        <p className="text-[11px] text-muted-foreground">
          Tip: hide a category to stop it appearing in the picker without losing past expenses
          filed under it.
        </p>
      </DialogContent>
    </Dialog>
  );
}
