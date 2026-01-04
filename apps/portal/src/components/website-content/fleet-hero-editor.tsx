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
import { Loader2, Save, LayoutTemplate } from "lucide-react";
import { HeroImageUpload } from "@/components/website-content/hero-image-upload";
import { CarouselImagesEditor } from "@/components/website-content/carousel-images-editor";
import type { FleetHeroContent } from "@/types/cms";

interface FleetHeroEditorProps {
  content: FleetHeroContent;
  onSave: (content: FleetHeroContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  primary_cta_text: z.string().optional(),
  secondary_cta_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Default values for pre-filling
const defaults = {
  headline: "Fleet & Pricing",
  subheading: "Browse our premium vehicles with clear daily, weekly, and monthly rates.",
  primary_cta_text: "Book Now",
  secondary_cta_text: "View Fleet Below",
};

export function FleetHeroEditor({ content, onSave, isSaving }: FleetHeroEditorProps) {
  const [backgroundImage, setBackgroundImage] = useState(content.background_image || "");
  const [carouselImages, setCarouselImages] = useState<string[]>(content.carousel_images || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      headline: content.headline || defaults.headline,
      subheading: content.subheading || defaults.subheading,
      primary_cta_text: content.primary_cta_text || defaults.primary_cta_text,
      secondary_cta_text: content.secondary_cta_text || defaults.secondary_cta_text,
    },
  });

  useEffect(() => {
    form.reset({
      headline: content.headline || defaults.headline,
      subheading: content.subheading || defaults.subheading,
      primary_cta_text: content.primary_cta_text || defaults.primary_cta_text,
      secondary_cta_text: content.secondary_cta_text || defaults.secondary_cta_text,
    });
    setBackgroundImage(content.background_image || "");
    setCarouselImages(content.carousel_images || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      background_image: backgroundImage,
      carousel_images: carouselImages.length > 0 ? carouselImages : undefined,
    } as FleetHeroContent);
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
              The main banner at the top of the Fleet & Pricing page
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <CarouselImagesEditor
              images={carouselImages}
              onImagesChange={setCarouselImages}
              label="Hero Carousel Images"
              description="Images that rotate in the hero background. Leave empty to use default images."
              bucket="cms-media"
              maxImages={10}
            />

            <Separator />

            <HeroImageUpload
              currentImageUrl={backgroundImage}
              onImageChange={(url) => setBackgroundImage(url || "")}
              label="Static Background Image (Optional)"
              description="A single static background image. Carousel images above will take priority if set."
              bucket="cms-media"
            />

            <Separator />

            <div className="space-y-4">
              <FormField
                control={form.control}
                name="headline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headline</FormLabel>
                    <FormControl>
                      <Input placeholder="Fleet & Pricing" {...field} />
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
                        placeholder="Browse our premium vehicles with clear daily, weekly, and monthly rates."
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
                        <Input placeholder="View Fleet Below" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
