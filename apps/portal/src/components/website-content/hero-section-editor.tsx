import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import type { HeroContent } from "@/types/cms";

const heroSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be under 100 characters"),
  subtitle: z.string().min(1, "Subtitle is required").max(300, "Subtitle must be under 300 characters"),
});

interface HeroSectionEditorProps {
  content: HeroContent;
  onSave: (content: HeroContent) => void;
  isSaving: boolean;
}

export function HeroSectionEditor({ content, onSave, isSaving }: HeroSectionEditorProps) {
  const form = useForm<HeroContent>({
    resolver: zodResolver(heroSchema),
    defaultValues: content,
  });

  const handleSubmit = (data: HeroContent) => {
    onSave(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hero Section</CardTitle>
        <CardDescription>
          The main heading and introduction text at the top of the Contact page
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Page Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Contact Drive247" />
                  </FormControl>
                  <FormDescription>
                    The main heading displayed at the top of the page
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="subtitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subtitle</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Get in touch for premium vehicle rentals..."
                    />
                  </FormControl>
                  <FormDescription>
                    A brief description that appears below the title
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
