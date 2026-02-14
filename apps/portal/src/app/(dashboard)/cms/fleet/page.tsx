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
  Calendar,
  CheckSquare,
  DollarSign,
  Shield,
  Search,
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
import { FleetHeroEditor } from "@/components/website-content/fleet-hero-editor";
import { RentalRatesEditor } from "@/components/website-content/rental-rates-editor";
import { InclusionsEditor } from "@/components/website-content/inclusions-editor";
import { ExtrasEditor } from "@/components/website-content/extras-editor";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { VersionHistoryDialog } from "@/components/website-content/version-history-dialog";
import type {
  FleetHeroContent,
  RentalRatesContent,
  InclusionsContent,
  ExtrasContent,
  AssuranceContent,
  SEOContent,
} from "@/types/cms";
import { CMS_DEFAULTS } from "@/constants/website-content";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function CMSFleetEditor() {
  const router = useRouter();
  const { data: page, isLoading } = useCMSPage("fleet");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("fleet");
  const [activeTab, setActiveTab] = useState("hero");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  const handleResetToDefaults = async () => {
    setIsResetting(true);
    try {
      const defaults = CMS_DEFAULTS.fleet;
      await Promise.all([
        updateSection({ sectionKey: "fleet_hero", content: defaults.hero }),
        updateSection({ sectionKey: "rental_rates", content: defaults.rental_rates }),
        updateSection({ sectionKey: "inclusions", content: defaults.inclusions }),
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
            <p className="text-muted-foreground">Fleet page not found in CMS.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please ensure the "fleet" page is set up in the database.
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

  const heroContent = getSectionContent<FleetHeroContent>("fleet_hero", {
    headline: "",
    subheading: "",
    background_image: "",
    primary_cta_text: "",
    secondary_cta_text: "",
  });

  const ratesContent = getSectionContent<RentalRatesContent>("rental_rates", {
    section_title: "",
    daily: { title: "", description: "" },
    weekly: { title: "", description: "" },
    monthly: { title: "", description: "" },
  });

  const inclusionsContent = getSectionContent<InclusionsContent>("inclusions", {
    section_title: "",
    section_subtitle: "",
    standard_title: "",
    standard_items: [],
    premium_title: "",
    premium_items: [],
  });

  const extrasContent = getSectionContent<ExtrasContent>("extras", {
    items: [],
    footer_text: "",
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
                    This will replace all Fleet page content with Drive 917 default content.
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
            <Button onClick={handlePublish} disabled={isPublishing || page.status === "published"}>
              {isPublishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
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
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="hero" className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4" />
                <span className="hidden lg:inline">Hero</span>
              </TabsTrigger>
              <TabsTrigger value="rates" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="hidden lg:inline">Rates</span>
              </TabsTrigger>
              <TabsTrigger value="inclusions" className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                <span className="hidden lg:inline">Inclusions</span>
              </TabsTrigger>
              <TabsTrigger value="extras" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <span className="hidden lg:inline">Extras</span>
              </TabsTrigger>
              <TabsTrigger value="seo" className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden lg:inline">SEO</span>
              </TabsTrigger>
            </TabsList>

            <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
            <div className="mt-6">
              <TabsContent value="hero" className="mt-0">
                <FleetHeroEditor
                  content={heroContent}
                  onSave={(content) => updateSection({ sectionKey: "fleet_hero", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="rates" className="mt-0">
                <RentalRatesEditor
                  content={ratesContent}
                  onSave={(content) => updateSection({ sectionKey: "rental_rates", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="inclusions" className="mt-0">
                <InclusionsEditor
                  content={inclusionsContent}
                  onSave={(content) => updateSection({ sectionKey: "inclusions", content })}
                  isSaving={isUpdating}
                />
              </TabsContent>

              <TabsContent value="extras" className="mt-0">
                <ExtrasEditor
                  content={extrasContent}
                  onSave={(content) => updateSection({ sectionKey: "extras", content })}
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
            </div>
          </Tabs>
        </CardContent>
      </Card>

      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        pageSlug="fleet"
      />
    </div>
  );
}
