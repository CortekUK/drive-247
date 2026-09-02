import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Loader2, Save, Tag } from "lucide-react";
import type { PromoBadgeContent } from "@/types/cms";

interface PromoBadgeEditorProps {
  content: PromoBadgeContent;
  onSave: (content: PromoBadgeContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  enabled: z.boolean(),
  discount_amount: z.string().optional(),
  discount_label: z.string().optional(),
  line1: z.string().optional(),
  line2: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function PromoBadgeEditor({ content, onSave, isSaving }: PromoBadgeEditorProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      enabled: content.enabled || false,
      discount_amount: content.discount_amount || "",
      discount_label: content.discount_label || "",
      line1: content.line1 || "",
      line2: content.line2 || "",
    },
  });

  const enabled = form.watch("enabled");
  const discountAmount = form.watch("discount_amount");
  const discountLabel = form.watch("discount_label");
  const line1 = form.watch("line1");
  const line2 = form.watch("line2");

  useEffect(() => {
    form.reset({
      enabled: content.enabled || false,
      discount_amount: content.discount_amount || "",
      discount_label: content.discount_label || "",
      line1: content.line1 || "",
      line2: content.line2 || "",
    });
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave(data as PromoBadgeContent);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-accent" />
              Promotional Badge
            </CardTitle>
            <CardDescription>
              The circular promotional badge shown on the hero section
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <FormLabel className="text-base font-medium">Enable Promo Badge</FormLabel>
                    <FormDescription>Show or hide the promotional badge on the home page</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {enabled && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="discount_amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Discount Amount</FormLabel>
                        <FormControl>
                          <Input placeholder="20%" {...field} />
                        </FormControl>
                        <FormDescription>e.g., "20%", "$50", "Free"</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discount_label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Discount Label</FormLabel>
                        <FormControl>
                          <Input placeholder="OFF" {...field} />
                        </FormControl>
                        <FormDescription>e.g., "OFF", "DISCOUNT", "GIFT"</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Text Line 1</FormLabel>
                        <FormControl>
                          <Input placeholder="When You Book" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="line2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Text Line 2</FormLabel>
                        <FormControl>
                          <Input placeholder="Online" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Preview */}
                <div className="p-6 bg-muted/30 rounded-lg">
                  <FormLabel className="text-sm text-muted-foreground mb-4 block">Preview</FormLabel>
                  <div className="flex justify-center">
                    <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-[#F5B942] via-[#E9B63E] to-[#F5B942] flex flex-col items-center justify-center shadow-lg">
                      <span className="text-2xl font-bold text-[#0C1A17] leading-none">{discountAmount || "20%"}</span>
                      <span className="text-xl font-bold text-[#0C1A17] leading-none">{discountLabel || "OFF"}</span>
                      <span className="text-[9px] font-semibold text-[#0C1A17]/80 mt-1 uppercase tracking-wide">{line1 || "When You Book"}</span>
                      <span className="text-[9px] font-semibold text-[#0C1A17]/80 uppercase tracking-wide">{line2 || "Online"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
