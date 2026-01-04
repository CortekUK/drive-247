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
import { Loader2, Save, Home } from "lucide-react";
import { HeroImageUpload } from "@/components/website-content/hero-image-upload";
import { CarouselImagesEditor } from "@/components/website-content/carousel-images-editor";
import type { HomeHeroContent } from "@/types/cms";

interface HomeHeroEditorProps {
  content: HomeHeroContent;
  onSave: (content: HomeHeroContent) => void;
  isSaving: boolean;
}

const formSchema = z.object({
  headline: z.string().min(1, "Headline is required"),
  subheading: z.string().optional(),
  trust_line: z.string().optional(),
  phone_number: z.string().optional(),
  phone_cta_text: z.string().optional(),
  book_cta_text: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Default values for pre-filling
const defaults = {
  headline: "Reliable Car Rentals You Can Count On",
  subheading: "Quality vehicles. Transparent pricing. Exceptional service.",
  trust_line: "Premium Fleet • Flexible Rates • 24/7 Support",
  phone_number: "08001234567",
  phone_cta_text: "Call 0800 123 4567",
  book_cta_text: "Book Now",
};

export function HomeHeroEditor({ content, onSave, isSaving }: HomeHeroEditorProps) {
  const [backgroundImage, setBackgroundImage] = useState(content.background_image || "");
  const [carouselImages, setCarouselImages] = useState<string[]>(content.carousel_images || []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      headline: content.headline || defaults.headline,
      subheading: content.subheading || defaults.subheading,
      trust_line: content.trust_line || defaults.trust_line,
      phone_number: content.phone_number || defaults.phone_number,
      phone_cta_text: content.phone_cta_text || defaults.phone_cta_text,
      book_cta_text: content.book_cta_text || defaults.book_cta_text,
    },
  });

  useEffect(() => {
    form.reset({
      headline: content.headline || defaults.headline,
      subheading: content.subheading || defaults.subheading,
      trust_line: content.trust_line || defaults.trust_line,
      phone_number: content.phone_number || defaults.phone_number,
      phone_cta_text: content.phone_cta_text || defaults.phone_cta_text,
      book_cta_text: content.book_cta_text || defaults.book_cta_text,
    });
    setBackgroundImage(content.background_image || "");
    setCarouselImages(content.carousel_images || []);
  }, [content, form]);

  const onSubmit = (data: FormValues) => {
    onSave({
      ...data,
      background_image: backgroundImage,
      carousel_images: carouselImages.length > 0 ? carouselImages : undefined,
    } as HomeHeroContent);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5 text-accent" />
              Hero Section
            </CardTitle>
            <CardDescription>
              The main banner at the top of the Home page
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
                      <Input placeholder="Reliable Car Rentals You Can Count On" {...field} />
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
                        placeholder="Quality vehicles. Transparent pricing. Exceptional service."
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
                name="trust_line"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trust Line</FormLabel>
                    <FormControl>
                      <Input placeholder="Premium Fleet • Flexible Rates • 24/7 Support" {...field} />
                    </FormControl>
                    <FormDescription>
                      Displayed below the CTA buttons. Use • to separate items.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <FormLabel className="text-base font-semibold">Phone CTA Button</FormLabel>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="08001234567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone_cta_text"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Button Text</FormLabel>
                      <FormControl>
                        <Input placeholder="Call 0800 123 4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="book_cta_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Book Button Text</FormLabel>
                  <FormControl>
                    <Input placeholder="Book Now" {...field} />
                  </FormControl>
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
