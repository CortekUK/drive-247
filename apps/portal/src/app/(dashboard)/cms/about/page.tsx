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
  LayoutTemplate,
  BookOpen,
  Award,
  HelpCircle,
  Megaphone,
  Search,
  BarChart3,
  RotateCcw,
  Eye,
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
import { HeroSectionEditor } from "@/components/website-content/hero-section-editor";
import { AboutStoryEditor } from "@/components/website-content/about-story-editor";
import { WhyChooseUsEditor } from "@/components/website-content/why-choose-us-editor";
import { StatsEditor } from "@/components/website-content/stats-editor";
import { CTAEditor } from "@/components/website-content/cta-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { FAQsManager } from "@/components/website-content/faqs-manager";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  HeroContent,
  AboutStoryContent,
  WhyChooseUsContent,
  StatsContent,
  CTAContent,
  SEOContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function CMSAboutEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("about");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("about");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.about;
      await Promise.all([
        updateSection({ sectionKey: "hero", content: defaults.hero }),
        updateSection({ sectionKey: "about_story", content: defaults.story }),
        updateSection({ sectionKey: "why_choose_us", content: defaults.why_choose_us }),
        updateSection({ sectionKey: "stats", content: defaults.stats }),
        updateSection({ sectionKey: "final_cta", content: defaults.cta }),
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
            <p className="text-muted-foreground">About page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "about" page is set up in the database.
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

  const storyContent = getSectionContent<AboutStoryContent>("about_story", {
    title: "",
    founded_year: "",
    content: "",
  });

  const statsContent = getSectionContent<StatsContent>("stats", {
    items: [],
  });

  const whyChooseUsContent = getSectionContent<WhyChooseUsContent>("why_choose_us", {
    title: "",
    items: [],
  });

  const faqCTAContent = getSectionContent<CTAContent>("faq_cta", {
    title: "",
    description: "",
    button_text: "",
  });

  const finalCTAContent = getSectionContent<CTAContent>("final_cta", {
    title: "",
    description: "",
    tagline: "",
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
          {canEdit('cms') && (
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
                    This will replace all About page content with Drive 917 default content.
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
          )}
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
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4" />
                <span className="hidden lg:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="story" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                <span className="hidden lg:inline">Story</span>
              </TabsTrigger>
              <TabsTrigger value="stats" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                <span className="hidden lg:inline">Stats</span>
              </TabsTrigger>
              <TabsTrigger value="why_choose_us" className="flex items-center gap-2">
                <Award className="h-4 w-4" />
                <span className="hidden lg:inline">Why Us</span>
              </TabsTrigger>
              <TabsTrigger value="faqs" className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                <span className="hidden lg:inline">FAQs</span>
              </TabsTrigger>
              <TabsTrigger value="ctas" className="flex items-center gap-2">
                <Megaphone className="h-4 w-4" />
                <span className="hidden lg:inline">CTAs</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">SEO</span>
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

              <TabsContent value="story" className="mt-0">
                <AboutStoryEditor
                  content={storyContent}
                  onSave={(content) => updateSection({ sectionKey: "about_story", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="stats" className="mt-0">
                <StatsEditor
                  content={statsContent}
                  onSave={(content) => updateSection({ sectionKey: "stats", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="why_choose_us" className="mt-0">
                <WhyChooseUsEditor
                  content={whyChooseUsContent}
                  onSave={(content) => updateSection({ sectionKey: "why_choose_us", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="faqs" className="mt-0">
                <FAQsManager />
              </TabsContent>

              <TabsContent value="ctas" className="mt-0">
                <div className="space-y-6">
                  <CTAEditor
                    content={faqCTAContent}
                    onSave={(content) => updateSection({ sectionKey: "faq_cta", content })}
                    isSaving={isUpdating}
                    title="FAQ CTA Section"
                    description="Call-to-action displayed after the FAQ section"
                    icon={HelpCircle}
                    showButtonText={true}
                    showTagline={false}
                  />
                  <CTAEditor
                    content={finalCTAContent}
                    onSave={(content) => updateSection({ sectionKey: "final_cta", content })}
                    isSaving={isUpdating}
                    title="Final CTA Section"
                    description="The final call-to-action at the bottom of the page"
                    icon={Megaphone}
                    showButtonText={false}
                    showTagline={true}
                  />
                </div>
              </TabsContent>

              <TabsContent value="seo" className="mt-0">
                <SEOEditor
                  content={seoContent}
                  onSave={(content) => updateSection({ sectionKey: "seo", content })}
                  isSaving={isUpdating}
                />
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
        pageSlug="about"
      />
    </div>
  );
}
