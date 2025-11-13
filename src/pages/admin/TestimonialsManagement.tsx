import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Star, MessageSquareQuote, Search, ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";

interface Testimonial {
  id: string;
  customer_name: string;
  customer_title: string;
  content: string;
  review_text: string;
  rating: number;
  is_featured: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  feedback_id?: string;
  anonymised?: boolean;
  vehicle_id?: string;
  rental_period_start?: string;
  rental_period_end?: string;
}

interface Vehicle {
  id: string;
  name: string;
  category: string;
}

const ITEMS_PER_PAGE = 12;
const MIN_CHARS = 30;
const MAX_CHARS = 600;
const MIN_NAME = 2;
const MAX_NAME = 80;
const MAX_TITLE = 80;

const TestimonialListItem = ({ testimonial, onEdit, onDelete, onToggleActive, onToggleFeatured }: {
  testimonial: Testimonial;
  onEdit: (t: Testimonial) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, value: boolean) => void;
  onToggleFeatured: (id: string, value: boolean) => void;
}) => {
  const now = new Date();
  const createdAt = new Date(testimonial.created_at);
  const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const isNew = hoursDiff < 24;

  const viewSourceFeedback = async () => {
    if (testimonial.feedback_id) {
      window.location.href = `/admin/feedback`;
      toast.success("Navigated to Feedback Management");
    }
  };

  return (
    <div className="p-4 border-b border-border/50 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-4">
        {/* Customer Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{testimonial.customer_name}</h3>
                {testimonial.anonymised && (
                  <Badge variant="outline" className="text-xs">Anonymized</Badge>
                )}
              </div>
              {testimonial.customer_title && (
                <p className="text-sm text-muted-foreground">{testimonial.customer_title}</p>
              )}
            </div>

            {/* Badges */}
            <div className="flex gap-1.5 flex-wrap">
              {testimonial.feedback_id && (
                <Badge 
                  className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs cursor-pointer hover:bg-blue-500/30"
                  onClick={viewSourceFeedback}
                >
                  From Feedback
                </Badge>
              )}
              {isNew && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">New</Badge>
              )}
              {testimonial.is_featured && (
                <Badge className="bg-accent/20 text-accent border-accent/30 text-xs">Featured</Badge>
              )}
              {!testimonial.is_active && (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
            </div>
          </div>

          {/* Rating */}
          <div className="flex gap-1 mb-2" aria-label={`${testimonial.rating} out of 5 stars`}>
            {[...Array(testimonial.rating || 5)].map((_, i) => (
              <Star key={i} className="w-4 h-4 fill-accent text-accent" aria-hidden="true" />
            ))}
          </div>

          {/* Content */}
          <p className="text-sm text-foreground/80 italic line-clamp-2 mb-3">
            "{testimonial.review_text || testimonial.content}"
          </p>

          {/* Vehicle Info */}
          {(testimonial.vehicle_id || testimonial.rental_period_start) && (
            <p className="text-xs text-muted-foreground mb-3">
              {testimonial.rental_period_start && `Rental: ${new Date(testimonial.rental_period_start).toLocaleDateString()}${testimonial.rental_period_end ? ` - ${new Date(testimonial.rental_period_end).toLocaleDateString()}` : ''}`}
            </p>
          )}

          {/* Controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                checked={testimonial.is_active}
                onCheckedChange={(checked) => onToggleActive(testimonial.id, checked)}
                aria-label={`Toggle active status for ${testimonial.customer_name}'s testimonial`}
              />
              <Label className="text-xs text-muted-foreground">Active</Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={testimonial.is_featured}
                onCheckedChange={(checked) => onToggleFeatured(testimonial.id, checked)}
                aria-label={`Toggle featured status for ${testimonial.customer_name}'s testimonial`}
              />
              <Label className="text-xs text-muted-foreground">Featured</Label>
            </div>

            <div className="flex gap-2 ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(testimonial)}
                aria-label={`Edit testimonial for ${testimonial.customer_name}`}
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDelete(testimonial.id)}
                aria-label={`Delete testimonial for ${testimonial.customer_name}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const TestimonialsManagement = () => {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTestimonial, setEditingTestimonial] = useState<Testimonial | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive" | "featured">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "display" | "rating">("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_title: "",
    content: "",
    rating: 5,
    anonymised: false,
    vehicle_id: "none",
    rental_period_start: "",
    rental_period_end: "",
    is_featured: false,
    is_active: true,
  });

  useEffect(() => {
    loadTestimonials();
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    const { data } = await supabase
      .from("vehicles")
      .select("id, name, category")
      .eq("is_active", true)
      .order("name");
    
    if (data) setVehicles(data);
  };

  const loadTestimonials = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("testimonials")
      .select("*", { count: 'exact', head: false })
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load testimonials");
    } else {
      setTestimonials(data || []);
    }
    setLoading(false);
  };

  const handleToggleActive = async (id: string, value: boolean) => {
    const oldTestimonials = [...testimonials];
    setTestimonials(testimonials.map(t => t.id === id ? { ...t, is_active: value } : t));

    const { error } = await supabase
      .from("testimonials")
      .update({ is_active: value })
      .eq("id", id);

    if (error) {
      toast.error("Couldn't save changes, please try again");
      setTestimonials(oldTestimonials);
    }
  };

  const handleToggleFeatured = async (id: string, value: boolean) => {
    const oldTestimonials = [...testimonials];
    setTestimonials(testimonials.map(t => t.id === id ? { ...t, is_featured: value } : t));

    const { error } = await supabase
      .from("testimonials")
      .update({ is_featured: value })
      .eq("id", id);

    if (error) {
      toast.error("Couldn't save changes, please try again");
      setTestimonials(oldTestimonials);
    }
  };

  const isFormValid = useMemo(() => {
    const nameValid = formData.customer_name.trim().length >= MIN_NAME && formData.customer_name.trim().length <= MAX_NAME;
    const titleValid = formData.customer_title.length <= MAX_TITLE;
    const contentValid = formData.content.trim().length >= MIN_CHARS && formData.content.trim().length <= MAX_CHARS;
    return nameValid && titleValid && contentValid;
  }, [formData]);

  const checkForDuplicates = async (name: string, text: string): Promise<boolean> => {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: existingReviews } = await supabase
      .from("testimonials")
      .select("id, customer_name, review_text, content")
      .eq("is_active", true)
      .gte("created_at", sixtyDaysAgo.toISOString());

    if (existingReviews) {
      const similarReview = existingReviews.find(review => {
        const reviewText = review.review_text || review.content;
        return review.customer_name.toLowerCase() === name.toLowerCase() &&
               reviewText.toLowerCase() === text.toLowerCase();
      });

      if (similarReview && (!editingTestimonial || similarReview.id !== editingTestimonial.id)) {
        return confirm(
          "⚠️ De-duplication Warning\n\n" +
          "A similar active review from this customer already exists in the last 60 days.\n\n" +
          "Continue anyway?"
        );
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) {
      toast.error("Please check all fields and try again");
      return;
    }

    // Check for old brand mentions
    const contentLower = formData.content.toLowerCase();
    if (contentLower.includes('supreme')) {
      const shouldAutoFix = confirm(
        "⚠️ Brand Mention Detected\n\n" +
        "Detected old brand name 'Supreme' in the review text.\n\n" +
        "Would you like to automatically replace it with 'Drive 917' before publishing?"
      );
      
      if (!shouldAutoFix) {
        toast.error("Please update the review text to use 'Drive 917' instead of old brand names");
        return;
      }
      
      // Auto-fix: replace Supreme mentions
      formData.content = formData.content
        .replace(/Supreme Drive Suite/gi, 'Drive 917')
        .replace(/Supreme Drive/gi, 'Drive 917')
        .replace(/Supreme/gi, 'Drive 917');
      
      toast.success("Brand names automatically updated to 'Drive 917'");
    }

    // Check for duplicates
    const shouldContinue = await checkForDuplicates(formData.customer_name, formData.content);
    if (!shouldContinue) return;

    const submitData = {
      ...formData,
      review_text: formData.content,
      vehicle_id: formData.vehicle_id === "none" ? null : formData.vehicle_id,
      rental_period_start: formData.rental_period_start || null,
      rental_period_end: formData.rental_period_end || null,
    };

    if (editingTestimonial) {
      const { data, error } = await supabase
        .from("testimonials")
        .update(submitData)
        .eq("id", editingTestimonial.id)
        .select()
        .single();

      if (error) {
        toast.error("Failed to update testimonial");
        return;
      }
      
      setTestimonials(testimonials.map(t => t.id === editingTestimonial.id ? data : t));
      toast.success("Testimonial updated");
    } else {
      const maxOrder = testimonials.reduce((max, t) => Math.max(max, t.display_order || 0), 0);
      const { data, error } = await supabase
        .from("testimonials")
        .insert({ ...submitData, display_order: maxOrder + 1 })
        .select()
        .single();

      if (error) {
        toast.error("Failed to create testimonial");
        return;
      }
      
      setTestimonials([...testimonials, data]);
      toast.success("Testimonial added and visible on website");
    }

    setDialogOpen(false);
    resetForm();
  };

  const confirmDelete = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    const { error } = await supabase.from("testimonials").delete().eq("id", deletingId);

    if (error) {
      toast.error("Failed to delete testimonial");
      return;
    }

    toast.success("Testimonial deleted");
    setDeleteDialogOpen(false);
    setDeletingId(null);
    loadTestimonials();
  };

  const handleEdit = (testimonial: Testimonial) => {
    setEditingTestimonial(testimonial);
    setFormData({
      customer_name: testimonial.customer_name,
      customer_title: testimonial.customer_title || "",
      content: testimonial.review_text || testimonial.content,
      rating: testimonial.rating || 5,
      anonymised: testimonial.anonymised || false,
      vehicle_id: testimonial.vehicle_id || "none",
      rental_period_start: testimonial.rental_period_start || "",
      rental_period_end: testimonial.rental_period_end || "",
      is_featured: testimonial.is_featured,
      is_active: testimonial.is_active,
    });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingTestimonial(null);
    setFormData({
      customer_name: "",
      customer_title: "",
      content: "",
      rating: 5,
      anonymised: false,
      vehicle_id: "none",
      rental_period_start: "",
      rental_period_end: "",
      is_featured: false,
      is_active: true,
    });
  };

  const filteredAndSortedTestimonials = useMemo(() => {
    let result = [...testimonials];

    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.customer_name.toLowerCase().includes(query) ||
          t.customer_title?.toLowerCase().includes(query) ||
          t.content.toLowerCase().includes(query)
      );
    }

    // Filter by status
    if (filterStatus === "active") {
      result = result.filter((t) => t.is_active);
    } else if (filterStatus === "inactive") {
      result = result.filter((t) => !t.is_active);
    } else if (filterStatus === "featured") {
      result = result.filter((t) => t.is_featured);
    }

    // Sort
    if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else if (sortBy === "rating") {
      result.sort((a, b) => (b.rating || 5) - (a.rating || 5));
    } else {
      result.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    }

    return result;
  }, [testimonials, searchQuery, filterStatus, sortBy]);

  const paginatedTestimonials = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedTestimonials.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedTestimonials, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedTestimonials.length / ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const charCount = formData.content.length;
  const nameLength = formData.customer_name.trim().length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Customer Reviews Management</h1>
          <p className="text-muted-foreground">
            Manage customer reviews and testimonials from vehicle rentals
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={loadTestimonials} variant="outline" className="gap-2">
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </Button>
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-accent shadow-glow" onClick={resetForm}>
                <Plus className="w-4 h-4 mr-2" />
                Add Testimonial
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTestimonial ? "Edit Testimonial" : "Add New Testimonial"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Customer Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.customer_name}
                    onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                    maxLength={MAX_NAME}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {nameLength}/{MAX_NAME} characters
                    {nameLength < MIN_NAME && nameLength > 0 && (
                      <span className="text-destructive ml-2">Minimum {MIN_NAME} characters</span>
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Title/Company</Label>
                  <Input
                    id="title"
                    value={formData.customer_title}
                    onChange={(e) => setFormData({ ...formData, customer_title: e.target.value })}
                    placeholder="e.g., CEO, Morrison Enterprises"
                    maxLength={MAX_TITLE}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.customer_title.length}/{MAX_TITLE} characters
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">
                  Testimonial Content <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={5}
                  maxLength={MAX_CHARS}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {charCount}/{MAX_CHARS} characters
                  {charCount < MIN_CHARS && charCount > 0 && (
                    <span className="text-destructive ml-2">Minimum {MIN_CHARS} characters</span>
                  )}
                  {charCount >= MIN_CHARS && charCount <= MAX_CHARS && (
                    <span className="text-accent ml-2">✓ Valid length</span>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rating">Rating</Label>
                <Select
                  value={formData.rating.toString()}
                  onValueChange={(value) => setFormData({ ...formData, rating: parseInt(value) })}
                >
                  <SelectTrigger id="rating">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 4, 3, 2, 1].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? "Star" : "Stars"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vehicle_id">Vehicle (Optional)</Label>
                <Select
                  value={formData.vehicle_id}
                  onValueChange={(value) => setFormData({ ...formData, vehicle_id: value })}
                >
                  <SelectTrigger id="vehicle_id">
                    <SelectValue placeholder="Select vehicle..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.name} ({vehicle.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Link this review to a specific vehicle
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rental_period_start">Rental Start (Optional)</Label>
                  <Input
                    id="rental_period_start"
                    type="date"
                    value={formData.rental_period_start}
                    onChange={(e) => setFormData({ ...formData, rental_period_start: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rental_period_end">Rental End (Optional)</Label>
                  <Input
                    id="rental_period_end"
                    type="date"
                    value={formData.rental_period_end}
                    onChange={(e) => setFormData({ ...formData, rental_period_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="anonymised"
                    checked={formData.anonymised}
                    onCheckedChange={(checked) => setFormData({ ...formData, anonymised: checked })}
                  />
                  <Label htmlFor="anonymised">Anonymize Name</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="featured"
                    checked={formData.is_featured}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_featured: checked })}
                  />
                  <Label htmlFor="featured">Featured</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="active">Active</Label>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  className="gradient-accent shadow-glow"
                  disabled={!isFormValid}
                >
                  {editingTestimonial ? "Save Changes" : "Create Testimonial"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-4 items-center justify-between bg-card/50 p-4 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 flex-1 min-w-[250px]">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, company, quote…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Button
            size="sm"
            variant={filterStatus === "all" ? "default" : "outline"}
            onClick={() => setFilterStatus("all")}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filterStatus === "active" ? "default" : "outline"}
            onClick={() => setFilterStatus("active")}
          >
            Active
          </Button>
          <Button
            size="sm"
            variant={filterStatus === "inactive" ? "default" : "outline"}
            onClick={() => setFilterStatus("inactive")}
          >
            Inactive
          </Button>
          <Button
            size="sm"
            variant={filterStatus === "featured" ? "default" : "outline"}
            onClick={() => setFilterStatus("featured")}
          >
            Featured
          </Button>

          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="display">Display Order</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="rating">Rating ↓</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : paginatedTestimonials.length === 0 ? (
        <Card className="p-12 text-center shadow-metal">
          <MessageSquareQuote className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-display font-bold mb-2">No testimonials yet</h3>
          <p className="text-muted-foreground mb-6">
            Add your first testimonial to showcase trust and build credibility
          </p>
          <Button className="gradient-accent shadow-glow" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Testimonial
          </Button>
        </Card>
      ) : (
        <>
          <Card className="shadow-metal">
            <div className="divide-y divide-border/50">
              {paginatedTestimonials.map((testimonial) => (
                <TestimonialListItem
                  key={testimonial.id}
                  testimonial={testimonial}
                  onEdit={handleEdit}
                  onDelete={confirmDelete}
                  onToggleActive={handleToggleActive}
                  onToggleFeatured={handleToggleFeatured}
                />
              ))}
            </div>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border/50">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} • {filteredAndSortedTestimonials.length} testimonial{filteredAndSortedTestimonials.length !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                >
                  First
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete testimonial?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The testimonial will be removed from the website.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TestimonialsManagement;
