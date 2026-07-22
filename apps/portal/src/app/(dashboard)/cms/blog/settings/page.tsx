"use client";

import { useRouter } from "next/navigation";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { SEOEditor } from "@/components/website-content/seo-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Loader2, FileText, Search, Eye } from "lucide-react";
import { CMS_DEFAULTS } from "@/constants/website-content";
import type { HeroContent, SEOContent } from "@/types/cms";
import { useState, useEffect } from "react";

export default function BlogSettingsPage() {
  const router = useRouter();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit("cms");

  const { data: page, isLoading: pageLoading } = useCMSPage("blog");
  const { updateSectionAsync, isUpdating } = useCMSPageSections("blog");
  const { publishPage } = useCMSPages();

  // Get section content helper
  const getSectionContent = <T,>(key: string, defaultVal: T): T => {
    if (!page?.cms_page_sections) return defaultVal;
    const section = (page.cms_page_sections as any[]).find((s: any) => s.section_key === key);
    return section?.content ? { ...defaultVal, ...section.content } : defaultVal;
  };

  const blogDefaults = CMS_DEFAULTS.blog || {
    hero: { title: "Blog", subtitle: "Latest news, tips and insights" },
    seo: { title: "Blog", description: "Read the latest articles", keywords: "" },
  };

  const heroContent = getSectionContent<HeroContent>("hero", blogDefaults.hero);
  const seoContent = getSectionContent<SEOContent>("seo", blogDefaults.seo);

  const [heroTitle, setHeroTitle] = useState(heroContent.title);
  const [heroSubtitle, setHeroSubtitle] = useState(heroContent.subtitle || "");

  useEffect(() => {
    setHeroTitle(heroContent.title);
    setHeroSubtitle(heroContent.subtitle || "");
  }, [heroContent.title, heroContent.subtitle]);

  /**
   * Save a blog-settings section without stranding the page off the live site.
   *
   * updateSection unconditionally demotes cms_pages.status to "draft"
   * (use-cms-page-sections.ts), and the booking site only reads published pages.
   * This screen has NO Publish button anywhere, so editing the blog hero or SEO
   * once used to take the live /blog page's content off permanently, with no way
   * to restore it from the portal at all. Re-publishing here closes that trap.
   *
   * A page that was already draft stays draft — never publish content the tenant
   * did not choose to publish.
   */
  const saveSection = async (sectionKey: string, content: Record<string, any>) => {
    const wasPublished = page?.status === "published";
    // Publish the row actually written, not the rendered one — see the same
    // note in cms/site-settings/page.tsx.
    const savedPageId = await updateSectionAsync({ sectionKey, content });
    if (wasPublished && savedPageId) {
      publishPage(savedPageId);
    }
  };

  const handleSaveHero = () => {
    saveSection("hero", { title: heroTitle, subtitle: heroSubtitle });
  };

  const handleSaveSEO = (data: SEOContent) => {
    saveSection("seo", data);
  };

  if (pageLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/cms/blog")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-2xl font-display font-bold">Blog Page Settings</h1>
      </div>

      {!hasEditAccess && (
        <div className="bg-muted border rounded-lg p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Eye className="h-4 w-4" />
          You have view-only access.
        </div>
      )}

      <Tabs defaultValue="hero">
        <TabsList>
          <TabsTrigger value="hero" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Hero
          </TabsTrigger>
          <TabsTrigger value="seo" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            SEO
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hero" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Blog Page Hero</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  value={heroTitle}
                  onChange={(e) => setHeroTitle(e.target.value)}
                  placeholder="Blog"
                  disabled={!hasEditAccess}
                />
              </div>
              <div>
                <Label>Subtitle</Label>
                <Textarea
                  value={heroSubtitle}
                  onChange={(e) => setHeroSubtitle(e.target.value)}
                  placeholder="Latest news, tips and insights"
                  rows={2}
                  disabled={!hasEditAccess}
                />
              </div>
              {hasEditAccess && (
                <div className="flex justify-end">
                  <Button onClick={handleSaveHero} disabled={isUpdating}>
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-6">
          <SEOEditor
            content={seoContent}
            onSave={handleSaveSEO}
            isSaving={isUpdating}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
