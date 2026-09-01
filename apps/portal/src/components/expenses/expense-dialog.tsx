"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Receipt, Upload, FileText, X, Loader2, Car, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrencySymbol } from "@/lib/format-utils";
import { expenseSchema, type ExpenseFormValues } from "@/client-schemas/expenses/expense";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import { DateTimePicker } from "@/components/expenses/datetime-picker";
import type { Expense, ExpenseInput } from "@/hooks/use-expenses";

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense | null;
  onSubmit: (input: ExpenseInput) => Promise<unknown> | void;
  uploadReceipt: (file: File) => Promise<string>;
  getReceiptUrl: (path: string, opts?: { download?: boolean }) => Promise<string | null>;
  removeReceiptFile?: (path: string | null | undefined) => Promise<void>;
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  onSubmit,
  uploadReceipt,
  getReceiptUrl,
  removeReceiptFile,
}: ExpenseDialogProps) {
  const { tenant } = useTenant();
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || "USD");
  const { categories } = useExpenseCategories();
  const isEdit = !!expense;

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [existingReceipt, setExistingReceipt] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      type: "business",
      vehicle_id: null,
      category: "",
      expense_at: new Date().toISOString(),
      amount: undefined as unknown as number,
    },
  });

  const type = form.watch("type");

  // Categories filtered to the selected type, plus the editing expense's own
  // category if it has since been removed (so the value stays valid).
  const typeCategories = useMemo(() => {
    const list = categories.filter((c) => c.category_type === type).map((c) => c.name);
    if (expense?.category && !list.includes(expense.category)) {
      const expType = expense.vehicle_id ? "vehicle" : "business";
      if (expType === type) return [expense.category, ...list];
    }
    return list;
  }, [categories, type, expense]);

  const { data: vehicles = [] } = useQuery({
    queryKey: ["expense-vehicle-options", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .eq("tenant_id", tenant!.id)
        .order("reg", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant && open,
  });

  useEffect(() => {
    if (!open) return;
    setReceiptFile(null);
    setUploadError(null);
    if (expense) {
      form.reset({
        type: expense.vehicle_id ? "vehicle" : "business",
        vehicle_id: expense.vehicle_id,
        category: expense.category,
        expense_at: expense.expense_at,
        amount: Number(expense.amount),
      });
      setExistingReceipt(expense.receipt_url ?? null);
    } else {
      form.reset({
        type: "business",
        vehicle_id: null,
        category: "",
        expense_at: new Date().toISOString(),
        amount: undefined as unknown as number,
      });
      setExistingReceipt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id]);

  const switchType = (next: "business" | "vehicle") => {
    form.setValue("type", next);
    form.setValue("vehicle_id", next === "business" ? null : form.getValues("vehicle_id"));
    // Reset category when leaving the current type's set.
    const stillValid = categories.some(
      (c) => c.category_type === next && c.name === form.getValues("category")
    );
    if (!stillValid) form.setValue("category", "");
  };

  const pickFile = (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      setUploadError("File is larger than 10MB.");
      return;
    }
    setReceiptFile(file);
  };

  const openReceipt = async (path: string) => {
    const url = await getReceiptUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSubmit = async (values: ExpenseFormValues) => {
    setBusy(true);
    let freshUpload: string | null = null;
    try {
      let receipt_url: string | null = existingReceipt;
      if (receiptFile) {
        receipt_url = await uploadReceipt(receiptFile);
        freshUpload = receipt_url;
      }
      const input: ExpenseInput = {
        expense_at: values.expense_at,
        category: values.category,
        amount: values.amount,
        vehicle_id: values.type === "vehicle" ? values.vehicle_id || null : null,
        receipt_url,
        previous_receipt_url: expense?.receipt_url ?? null,
      };
      await onSubmit(input);
      onOpenChange(false);
    } catch (e: any) {
      if (freshUpload) await removeReceiptFile?.(freshUpload);
      setUploadError(e?.message || "Something went wrong while saving.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            {isEdit ? "Edit Expense" : "Add Expense"}
          </DialogTitle>
          <DialogDescription>Record a business or vehicle expense.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Type toggle */}
            <FormField
              control={form.control}
              name="type"
              render={() => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {(["business", "vehicle"] as const).map((t) => {
                      const active = type === t;
                      const Icon = t === "business" ? Building2 : Car;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => switchType(t)}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition-colors",
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </FormItem>
              )}
            />

            {/* Vehicle (vehicle type only) */}
            {type === "vehicle" && (
              <FormField
                control={form.control}
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select vehicle" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {vehicles.map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.reg} · {v.make} {v.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Category + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {typeCategories.length === 0 ? (
                          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                            No {type} categories yet.
                          </div>
                        ) : (
                          typeCategories.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount ({currencySymbol})</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : parseFloat(e.target.value)
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Date + time */}
            <FormField
              control={form.control}
              name="expense_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Date{" "}
                    <span className="font-normal text-muted-foreground">· time optional</span>
                  </FormLabel>
                  <FormControl>
                    <DateTimePicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Receipt upload */}
            <div className="space-y-1.5">
              <FormLabel>Receipt (optional)</FormLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {receiptFile ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm">{receiptFile.name}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setReceiptFile(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : existingReceipt ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => openReceipt(existingReceipt)}
                    className="flex min-w-0 items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">View current receipt</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setExistingReceipt(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    "flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-5 text-center transition-colors",
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  )}
                >
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Click to upload or drag a file here
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">
                    JPG, PNG, WEBP or PDF · up to 10MB
                  </span>
                </button>
              )}
            </div>

            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? "Save Changes" : "Add Expense"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
