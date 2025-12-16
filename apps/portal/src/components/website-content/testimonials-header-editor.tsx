import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, MessageSquare } from "lucide-react";
import type { TestimonialsHeaderContent } from "@/types/cms";

interface TestimonialsHeaderEditorProps {
  content: TestimonialsHeaderContent;
  onSave: (content: TestimonialsHeaderContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  title: z.string().min(1, "Section title is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function TestimonialsHeaderEditor({ content, onSave, isSaving }: TestimonialsHeaderEditorProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: content.title || "",
    },
  });

  useEffect(() => {
    form.reset({
      title: content.title || "",
    });
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-accent" />
              Testimonials Section
            </CardTitle>
            <CardDescription>
              The header for the testimonials/reviews section
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Why Dallas Drivers Choose Drive917" {...field} />
                  </FormControl>
                  <FormDescription>
                    The testimonials themselves are managed in the Testimonials section of the admin.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
