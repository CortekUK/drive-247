"use client";

import { useState, useRef } from "react";
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
  LayoutTemplate,
  MessageSquare,
  Search,
  Star,
  Plus,
  Eye,
} from "lucide-react";
import { HeroSectionEditor } from "@/components/website-content/hero-section-editor";
import { FeedbackCTAEditor } from "@/components/website-content/feedback-cta-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import { TestimonialsManager, TestimonialsManagerRef } from "@/components/testimonials/testimonials-manager";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import type {
  HeroContent,
  FeedbackCTAContent,
  SEOContent,
} from "@/types/cms";

export default function CMSReviewsEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("reviews");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("reviews");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const testimonialsRef = useRef<TestimonialsManagerRef>(null);
  const { canEdit } = useManagerPermissions();

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
            <p className="text-muted-foreground">Reviews page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "reviews" page is set up in the database.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get section content with defaults
  const getSectionContent = <T,>(key: string, defaultValue: T): T => {
    const section = page.cms_page_sections?.find((s) => s.section_key === key);
    return (section?.content as T) || defaultValue;
  };

  const heroContent = getSectionContent<HeroContent>("hero", {
    title: "",
    subtitle: "",
  });

  const feedbackCTAContent = getSectionContent<FeedbackCTAContent>("feedback_cta", {
    title: "",
    description: "",
    button_text: "",
    empty_state_message: "",
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
                className={
                  page.status === "published"
                    ? "bg-green-500/20 text-green-600"
                    : ""
                }
              >
                {page.status === "published" ? (
                  <CheckCircle className="h-3 w-3 mr-1" />
                ) : (
                  <Clock className="h-3 w-3 mr-1" />
                )}
                {page.status === "published" ? "Published" : "Draft"}
              </Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setVersionHistoryOpen(true)}>
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          {canEdit('cms') && (
            <Button
              onClick={handlePublish}
              disabled={isPublishing || page.status === "published"}
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {page.status === "published" ? "Published" : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {/* Editor Tabs */}
      <Card>
        <CardContent className="pt-6">
          {!canEdit('cms') && (
            <div className="mb-4 p-3 bg-muted/50 border rounded-lg flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="h-4 w-4 shrink-0" />
              You have view-only access to website content.
            </div>
          )}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4" />
                <span className="hidden sm:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="feedback_cta" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Feedback CTA</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">SEO</span>
              </TabsTrigger>
              <TabsTrigger value="testimonials" className="flex items-center gap-2">
                <Star className="h-4 w-4" />
                <span className="hidden sm:inline">Testimonials</span>
              </TabsTrigger>
            </TabsList>

            <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
            <div className="mt-6">
              <TabsContent value="hero" className="mt-0">
                <HeroSectionEditor
                  content={heroContent}
                  onSave={(content) => updateSection({ sectionKey: "hero", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="feedback_cta" className="mt-0">
                <FeedbackCTAEditor
                  content={feedbackCTAContent}
                  onSave={(content) => updateSection({ sectionKey: "feedback_cta", content })}
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

              <TabsContent value="testimonials" className="mt-0">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Manage Testimonials</h3>
                      <p className="text-sm text-muted-foreground">
                        Add, edit, or remove customer testimonials displayed on the Reviews page
                      </p>
                    </div>
                    <Button
                      onClick={() => testimonialsRef.current?.openDialog()}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add Testimonial
                    </Button>
                  </div>
                  <TestimonialsManager ref={testimonialsRef} />
                </div>
              </TabsContent>
            </div>
            </div>
          </Tabs>
        </CardContent>
      </Card>

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="reviews"
      />
    </div>
  );
}
