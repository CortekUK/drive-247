"use client";

import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
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
import { Receipt, Upload, FileText, X, Loader2, ExternalLink } from "lucide-react";
import { getCurrencySymbol } from "@/lib/format-utils";
import {
  expenseSchema,
  type ExpenseFormValues,
  PAYMENT_METHODS,
} from "@/client-schemas/expenses/expense";
import { useExpenseCategories } from "@/hooks/use-expense-categories";
import type { Expense, ExpenseInput } from "@/hooks/use-expenses";

const NO_VEHICLE = "__none__";
const NO_METHOD = "__none__";

interface ExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when editing an existing expense; null/undefined for create. */
  expense?: Expense | null;
  onSubmit: (input: ExpenseInput) => Promise<unknown> | void;
  isSubmitting?: boolean;
  uploadReceipt: (file: File) => Promise<string>;
  getReceiptUrl: (path: string) => Promise<string | null>;
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  onSubmit,
  isSubmitting,
  uploadReceipt,
  getReceiptUrl,
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
      expense_date: new Date().toISOString().split("T")[0],
      category: "",
      amount: undefined,
      vehicle_id: null,
      vendor: "",
      payment_method: "",
      reference: "",
      notes: "",
      is_recurring: false,
      recurrence_interval: null,
    },
  });

  const isRecurring = form.watch("is_recurring");

  // Vehicles for the optional picker.
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

  // Reset the form whenever the dialog opens (for create or a specific edit).
  useEffect(() => {
    if (!open) return;
    setReceiptFile(null);
    setUploadError(null);
    if (expense) {
      form.reset({
        expense_date: expense.expense_date,
        category: expense.category,
        amount: Number(expense.amount),
        vehicle_id: expense.vehicle_id,
        vendor: expense.vendor ?? "",
        payment_method: expense.payment_method ?? "",
        reference: expense.reference ?? "",
        notes: expense.notes ?? "",
        is_recurring: expense.is_recurring,
        recurrence_interval: expense.recurrence_interval,
      });
      setExistingReceipt(expense.receipt_url ?? null);
    } else {
      form.reset({
        expense_date: new Date().toISOString().split("T")[0],
        category: categories[0]?.name ?? "",
        amount: undefined,
        vehicle_id: null,
        vendor: "",
        payment_method: "",
        reference: "",
        notes: "",
        is_recurring: false,
        recurrence_interval: null,
      });
      setExistingReceipt(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id]);

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
    try {
      let receipt_url: string | null = existingReceipt;
      if (receiptFile) {
        receipt_url = await uploadReceipt(receiptFile);
      }
      const input: ExpenseInput = {
        expense_date: values.expense_date,
        category: values.category,
        amount: values.amount,
        vehicle_id: values.vehicle_id || null,
        vendor: values.vendor?.trim() || null,
        payment_method: values.payment_method || null,
        reference: values.reference?.trim() || null,
        notes: values.notes?.trim() || null,
        receipt_url,
        is_recurring: values.is_recurring ?? false,
        recurrence_interval: values.is_recurring ? values.recurrence_interval ?? null : null,
      };
      await onSubmit(input);
      onOpenChange(false);
    } catch (e: any) {
      setUploadError(e?.message || "Something went wrong while saving.");
    } finally {
      setBusy(false);
    }
  };

  const submitting = busy || isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            {isEdit ? "Edit Expense" : "Add Expense"}
          </DialogTitle>
          <DialogDescription>
            Record a vehicle cost or a business-wide overhead. It flows straight into your P&amp;L.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="expense_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
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
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.name}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === NO_VEHICLE ? null : v)}
                      value={field.value ?? NO_VEHICLE}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_VEHICLE}>
                          Business-wide (no vehicle)
                        </SelectItem>
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="vendor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor / Payee</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Kwik Fit" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === NO_METHOD ? "" : v)}
                      value={field.value || NO_METHOD}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Optional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_METHOD}>Not specified</SelectItem>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Invoice number, PO, etc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Anything worth remembering about this expense..."
                      className="min-h-[72px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Receipt upload */}
            <div className="space-y-1.5">
              <FormLabel>Receipt (Optional)</FormLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {receiptFile ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
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
                    className="flex items-center gap-2 min-w-0 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">View current receipt</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
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
                  className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-5 text-center transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
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

            {/* Recurring */}
            <div className="rounded-md border p-3 space-y-3">
              <FormField
                control={form.control}
                name="is_recurring"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between space-y-0">
                    <div className="space-y-0.5">
                      <FormLabel>Recurring expense</FormLabel>
                      <FormDescription className="text-[11px]">
                        Mark expenses like rent or subscriptions that repeat.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {isRecurring && (
                <FormField
                  control={form.control}
                  name="recurrence_interval"
                  render={({ field }) => (
                    <FormItem>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? "monthly"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="How often?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="monthly">Every month</SelectItem>
                          <SelectItem value="yearly">Every year</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Save Changes" : "Add Expense"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
