import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { Shield, Plus, X, Loader2 } from "lucide-react";

interface EditProtectionPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: any;
}

const protectionPlanSchema = z.object({
  name: z.string().min(1, "Internal name is required"),
  display_name: z.string().min(1, "Display name is required"),
  description: z.string().optional(),
  price_per_day: z.number().min(0.01, "Daily price is required"),
  price_per_week: z.number().optional().nullable(),
  price_per_month: z.number().optional().nullable(),
  deductible_amount: z.number().default(0),
  max_coverage_amount: z.number().optional().nullable(),
  tier: z.enum(["basic", "standard", "premium", "ultimate"]).default("standard"),
  icon_name: z.string().default("Shield"),
  color_theme: z.string().default("#60A5FA"),
  display_order: z.number().default(0),
});

type ProtectionPlanFormValues = z.infer<typeof protectionPlanSchema>;

export const EditProtectionPlanDialog = ({ open, onOpenChange, plan }: EditProtectionPlanDialogProps) => {
  const queryClient = useQueryClient();
  const [features, setFeatures] = useState<string[]>([""]);
  const [exclusions, setExclusions] = useState<string[]>([""]);

  const form = useForm<ProtectionPlanFormValues>({
    resolver: zodResolver(protectionPlanSchema),
    defaultValues: {
      name: "",
      display_name: "",
      description: "",
      price_per_day: 0,
      price_per_week: null,
      price_per_month: null,
      deductible_amount: 0,
      max_coverage_amount: null,
      tier: "standard",
      icon_name: "Shield",
      color_theme: "#60A5FA",
      display_order: 0,
    },
  });

  useEffect(() => {
    if (plan) {
      form.reset({
        name: plan.name || "",
        display_name: plan.display_name || "",
        description: plan.description || "",
        price_per_day: plan.price_per_day || 0,
        price_per_week: plan.price_per_week || null,
        price_per_month: plan.price_per_month || null,
        deductible_amount: plan.deductible_amount || 0,
        max_coverage_amount: plan.max_coverage_amount || null,
        tier: plan.tier || "standard",
        icon_name: plan.icon_name || "Shield",
        color_theme: plan.color_theme || "#60A5FA",
        display_order: plan.display_order || 0,
      });
      setFeatures(Array.isArray(plan.features) && plan.features.length > 0 ? plan.features : [""]);
      setExclusions(Array.isArray(plan.exclusions) && plan.exclusions.length > 0 ? plan.exclusions : [""]);
    }
  }, [plan, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const { error } = await supabase
        .from("protection_plans")
        .update(data)
        .eq("id", plan.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["protection_plans"] });
      toast.success("Protection plan updated successfully");
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error("Failed to update plan: " + error.message);
    },
  });

  const onSubmit = (data: ProtectionPlanFormValues) => {
    const cleanedFeatures = features.filter(f => f.trim() !== "");
    const cleanedExclusions = exclusions.filter(e => e.trim() !== "");

    updateMutation.mutate({
      name: data.name,
      display_name: data.display_name,
      description: data.description || null,
      price_per_day: data.price_per_day,
      price_per_week: data.price_per_week || null,
      price_per_month: data.price_per_month || null,
      deductible_amount: data.deductible_amount,
      max_coverage_amount: data.max_coverage_amount || null,
      tier: data.tier,
      icon_name: data.icon_name,
      color_theme: data.color_theme,
      display_order: data.display_order,
      features: cleanedFeatures,
      exclusions: cleanedExclusions,
    });
  };

  const addFeature = () => setFeatures([...features, ""]);
  const removeFeature = (index: number) => setFeatures(features.filter((_, i) => i !== index));
  const updateFeature = (index: number, value: string) => {
    const newFeatures = [...features];
    newFeatures[index] = value;
    setFeatures(newFeatures);
  };

  const addExclusion = () => setExclusions([...exclusions, ""]);
  const removeExclusion = (index: number) => setExclusions(exclusions.filter((_, i) => i !== index));
  const updateExclusion = (index: number, value: string) => {
    const newExclusions = [...exclusions];
    newExclusions[index] = value;
    setExclusions(newExclusions);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#C5A572]" />
            Edit Protection Plan
          </DialogTitle>
          <DialogDescription>
            Update protection/insurance plan details
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Internal Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="basic_protection" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Basic Protection" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Brief description of the protection plan"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="price_per_day"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Price ($) <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="15.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="price_per_week"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weekly Price ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="75.00"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="price_per_month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Price ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="250.00"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="deductible_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deductible ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="max_coverage_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Coverage ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="100000.00"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="ultimate">Ultimate</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="color_theme"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color Theme</FormLabel>
                    <FormControl>
                      <Input type="color" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="icon_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Icon Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Shield" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="display_order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Order</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="0"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Features/Benefits</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={addFeature}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Feature
                </Button>
              </div>
              <div className="space-y-2">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={feature}
                      onChange={(e) => updateFeature(index, e.target.value)}
                      placeholder="e.g., Zero Deductible Coverage"
                    />
                    {features.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFeature(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Exclusions</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={addExclusion}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Exclusion
                </Button>
              </div>
              <div className="space-y-2">
                {exclusions.map((exclusion, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={exclusion}
                      onChange={(e) => updateExclusion(index, e.target.value)}
                      placeholder="e.g., Off-road use"
                    />
                    {exclusions.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeExclusion(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending || !form.formState.isValid}
                className="bg-[#C5A572] text-black hover:bg-[#C5A572]/90"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Plan"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
