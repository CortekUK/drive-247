"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { useCustomSiteEnabled } from "@/hooks/use-custom-site";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle, Clock, Edit, ExternalLink, Eye, FileText, HelpCircle,
  Image as ImageIcon, Newspaper, Sparkles, Tag,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

/**
 * The tenant's own booking site. Mirrors the platform back-office helper: in
 * development this has to point at the site running on localhost, or Preview
 * opens the live deployment — which reads a different database — and the editor
 * looks broken when it is not.
 */
const IS_DEV = process.env.NODE_ENV === "development";
const tenantSiteUrl = (slug: string) =>
  IS_DEV ? `http://${slug}.localhost:3000` : `https://${slug}.drive-247.com`;

/* ========================================================================== *
 * New Website Content.
 *
 * The custom website reads the SAME rows the existing Website Content editor
 * writes — `cms_pages` / `cms_page_sections`, `promotions`, `faqs`,
 * `blog_posts`, and the tenant's own branding — so this page is a way in, not a
 * second content store. Editing here edits the same records, through the same
 * forms, with the same validation, the same media uploads and the same
 * draft/publish behaviour.
 *
 * What it adds is order and orientation: the sections are listed the way the
 * custom site presents them, and the parts that only exist on the custom site
 * (the hero slider, the accent colour) are called out where an operator will
 * look for them.
 *
 * It is reachable only while the super admin's switch is on for this tenant.
 * The check is repeated here rather than trusted from the menu, because a
 * bookmarked URL does not go through the menu.
 * ========================================================================== */

/** The order the custom site presents its pages in. */
const PAGE_ORDER = ["home", "about", "fleet", "reviews", "promotions", "contact", "privacy", "terms", "site-settings"];

/** What each CMS page drives on the custom site, in the operator's words. */
const WHAT_IT_DRIVES: Record<string, string> = {
  home: "Hero headline, hero image slider, benefits, why-choose panels and the closing banner.",
  about: "The about page, your story, the stats band and the FAQs shown across the site.",
  fleet: "Fleet & pricing — headings, inclusions, extras and the rate table.",
  reviews: "The reviews page and the testimonials strip on the home page.",
  promotions: "The promotions page — heading, how-it-works steps, empty state and fine print.",
  contact: "Contact page copy, the enquiry form intro and your contact details.",
  privacy: "Your Privacy Policy, linked from the footer and the cookie banner.",
  terms: "Your Terms & Conditions, linked from the footer.",
  "site-settings": "Logo, business name, footer, social links, phone and address.",
};

/** The three that live outside `cms_pages`, each already having its own editor. */
const SATELLITES = [
  {
    name: "Promotions",
    href: "/cms/promotions",
    icon: Tag,
    description: "Create, edit and schedule the offers shown on the promotions page. Expired and inactive offers hide themselves.",
  },
  {
    name: "FAQs",
    href: "/cms/about",
    icon: HelpCircle,
    description: "Questions and answers for the FAQ page. Reorder them, or switch one off without deleting it.",
  },
  {
    name: "Blog",
    href: "/cms/blog",
    icon: Newspaper,
    description: "Posts, categories and blog settings. Drafts stay private until you publish them.",
  },
];

export default function NewWebsiteContent() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { enabled, ready } = useCustomSiteEnabled();
  const { pages, isLoading } = useCMSPages();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit("cms");

  // A bookmarked link must not open the editor for a tenant whose custom site
  // is switched off. Send them to the editor they DO have, and say why — a
  // silent bounce reads as a broken link, and a 404 reads as a broken portal.
  useEffect(() => {
    if (!ready || enabled) return;
    toast({
      title: "Custom website is not enabled",
      description:
        "This account is not on the new custom website yet. Your website content is here.",
      variant: "destructive",
    });
    router.replace("/cms");
  }, [ready, enabled, router]);

  const sorted = useMemo(
    () =>
      [...pages]
        .filter(p => p.slug !== "blog")
        .sort((a, b) => {
          const ia = PAGE_ORDER.indexOf(a.slug);
          const ib = PAGE_ORDER.indexOf(b.slug);
          return (ia === -1 ? PAGE_ORDER.length : ia) - (ib === -1 ? PAGE_ORDER.length : ib);
        }),
    [pages],
  );

  if (!ready || (ready && !enabled)) {
    return (
      <div className="container mx-auto space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
    );
  }

  const siteUrl = tenant?.slug ? tenantSiteUrl(tenant.slug) : null;

  return (
    <div className="container mx-auto space-y-4 md:space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-display font-bold text-gradient-metal">New Website Content</h1>
            <Badge className="bg-green-500/20 text-green-600 hover:bg-green-500/30">Live</Badge>
          </div>
          <p className="text-muted-foreground mt-2 max-w-3xl">
            Everything on your new website. These are the same records your existing website content
            uses, so an edit here updates both — and publishing works exactly as it always has.
          </p>
        </div>
        {siteUrl && (
          <Button variant="outline" asChild>
            <a href={siteUrl} target="_blank" rel="noopener noreferrer">
              <Eye className="mr-2 h-4 w-4" /> Preview my website
            </a>
          </Button>
        )}
      </div>

      {/* The two controls that exist only on the new website. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Highlight
          icon={ImageIcon}
          title="Hero image slider"
          description="Upload the images that rotate behind your headline, set their order, add mobile versions and switch any of them off."
          action="Open Home content"
          onClick={() => router.push("/cms/home")}
        />
        <Highlight
          icon={Sparkles}
          title="Accent colour"
          description="The colour used for buttons, links and highlights across your new website. Light and dark shades are worked out from it."
          action="Open Branding"
          onClick={() => router.push("/settings?tab=branding")}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Pages</h2>
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-52" />)}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sorted.map(page => (
              <Card
                key={page.id}
                className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 flex flex-col h-full"
                onClick={() => router.push(`/cms/${page.slug}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{page.name}</CardTitle>
                    </div>
                    <Badge
                      variant={page.status === "published" ? "default" : "secondary"}
                      className={page.status === "published" ? "bg-green-500/20 text-green-600 hover:bg-green-500/30" : ""}
                    >
                      {page.status === "published"
                        ? <><CheckCircle className="h-3 w-3 mr-1" />Published</>
                        : <><Clock className="h-3 w-3 mr-1" />Draft</>}
                    </Badge>
                  </div>
                  <CardDescription className="mt-2">
                    {WHAT_IT_DRIVES[page.slug] || page.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col flex-1">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Last updated: </span>
                    {formatDistanceToNow(new Date(page.updated_at), { addSuffix: true })}
                  </div>
                  <Button variant="outline" className="w-full mt-auto pt-3">
                    {hasEditAccess
                      ? <><Edit className="h-4 w-4 mr-2" />Edit Content</>
                      : <><Eye className="h-4 w-4 mr-2" />View Content</>}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Collections</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {SATELLITES.map(s => (
            <Card
              key={s.name}
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 flex flex-col h-full"
              onClick={() => router.push(s.href)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <s.icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{s.name}</CardTitle>
                </div>
                <CardDescription className="mt-2">{s.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col flex-1">
                <Button variant="outline" className="w-full mt-auto">
                  {hasEditAccess
                    ? <><Edit className="h-4 w-4 mr-2" />Manage</>
                    : <><Eye className="h-4 w-4 mr-2" />View</>}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Highlight({
  icon: Icon, title, description, action, onClick,
}: {
  icon: typeof ImageIcon;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <Icon className="h-6 w-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            <Button variant="link" className="px-0 mt-1" onClick={onClick}>
              {action} <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
