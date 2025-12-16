import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Search, Globe } from "lucide-react";
import type { SEOContent } from "@/types/cms";

const seoSchema = z.object({
  title: z.string().min(1, "Title is required").max(70, "Title should be under 70 characters for SEO"),
  description: z.string().min(1, "Description is required").max(160, "Description should be under 160 characters for SEO"),
  keywords: z.string().max(200, "Keywords should be under 200 characters"),
});

interface SEOEditorProps {
  content: SEOContent;
  onSave: (content: SEOContent) => void;
  isSaving: boolean;
}

export function SEOEditor({ content, onSave, isSaving }: SEOEditorProps) {
  const form = useForm<SEOContent>({
    resolver: zodResolver(seoSchema),
    defaultValues: content,
  });

  const handleSubmit = (data: SEOContent) => {
    onSave(data);
  };

  const titleLength = form.watch("title")?.length || 0;
  const descriptionLength = form.watch("description")?.length || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          SEO Settings
        </CardTitle>
        <CardDescription>
          Optimize how this page appears in search engine results
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
                    <Input {...field} placeholder="Contact Drive917 — Los Angeles Luxury Car Rentals" />
                  </FormControl>
                  <FormDescription className="flex justify-between">
                    <span>The title shown in browser tabs and search results</span>
                    <span className={titleLength > 60 ? "text-amber-500" : ""}>
                      {titleLength}/70
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Meta Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Get in touch with Drive917 for premium vehicle rentals, chauffeur services, and exclusive offers..."
                    />
                  </FormControl>
                  <FormDescription className="flex justify-between">
                    <span>A brief summary shown in search results</span>
                    <span className={descriptionLength > 150 ? "text-amber-500" : ""}>
                      {descriptionLength}/160
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="keywords"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keywords (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="contact Drive917, luxury car rental, chauffeur service inquiry"
                    />
                  </FormControl>
                  <FormDescription>
                    Comma-separated keywords related to this page
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Search Result Preview */}
            <div className="border rounded-lg p-4 bg-muted/50">
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Search Result Preview
              </p>
              <div className="space-y-1">
                <p className="text-blue-600 text-lg hover:underline cursor-pointer">
                  {form.watch("title") || "Page Title"}
                </p>
                <p className="text-green-700 text-sm">
                  drive917.com/contact
                </p>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {form.watch("description") || "Meta description will appear here..."}
                </p>
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
