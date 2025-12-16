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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, Calendar } from "lucide-react";
import type { RentalRatesContent } from "@/types/cms";

interface RentalRatesEditorProps {
  content: RentalRatesContent;
  onSave: (content: RentalRatesContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  section_title: z.string().min(1, "Section title is required"),
  daily_title: z.string().min(1, "Daily title is required"),
  daily_description: z.string().optional(),
  weekly_title: z.string().min(1, "Weekly title is required"),
  weekly_description: z.string().optional(),
  monthly_title: z.string().min(1, "Monthly title is required"),
  monthly_description: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function RentalRatesEditor({ content, onSave, isSaving }: RentalRatesEditorProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      section_title: content.section_title || "",
      daily_title: content.daily?.title || "",
      daily_description: content.daily?.description || "",
      weekly_title: content.weekly?.title || "",
      weekly_description: content.weekly?.description || "",
      monthly_title: content.monthly?.title || "",
      monthly_description: content.monthly?.description || "",
    },
  });

  useEffect(() => {
    form.reset({
      section_title: content.section_title || "",
      daily_title: content.daily?.title || "",
      daily_description: content.daily?.description || "",
      weekly_title: content.weekly?.title || "",
      weekly_description: content.weekly?.description || "",
      monthly_title: content.monthly?.title || "",
      monthly_description: content.monthly?.description || "",
    });
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      section_title: data.section_title,
      daily: {
        title: data.daily_title,
        description: data.daily_description || "",
      },
      weekly: {
        title: data.weekly_title,
        description: data.weekly_description || "",
      },
      monthly: {
        title: data.monthly_title,
        description: data.monthly_description || "",
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-accent" />
              Rental Rates Section
            </CardTitle>
            <CardDescription>
              Edit the flexible rental rates section with daily, weekly, and monthly options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="section_title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Flexible Rental Rates" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-6 md:grid-cols-3">
              {/* Daily */}
              <Card className="p-4 bg-muted/30">
                <h4 className="font-semibold mb-3">Daily Rate Card</h4>
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="daily_title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Daily" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="daily_description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ideal for short stays and one-day hires."
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>

              {/* Weekly */}
              <Card className="p-4 bg-muted/30">
                <h4 className="font-semibold mb-3">Weekly Rate Card</h4>
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="weekly_title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Weekly" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="weekly_description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Perfect balance of flexibility and value."
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>

              {/* Monthly */}
              <Card className="p-4 bg-muted/30">
                <h4 className="font-semibold mb-3">Monthly Rate Card</h4>
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="monthly_title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Monthly" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="monthly_description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Exclusive long-term rates for regular clients."
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>
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
