import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, AlertCircle } from "lucide-react";
import type { EmptyStateContent } from "@/types/cms";

interface EmptyStateEditorProps {
  content: EmptyStateContent;
  onSave: (content: EmptyStateContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title_active: z.string().optional(),
  title_default: z.string().optional(),
  description: z.string().optional(),
  button_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function EmptyStateEditor({ content, onSave, isSaving }: EmptyStateEditorProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title_active: content.title_active || "",
      title_default: content.title_default || "",
      description: content.description || "",
      button_text: content.button_text || "",
    },
  });

  const titleDefault = form.watch("title_default");
  const description = form.watch("description");
  const buttonText = form.watch("button_text");

  useEffect(() => {
    form.reset({
      title_active: content.title_active || "",
      title_default: content.title_default || "",
      description: content.description || "",
      button_text: content.button_text || "",
    });
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave(data as EmptyStateContent);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-accent" />
              Empty State Section
            </CardTitle>
            <CardDescription>
              Customize the message shown when no promotions are available
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="title_active"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title (When filtering by Active)</FormLabel>
                    <FormControl>
                      <Input placeholder="No active promotions right now" {...field} />
                    </FormControl>
                    <FormDescription>
                      Shown when user filters by "Active" and there are none
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title_default"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title (Default)</FormLabel>
                    <FormControl>
                      <Input placeholder="No promotions found" {...field} />
                    </FormControl>
                    <FormDescription>
                      Shown when there are no promotions at all
                    </FormDescription>
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
                      placeholder="Check back soon or browse our Fleet & Pricing."
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="button_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Button Text</FormLabel>
                  <FormControl>
                    <Input placeholder="Browse Fleet & Pricing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Preview */}
            <div className="border rounded-lg p-6 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-4 uppercase tracking-wider">Preview</p>
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-xl font-bold mb-2">{titleDefault || "No promotions found"}</h3>
                <p className="text-muted-foreground mb-6">
                  {description || "Check back soon or browse our Fleet & Pricing."}
                </p>
                <Button variant="outline" disabled>
                  {buttonText || "Browse Fleet & Pricing"}
                </Button>
              </div>
            </div>

            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
