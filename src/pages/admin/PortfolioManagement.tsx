import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Star,
  Eye,
  EyeOff,
  Copy,
  ChevronRight,
  Sparkles,
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
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface PortfolioItem {
  id: string;
  title: string;
  slug: string;
  service_type: string;
  location: string;
  event_date: string;
  is_featured: boolean;
  status: string;
  cover_image_url: string;
  created_at: string;
}

export default function PortfolioManagement() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  useEffect(() => {
    loadPortfolioItems();
  }, [statusFilter, serviceFilter, yearFilter]);

  const loadPortfolioItems = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from("portfolio")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (serviceFilter !== "all") {
        query = query.eq("service_type", serviceFilter);
      }

      if (yearFilter !== "all") {
        const year = parseInt(yearFilter);
        query = query
          .gte("event_date", `${year}-01-01`)
          .lte("event_date", `${year}-12-31`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setItems(data || []);
      setLastUpdated(new Date().toLocaleString());
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter((item) =>
    item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getUniqueYears = () => {
    const years = items.map((item) => new Date(item.event_date).getFullYear());
    return Array.from(new Set(years)).sort((a, b) => b - a);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelected = new Set(selectedItems);
    if (checked) {
      newSelected.add(itemId);
    } else {
      newSelected.delete(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleBulkPublish = async () => {
    try {
      const { error } = await supabase
        .from("portfolio")
        .update({ status: "published", published_at: new Date().toISOString() })
        .in("id", Array.from(selectedItems));

      if (error) throw error;

      toast({
        title: "Success",
        description: `Published ${selectedItems.size} items`,
      });
      setSelectedItems(new Set());
      loadPortfolioItems();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleBulkUnpublish = async () => {
    try {
      const { error } = await supabase
        .from("portfolio")
        .update({ status: "draft", published_at: null })
        .in("id", Array.from(selectedItems));

      if (error) throw error;

      toast({
        title: "Success",
        description: `Unpublished ${selectedItems.size} items`,
      });
      setSelectedItems(new Set());
      loadPortfolioItems();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    try {
      const { error } = await supabase
        .from("portfolio")
        .delete()
        .eq("id", itemToDelete);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Portfolio item deleted",
      });
      loadPortfolioItems();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  const handleDuplicate = async (item: PortfolioItem) => {
    try {
      const { data, error } = await supabase
        .from("portfolio")
        .insert([{
          title: `${item.title} (Copy)`,
          slug: `${item.slug}-copy-${Date.now()}`,
          summary: "Edit this summary (155-180 characters required for SEO and preview cards)",
          service_type: item.service_type,
          location: item.location,
          event_date: item.event_date,
          is_featured: item.is_featured,
          status: "draft",
          cover_image_url: item.cover_image_url,
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Portfolio item duplicated",
      });
      navigate(`/admin/portfolio/edit/${data.id}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
            Portfolio Management
          </h1>
          <p className="text-muted-foreground">
            Manage case studies and project showcases
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                onClick={() => navigate("/admin/portfolio/new")}
                className="shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Case Study
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Create a new portfolio showcase</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title or location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>

        <Select value={serviceFilter} onValueChange={setServiceFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Service Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            <SelectItem value="chauffeur">Chauffeur</SelectItem>
            <SelectItem value="close_protection">Close Protection</SelectItem>
            <SelectItem value="both">Both Services</SelectItem>
          </SelectContent>
        </Select>

        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {getUniqueYears().map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
          <span className="text-sm font-medium">
            {selectedItems.size} items selected
          </span>
          <Button size="sm" variant="outline" onClick={handleBulkPublish}>
            <Eye className="mr-2 h-4 w-4" />
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={handleBulkUnpublish}>
            <EyeOff className="mr-2 h-4 w-4" />
            Unpublish
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDeleteDialogOpen(true);
              setItemToDelete(Array.from(selectedItems)[0]);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={
                    filteredItems.length > 0 &&
                    selectedItems.size === filteredItems.length
                  }
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead className="w-20">Image</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Service Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <>
                {[...Array(5)].map((_, i) => (
                  <TableRow key={i} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                    <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                    <TableCell><Skeleton className="h-16 w-16 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </>
            ) : filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-16">
                  <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-accent to-accent/60 opacity-20 blur-3xl rounded-full" />
                      <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
                        <Sparkles className="w-10 h-10 text-accent" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xl font-display font-semibold text-foreground">
                        No portfolio items yet
                      </p>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Showcase your best work by adding your first project
                      </p>
                    </div>
                    <Button 
                      onClick={() => navigate("/admin/portfolio/new")}
                      className="mt-4 shadow-glow"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Case Study
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item, index) => (
                <TableRow 
                  key={item.id}
                  className="hover:bg-accent/5 transition-all duration-300 animate-fade-in group"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedItems.has(item.id)}
                      onCheckedChange={(checked) =>
                        handleSelectItem(item.id, checked as boolean)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <img
                      src={item.cover_image_url}
                      alt={item.title}
                      className="w-16 h-16 object-cover rounded"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {item.is_featured && (
                        <Star className="h-4 w-4 text-accent fill-accent" />
                      )}
                      <span className="font-medium">{item.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {item.service_type === "chauffeur"
                        ? "Chauffeur"
                        : item.service_type === "close_protection"
                        ? "Close Protection"
                        : "Both Services"}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.location}</TableCell>
                  <TableCell>
                    {new Date(item.event_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={item.status === "published" ? "default" : "secondary"}
                      className={item.status === "published" 
                        ? "shadow-[0_0_20px_rgba(255,215,0,0.2)] group-hover:shadow-[0_0_25px_rgba(255,215,0,0.3)] transition-all"
                        : ""
                      }
                    >
                      {item.status === "published" && <span className="mr-1">✓</span>}
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/admin/portfolio/edit/${item.id}`)}
                              className="hover:bg-accent/10 hover:text-accent transition-all"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Edit</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDuplicate(item)}
                              className="hover:bg-accent/10 hover:text-accent transition-all"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Duplicate</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setItemToDelete(item.id);
                                setDeleteDialogOpen(true);
                              }}
                              className="hover:bg-destructive/10 hover:text-destructive transition-all"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Delete</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              portfolio item and all associated images.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
