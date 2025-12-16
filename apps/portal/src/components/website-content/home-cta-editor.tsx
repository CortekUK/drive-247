import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, Megaphone, Plus, X } from "lucide-react";
import type { HomeCTAContent } from "@/types/cms";

interface HomeCTAEditorProps {
  content: HomeCTAContent;
  onSave: (content: HomeCTAContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title: z.string().min(1, "Section title is required"),
  description: z.string().optional(),
  primary_cta_text: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function HomeCTAEditor({ content, onSave, isSaving }: HomeCTAEditorProps) {
  const [trustPoints, setTrustPoints] = useState<string[]>(content.trust_points || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: content.title || "",
      description: content.description || "",
      primary_cta_text: content.primary_cta_text || "",
      secondary_cta_text: content.secondary_cta_text || "",
    },
  });

  useEffect(() => {
    form.reset({
      title: content.title || "",
      description: content.description || "",
      primary_cta_text: content.primary_cta_text || "",
      secondary_cta_text: content.secondary_cta_text || "",
    });
    setTrustPoints(content.trust_points || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      trust_points: trustPoints,
    } as HomeCTAContent);
  };

  const addTrustPoint = () => {
    setTrustPoints([...trustPoints, ""]);
  };

  const updateTrustPoint = (index: number, value: string) => {
    const updated = [...trustPoints];
    updated[index] = value;
    setTrustPoints(updated);
  };

  const removeTrustPoint = (index: number) => {
    setTrustPoints(trustPoints.filter((_, i) => i !== index));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-accent" />
              CTA Section
            </CardTitle>
            <CardDescription>
              The "Ready to Book" call-to-action section near the bottom of the page
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Ready to Book Your Dallas Rental?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Quick, easy, and affordable car rentals across Dallas and the DFW area."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <FormLabel className="text-base font-semibold">Call-to-Action Buttons</FormLabel>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="primary_cta_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Button Text</FormLabel>
                      <FormControl>
                        <Input placeholder="Book Now" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="secondary_cta_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secondary Button Text</FormLabel>
                      <FormControl>
                        <Input placeholder="Get in Touch" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <FormLabel className="text-base font-semibold">Trust Points</FormLabel>
                  <p className="text-sm text-muted-foreground">Small trust indicators shown below the buttons</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addTrustPoint}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-3">
                {trustPoints.map((point, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={point}
                      onChange={(e) => updateTrustPoint(index, e.target.value)}
                      placeholder="e.g., Reliable Service"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTrustPoint(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {trustPoints.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">No trust points added yet</p>
                )}
              </div>
            </div>

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
