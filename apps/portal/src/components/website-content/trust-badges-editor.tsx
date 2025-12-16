import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Plus, Trash2, Shield, Lock, Clock, Award, Star, CheckCircle, Heart, Zap } from "lucide-react";
import type { TrustBadgesContent, TrustBadge } from "@/types/cms";

const AVAILABLE_ICONS = [
  { value: "shield", label: "Shield", icon: Shield },
  { value: "lock", label: "Lock", icon: Lock },
  { value: "clock", label: "Clock", icon: Clock },
  { value: "award", label: "Award", icon: Award },
  { value: "star", label: "Star", icon: Star },
  { value: "check-circle", label: "Check Circle", icon: CheckCircle },
  { value: "heart", label: "Heart", icon: Heart },
  { value: "zap", label: "Zap", icon: Zap },
];

const badgeSchema = z.object({
  icon: z.string().min(1, "Icon is required"),
  label: z.string().min(1, "Label is required").max(20, "Label must be under 20 characters"),
  tooltip: z.string().min(1, "Tooltip is required").max(100, "Tooltip must be under 100 characters"),
});

const trustBadgesSchema = z.object({
  badges: z.array(badgeSchema).min(1, "At least one badge is required").max(6, "Maximum 6 badges allowed"),
});

interface TrustBadgesEditorProps {
  content: TrustBadgesContent;
  onSave: (content: TrustBadgesContent) => void;
  isSaving: boolean;
}

export function TrustBadgesEditor({ content, onSave, isSaving }: TrustBadgesEditorProps) {
  const form = useForm<TrustBadgesContent>({
    resolver: zodResolver(trustBadgesSchema),
    defaultValues: {
      badges: content.badges?.length > 0 ? content.badges : [{ icon: "shield", label: "", tooltip: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "badges",
  });

  const handleSubmit = (data: TrustBadgesContent) => {
    onSave(data);
  };

  const getIconComponent = (iconName: string) => {
    const iconDef = AVAILABLE_ICONS.find((i) => i.value === iconName);
    if (iconDef) {
      const IconComponent = iconDef.icon;
      return <IconComponent className="h-5 w-5" />;
    }
    return <Shield className="h-5 w-5" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trust Badges</CardTitle>
        <CardDescription>
          Configure the trust indicators displayed on the Contact page (max 6 badges)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="space-y-4">
              {fields.map((field, index) => (
                <Card key={field.id} className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <span className="text-sm font-medium">Badge {index + 1}</span>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        className="text-destructive hover:text-destructive h-8"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name={`badges.${index}.icon`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Icon</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select icon">
                                  {field.value && (
                                    <div className="flex items-center gap-2">
                                      {getIconComponent(field.value)}
                                      <span className="capitalize">{field.value}</span>
                                    </div>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {AVAILABLE_ICONS.map((icon) => (
                                <SelectItem key={icon.value} value={icon.value}>
                                  <div className="flex items-center gap-2">
                                    <icon.icon className="h-4 w-4" />
                                    <span>{icon.label}</span>
                                  </div>
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
                      name={`badges.${index}.label`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Label</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Secure" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`badges.${index}.tooltip`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tooltip Text</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Your data is encrypted and secure" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>
              ))}

              {fields.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => append({ icon: "shield", label: "", tooltip: "" })}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Badge
                </Button>
              )}
            </div>

            {/* Preview */}
            <div className="border rounded-lg p-4 bg-muted/50">
              <p className="text-sm font-medium mb-3">Preview</p>
              <div className="flex items-center justify-around text-center gap-4">
                {form.watch("badges").map((badge, index) => (
                  <div key={index} className="flex-1">
                    <div className="flex justify-center mb-2">
                      {getIconComponent(badge.icon)}
                    </div>
                    <p className="text-xs text-muted-foreground font-medium">
                      {badge.label || "Label"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Section
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
