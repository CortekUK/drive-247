"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tile, StatusPill, EmptyState, Shimmer } from "@/components/bento";
import {
  ArrowLeft,
  Upload,
  History,
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
      <div className="space-y-6 p-4 md:p-6">
        <Shimmer className="h-10 w-64" />
        <Tile noMotion className="space-y-4">
          <Shimmer className="h-10 w-full" />
          <Shimmer className="h-80 w-full" />
        </Tile>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Button variant="ghost" onClick={() => router.push("/cms")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to CMS
        </Button>
        <EmptyState
          icon={<LayoutTemplate className="h-5 w-5" />}
          title="Reviews page not found in CMS"
          description='Please ensure the "reviews" page is set up in the database.'
        />
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
    <div className="container mx-auto space-y-6 pt-4 sm:pt-6 px-3 sm:px-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push("/cms")} className="shrink-0 h-9 px-2 sm:px-3">
            <ArrowLeft className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
              {page.name}
              <StatusPill tone={page.status === "published" ? "success" : "warn"} dot>
                {page.status === "published" ? "Published" : "Draft"}
              </StatusPill>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">{page.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setVersionHistoryOpen(true)} className="flex-1 sm:flex-none">
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
          {canEdit('cms') && (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={isPublishing || page.status === "published"}
              className="flex-1 sm:flex-none"
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
      <Tile pad="roomy">
          {!canEdit('cms') && (
            <div className="mb-4 flex items-center gap-2 rounded-tile-sm border border-border [background:var(--bento-tile-2)] p-3 text-sm text-muted-foreground">
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
                      <h3 className="text-lg font-bold tracking-tight">Manage Testimonials</h3>
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
      </Tile>

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="reviews"
      />
    </div>
  );
}
