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
  ListOrdered,
  FileText,
  AlertCircle,
  Search,
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
import { PromotionsHeroEditor } from "@/components/website-content/promotions-hero-editor";
import { HowItWorksEditor } from "@/components/website-content/how-it-works-editor";
import { TermsEditor } from "@/components/website-content/terms-editor";
import { EmptyStateEditor } from "@/components/website-content/empty-state-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  PromotionsHeroContent,
  HowItWorksContent,
  TermsContent,
  EmptyStateContent,
  SEOContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";

export default function CMSPromotionsEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("promotions");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("promotions");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.promotions;
      await Promise.all([
        updateSection({ sectionKey: "promotions_hero", content: defaults.hero }),
        updateSection({ sectionKey: "how_it_works", content: defaults.how_it_works }),
        updateSection({ sectionKey: "empty_state", content: defaults.empty_state }),
        updateSection({ sectionKey: "terms", content: defaults.terms }),
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
            <p className="text-muted-foreground">Promotions page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "promotions" page is set up in the database.
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

  const heroContent = getSectionContent<PromotionsHeroContent>("promotions_hero", {
    headline: "",
    subheading: "",
    primary_cta_text: "",
    primary_cta_href: "",
    secondary_cta_text: "",
  });

  const howItWorksContent = getSectionContent<HowItWorksContent>("how_it_works", {
    title: "",
    subtitle: "",
    steps: [],
  });

  const emptyStateContent = getSectionContent<EmptyStateContent>("empty_state", {
    title_active: "",
    title_default: "",
    description: "",
    button_text: "",
  });

  const termsContent = getSectionContent<TermsContent>("terms", {
    title: "",
    terms: [],
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
                  This will replace all Promotions page content with Drive 917 default content.
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
        </div>
      </div>

      {/* Editor Tabs */}
      <Card>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4" />
                <span className="hidden lg:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="how_it_works" className="flex items-center gap-2">
                <ListOrdered className="h-4 w-4" />
                <span className="hidden lg:inline">How It Works</span>
              </TabsTrigger>
              <TabsTrigger value="empty_state" className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span className="hidden lg:inline">Empty State</span>
              </TabsTrigger>
              <TabsTrigger value="terms" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden lg:inline">Terms</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">SEO</span>
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <TabsContent value="hero" className="mt-0">
                <PromotionsHeroEditor
                  content={heroContent}
                  onSave={(content) => updateSection({ sectionKey: "promotions_hero", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="how_it_works" className="mt-0">
                <HowItWorksEditor
                  content={howItWorksContent}
                  onSave={(content) => updateSection({ sectionKey: "how_it_works", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="empty_state" className="mt-0">
                <EmptyStateEditor
                  content={emptyStateContent}
                  onSave={(content) => updateSection({ sectionKey: "empty_state", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="terms" className="mt-0">
                <TermsEditor
                  content={termsContent}
                  onSave={(content) => updateSection({ sectionKey: "terms", content })}
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

      {/* Version History Dialog */}
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="promotions"
      />
    </div>
  );
}
