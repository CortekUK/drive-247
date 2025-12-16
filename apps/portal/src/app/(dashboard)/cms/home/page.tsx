"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Upload,
  History,
  CheckCircle,
  Clock,
  Loader2,
  Home,
  Tag,
  Megaphone,
  Search,
  Sparkles,
  Calendar,
  MessageSquare,
  Phone,
  RotateCcw,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HomeHeroEditor } from "@/components/website-content/home-hero-editor";
import { PromoBadgeEditor } from "@/components/website-content/promo-badge-editor";
import { HomeCTAEditor } from "@/components/website-content/home-cta-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { ServiceHighlightsEditor } from "@/components/website-content/service-highlights-editor";
import { BookingHeaderEditor } from "@/components/website-content/booking-header-editor";
import { TestimonialsHeaderEditor } from "@/components/website-content/testimonials-header-editor";
import { ContactCardEditor } from "@/components/website-content/contact-card-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  HomeHeroContent,
  PromoBadgeContent,
  HomeCTAContent,
  SEOContent,
  ServiceHighlightsContent,
  BookingHeaderContent,
  TestimonialsHeaderContent,
  ContactCardContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";

export default function CMSHomeEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("home");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("home");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.home;
      await Promise.all([
        updateSection({ sectionKey: "home_hero", content: defaults.home_hero }),
        updateSection({ sectionKey: "promo_badge", content: defaults.promo_badge }),
        updateSection({ sectionKey: "service_highlights", content: defaults.service_highlights }),
        updateSection({ sectionKey: "booking_header", content: defaults.booking_header }),
        updateSection({ sectionKey: "testimonials_header", content: defaults.testimonials_header }),
        updateSection({ sectionKey: "home_cta", content: defaults.home_cta }),
        updateSection({ sectionKey: "contact_card", content: defaults.contact_card }),
        updateSection({ sectionKey: "seo", content: defaults.seo }),
      ]);
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push("/cms")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to CMS
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Home page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "home" page is set up in the database.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getSectionContent = <T,>(key: string, defaultValue: T): T => {
    const section = page.cms_page_sections?.find((s) => s.section_key === key);
    return (section?.content as T) || defaultValue;
  };

  const heroContent = getSectionContent<HomeHeroContent>("home_hero", {
    headline: "",
    subheading: "",
    background_image: "",
    phone_number: "",
    phone_cta_text: "",
    book_cta_text: "",
    trust_line: "",
  });

  const promoBadgeContent = getSectionContent<PromoBadgeContent>("promo_badge", {
    enabled: true,
    discount_amount: "",
    discount_label: "",
    line1: "",
    line2: "",
  });

  const serviceHighlightsContent = getSectionContent<ServiceHighlightsContent>("service_highlights", {
    title: "",
    subtitle: "",
    services: [],
  });

  const bookingHeaderContent = getSectionContent<BookingHeaderContent>("booking_header", {
    title: "",
    subtitle: "",
    trust_points: [],
  });

  const testimonialsHeaderContent = getSectionContent<TestimonialsHeaderContent>("testimonials_header", {
    title: "",
  });

  const ctaContent = getSectionContent<HomeCTAContent>("home_cta", {
    title: "",
    description: "",
    primary_cta_text: "",
    secondary_cta_text: "",
    trust_points: [],
  });

  const contactCardContent = getSectionContent<ContactCardContent>("contact_card", {
    title: "",
    description: "",
    phone_number: "",
    email: "",
    call_button_text: "",
    email_button_text: "",
  });

  const seoContent = getSectionContent<SEOContent>("seo", {
    title: "",
    description: "",
    keywords: "",
  });

  const handlePublish = () => {
    if (page?.id) {
      publishPage(page.id);
    }
  };

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push("/cms")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              {page.name}
              <Badge
                variant={page.status === "published" ? "default" : "secondary"}
                className={page.status === "published" ? "bg-green-500/20 text-green-600" : ""}
              >
                {page.status === "published" ? <CheckCircle className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                {page.status === "published" ? "Published" : "Draft"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={isResetting}>
                {isResetting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Set to Default
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset to Default Content?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace all Home page content with Drive 917 default content.
                  This action cannot be undone, but you can restore previous versions from the History.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetToDefaults}>
                  Reset to Defaults
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" onClick={() => setVersionHistoryOpen(true)}>
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          <Button onClick={handlePublish} disabled={isPublishing || page.status === "published"}>
            {isPublishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {page.status === "published" ? "Published" : "Publish"}
          </Button>
        </div>
      </div>

      {/* Editor Tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                <span className="hidden lg:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="promo" className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                <span className="hidden lg:inline">Promo</span>
              </TabsTrigger>
              <TabsTrigger value="services" className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                <span className="hidden lg:inline">Services</span>
              </TabsTrigger>
              <TabsTrigger value="booking" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="hidden lg:inline">Booking</span>
              </TabsTrigger>
              <TabsTrigger value="testimonials" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="hidden lg:inline">Reviews</span>
              </TabsTrigger>
              <TabsTrigger value="cta" className="flex items-center gap-2">
                <Megaphone className="h-4 w-4" />
                <span className="hidden lg:inline">CTA</span>
              </TabsTrigger>
              <TabsTrigger value="contact" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <span className="hidden lg:inline">Contact</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">SEO</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <TabsContent value="hero" className="mt-0">
                <HomeHeroEditor
                  content={heroContent}
                  onSave={(content) => updateSection({ sectionKey: "home_hero", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="promo" className="mt-0">
                <PromoBadgeEditor
                  content={promoBadgeContent}
                  onSave={(content) => updateSection({ sectionKey: "promo_badge", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="services" className="mt-0">
                <ServiceHighlightsEditor
                  content={serviceHighlightsContent}
                  onSave={(content) => updateSection({ sectionKey: "service_highlights", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="booking" className="mt-0">
                <BookingHeaderEditor
                  content={bookingHeaderContent}
                  onSave={(content) => updateSection({ sectionKey: "booking_header", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="testimonials" className="mt-0">
                <TestimonialsHeaderEditor
                  content={testimonialsHeaderContent}
                  onSave={(content) => updateSection({ sectionKey: "testimonials_header", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="cta" className="mt-0">
                <HomeCTAEditor
                  content={ctaContent}
                  onSave={(content) => updateSection({ sectionKey: "home_cta", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="contact" className="mt-0">
                <ContactCardEditor
                  content={contactCardContent}
                  onSave={(content) => updateSection({ sectionKey: "contact_card", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="seo" className="mt-0">
                <SEOEditor
                  content={seoContent}
                  onSave={(content) => updateSection({ sectionKey: "seo", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="home"
      />
    </div>
  );
}
