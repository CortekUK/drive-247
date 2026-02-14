"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useCMSPage, useCMSPages } from "@/hooks/use-cms-pages";
import { useCMSPageSections } from "@/hooks/use-cms-page-sections";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
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
  Crown,
  Plus,
  Edit,
  Trash2,
  Tag,
  Calendar,
  Percent,
  DollarSign,
  Image,
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
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { format, isBefore, isAfter } from "date-fns";

// Promotion types
interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  start_date: string;
  end_date: string;
  promo_code: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

const promotionSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  discount_type: z.enum(["percentage", "fixed"]),
  discount_value: z.number().min(0.01, "Discount value must be greater than 0"),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().min(1, "End date is required"),
  promo_code: z.string().optional(),
  image_url: z.string().optional(),
  is_active: z.boolean().default(true),
}).refine((data) => new Date(data.end_date) > new Date(data.start_date), {
  message: "End date must be after start date",
  path: ["end_date"],
});

type PromotionFormValues = z.infer<typeof promotionSchema>;

const defaultFormData: PromotionFormValues = {
  title: "",
  description: "",
  discount_type: "percentage",
  discount_value: 0,
  start_date: "",
  end_date: "",
  promo_code: "",
  image_url: "",
  is_active: true,
};

export default function CMSPromotionsEditor() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { data: page, isLoading } = useCMSPage("promotions");
  const { publishPage, isPublishing } = useCMSPages();
  const { updateSection, isUpdating } = useCMSPageSections("promotions");
  const [activeTab, setActiveTab] = useState("manage");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { canEdit } = useManagerPermissions();

  // Promotions management state
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: defaultFormData,
    mode: "onChange",
  });

  useEffect(() => {
    if (tenant) {
      loadPromotions();
    }
  }, [tenant]);

  const loadPromotions = async () => {
    setPromotionsLoading(true);
    let query = (supabase as any)
      .from("promotions")
      .select("*");

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("Failed to load promotions:", error);
      toast.error("Failed to load promotions");
    } else {
      setPromotions(data || []);
    }
    setPromotionsLoading(false);
  };

  const getPromotionStatus = (promo: Promotion) => {
    const now = new Date();
    const start = new Date(promo.start_date);
    const end = new Date(promo.end_date);

    if (!promo.is_active) return "inactive";
    if (isAfter(now, end)) return "expired";
    if (isBefore(now, start)) return "scheduled";
    return "active";
  };

  const handleToggleActive = async (id: string, value: boolean) => {
    const oldPromotions = [...promotions];
    setPromotions(promotions.map(p => p.id === id ? { ...p, is_active: value } : p));

    let query = (supabase as any)
      .from("promotions")
      .update({ is_active: value })
      .eq("id", id);

    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    const { error } = await query;

    if (error) {
      toast.error("Failed to update promotion");
      setPromotions(oldPromotions);
    } else {
      toast.success(`Promotion ${value ? 'activated' : 'deactivated'}`);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `promo-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('cms-media')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('cms-media')
        .getPublicUrl(fileName);

      form.setValue("image_url", publicUrl);
      toast.success("Image uploaded");
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (data: PromotionFormValues) => {
    setSaving(true);

    const promoData = {
      title: data.title,
      description: data.description,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      start_date: data.start_date,
      end_date: data.end_date,
      promo_code: data.promo_code || null,
      image_url: data.image_url || null,
      is_active: data.is_active,
    };

    if (editingPromotion) {
      let updateQuery = (supabase as any)
        .from("promotions")
        .update(promoData)
        .eq("id", editingPromotion.id);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await updateQuery;

      if (error) {
        console.error("Update error:", error);
        toast.error(`Failed to update: ${error.message}`);
        setSaving(false);
        return;
      }
      toast.success("Promotion updated");
    } else {
      const { error } = await (supabase as any)
        .from("promotions")
        .insert({
          ...promoData,
          tenant_id: tenant?.id || null,
        });

      if (error) {
        console.error("Insert error:", error);
        toast.error(`Failed to create: ${error.message}`);
        setSaving(false);
        return;
      }
      toast.success("Promotion created");
    }

    setSaving(false);
    setDialogOpen(false);
    resetForm();
    loadPromotions();
  };

  const confirmDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    let deleteQuery = (supabase as any).from("promotions").delete().eq("id", deletingId);

    if (tenant?.id) {
      deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
    }

    const { error } = await deleteQuery;

    if (error) {
      toast.error("Failed to delete promotion");
      return;
    }

    toast.success("Promotion deleted");
    setDeleteDialogOpen(false);
    setDeletingId(null);
    loadPromotions();
  };

  const handleEdit = (promo: Promotion) => {
    setEditingPromotion(promo);
    form.reset({
      title: promo.title,
      description: promo.description,
      discount_type: promo.discount_type as "percentage" | "fixed",
      discount_value: promo.discount_value,
      start_date: promo.start_date.split('T')[0],
      end_date: promo.end_date.split('T')[0],
      promo_code: promo.promo_code || "",
      image_url: promo.image_url || "",
      is_active: promo.is_active,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingPromotion(null);
    form.reset(defaultFormData);
  };

  const filteredPromotions = useMemo(() => {
    let filtered = promotions;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          (p.promo_code && p.promo_code.toLowerCase().includes(query))
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((p) => getPromotionStatus(p) === statusFilter);
    }

    return filtered;
  }, [promotions, searchQuery, statusFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500/20 text-green-600">Active</Badge>;
      case "scheduled":
        return <Badge className="bg-blue-500/20 text-blue-600">Scheduled</Badge>;
      case "expired":
        return <Badge variant="secondary">Expired</Badge>;
      case "inactive":
        return <Badge variant="outline">Inactive</Badge>;
      default:
        return null;
    }
  };

  const stats = useMemo(() => {
    const active = promotions.filter(p => getPromotionStatus(p) === "active").length;
    const scheduled = promotions.filter(p => getPromotionStatus(p) === "scheduled").length;
    const expired = promotions.filter(p => getPromotionStatus(p) === "expired").length;
    return { total: promotions.length, active, scheduled, expired };
  }, [promotions]);

  const imageUrl = form.watch("image_url");
  const discountType = form.watch("discount_type");

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
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="manage" className="flex items-center gap-2">
                <Crown className="h-4 w-4" />
                <span className="hidden lg:inline">Manage</span>
              </TabsTrigger>
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

            <div className={!canEdit('cms') ? "pointer-events-none select-none" : ""}>
            <div className="mt-6">
              {/* Manage Promotions Tab */}
              <TabsContent value="manage" className="mt-0 space-y-4">
                {/* Add Promotion Button */}
                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground">
                    Create and manage promotional offers for customers
                  </p>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={resetForm}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Promotion
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>
                          {editingPromotion ? "Edit Promotion" : "Create Promotion"}
                        </DialogTitle>
                      </DialogHeader>
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="title"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Title <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input placeholder="Summer Sale - 20% Off" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Description <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Textarea placeholder="Get 20% off on all luxury vehicle rentals..." rows={3} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="discount_type"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Discount Type <span className="text-destructive">*</span></FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="percentage">
                                        <div className="flex items-center gap-2">
                                          <Percent className="h-4 w-4" />
                                          Percentage (%)
                                        </div>
                                      </SelectItem>
                                      <SelectItem value="fixed">
                                        <div className="flex items-center gap-2">
                                          <DollarSign className="h-4 w-4" />
                                          Fixed Amount ($)
                                        </div>
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="discount_value"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Discount Value <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        type="number"
                                        min="0"
                                        step={discountType === "percentage" ? "1" : "0.01"}
                                        className="pl-8"
                                        {...field}
                                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                      />
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        {discountType === "percentage" ? "%" : "$"}
                                      </span>
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="start_date"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Start Date <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input type="date" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="end_date"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>End Date <span className="text-destructive">*</span></FormLabel>
                                  <FormControl>
                                    <Input type="date" min={form.watch("start_date")} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="promo_code"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>Promo Code (Optional)</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                      <Input
                                        placeholder="SUMMER20"
                                        className="pl-10 uppercase"
                                        {...field}
                                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                                      />
                                    </div>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="space-y-2 md:col-span-2">
                              <FormLabel>Promotion Image (Optional)</FormLabel>
                              {imageUrl ? (
                                <div className="relative">
                                  <img src={imageUrl} alt="Promotion" className="w-full h-32 object-cover rounded-lg border" />
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="absolute top-2 right-2"
                                    onClick={() => form.setValue("image_url", "")}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ) : (
                                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                                  <Image className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                                  <p className="text-sm text-muted-foreground mb-2">Upload promotion image</p>
                                  <Input
                                    id="promo-image"
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleImageUpload(file);
                                    }}
                                    disabled={uploading}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => document.getElementById('promo-image')?.click()}
                                    disabled={uploading}
                                  >
                                    {uploading ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Uploading...
                                      </>
                                    ) : (
                                      "Choose File"
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>

                            <FormField
                              control={form.control}
                              name="is_active"
                              render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-2 space-y-0 md:col-span-2">
                                  <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                  </FormControl>
                                  <FormLabel>Active</FormLabel>
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="flex gap-3 pt-2">
                            <Button type="submit" disabled={!form.formState.isValid || saving}>
                              {saving ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                editingPromotion ? "Update Promotion" : "Create Promotion"
                              )}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">{stats.total}</div>
                      <p className="text-sm text-muted-foreground">Total</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                      <p className="text-sm text-muted-foreground">Active</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-blue-600">{stats.scheduled}</div>
                      <p className="text-sm text-muted-foreground">Scheduled</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-muted-foreground">{stats.expired}</div>
                      <p className="text-sm text-muted-foreground">Expired</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search promotions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Promotions List */}
                {promotionsLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(6)].map((_, i) => (
                      <Skeleton key={i} className="h-64 rounded-lg" />
                    ))}
                  </div>
                ) : filteredPromotions.length === 0 ? (
                  <div className="py-12 text-center border rounded-lg">
                    <Crown className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No promotions found</h3>
                    <p className="text-muted-foreground mb-4">
                      {searchQuery || statusFilter !== "all"
                        ? "Try adjusting your filters"
                        : "Create your first promotion to get started"}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPromotions.map((promo) => {
                      const status = getPromotionStatus(promo);
                      return (
                        <Card key={promo.id} className="overflow-hidden">
                          {promo.image_url ? (
                            <div className="aspect-video relative">
                              <img src={promo.image_url} alt={promo.title} className="w-full h-full object-cover" />
                              <div className="absolute top-2 right-2">{getStatusBadge(status)}</div>
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-accent text-accent-foreground">
                                  {promo.discount_type === "percentage" ? `${promo.discount_value}% OFF` : `$${promo.discount_value} OFF`}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            <div className="aspect-video bg-muted/50 flex items-center justify-center relative">
                              <Crown className="h-12 w-12 text-muted-foreground/30" />
                              <div className="absolute top-2 right-2">{getStatusBadge(status)}</div>
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-accent text-accent-foreground">
                                  {promo.discount_type === "percentage" ? `${promo.discount_value}% OFF` : `$${promo.discount_value} OFF`}
                                </Badge>
                              </div>
                            </div>
                          )}
                          <CardContent className="p-4">
                            <h3 className="font-semibold mb-1 line-clamp-1">{promo.title}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{promo.description}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(promo.start_date), "MMM d")} - {format(new Date(promo.end_date), "MMM d, yyyy")}
                            </div>
                            {promo.promo_code && (
                              <div className="flex items-center gap-2 mb-3">
                                <Tag className="h-3 w-3 text-accent" />
                                <code className="text-xs px-2 py-1 bg-accent/10 text-accent rounded">{promo.promo_code}</code>
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-3 border-t">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={promo.is_active}
                                  onCheckedChange={(checked) => handleToggleActive(promo.id, checked)}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {promo.is_active ? "Active" : "Inactive"}
                                </span>
                              </div>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEdit(promo)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => confirmDelete(promo.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Delete Confirmation Dialog */}
                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this promotion?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This promotion will be permanently removed. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TabsContent>

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
