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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Save, LayoutTemplate } from "lucide-react";
import { HeroImageUpload } from "@/components/website-content/hero-image-upload";
import type { PromotionsHeroContent } from "@/types/cms";

interface PromotionsHeroEditorProps {
  content: PromotionsHeroContent;
  onSave: (content: PromotionsHeroContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  primary_cta_text: z.string().optional(),
  primary_cta_href: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function PromotionsHeroEditor({ content, onSave, isSaving }: PromotionsHeroEditorProps) {
  const [backgroundImage, setBackgroundImage] = useState(content.background_image || "");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      headline: content.headline || "",
      subheading: content.subheading || "",
      primary_cta_text: content.primary_cta_text || "",
      primary_cta_href: content.primary_cta_href || "",
      secondary_cta_text: content.secondary_cta_text || "",
    },
  });

  useEffect(() => {
    form.reset({
      headline: content.headline || "",
      subheading: content.subheading || "",
      primary_cta_text: content.primary_cta_text || "",
      primary_cta_href: content.primary_cta_href || "",
      secondary_cta_text: content.secondary_cta_text || "",
    });
    setBackgroundImage(content.background_image || "");
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      background_image: backgroundImage,
    } as PromotionsHeroContent);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5 text-accent" />
              Hero Section
            </CardTitle>
            <CardDescription>
              The main banner at the top of the Promotions page
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Hero Background Image */}
            <HeroImageUpload
              currentImageUrl={backgroundImage}
              onImageChange={(url) => setBackgroundImage(url || "")}
              label="Hero Background Image"
              description="The background image displayed in the hero banner section"
              bucket="cms-media"
              recommendedSize="1920x1080px"
            />

            <Separator />

            {/* Main Content */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="headline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headline</FormLabel>
                    <FormControl>
                      <Input placeholder="Promotions & Offers" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subheading"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subheading</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Exclusive rental offers with transparent savings."
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* CTA Buttons */}
            <div className="space-y-4">
              <FormLabel className="text-base font-semibold">Call-to-Action Buttons</FormLabel>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
                  <FormLabel className="text-sm font-medium text-muted-foreground">Primary Button</FormLabel>
                  <FormField
                    control={form.control}
                    name="primary_cta_text"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Button Text</FormLabel>
                        <FormControl>
                          <Input placeholder="View Fleet & Pricing" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="primary_cta_href"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Link URL</FormLabel>
                        <FormControl>
                          <Input placeholder="/fleet" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
                  <FormLabel className="text-sm font-medium text-muted-foreground">Secondary Button</FormLabel>
                  <FormField
                    control={form.control}
                    name="secondary_cta_text"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Button Text</FormLabel>
                        <FormControl>
                          <Input placeholder="Book Now" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    This button scrolls to the booking section
                  </p>
                </div>
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
