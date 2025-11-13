import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Send, Archive, Star, MessageSquare, Search, RefreshCcw, Inbox } from "lucide-react";

interface FeedbackSubmission {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  rating: number | null;
  feedback_message: string;
  service_type?: string | null;
  booking_reference?: string | null;
  would_recommend?: boolean | null;
  gdpr_consent?: boolean | null;
  status: string | null;
  created_at: string;
}

export default function FeedbackManagement() {
  const [feedbacks, setFeedbacks] = useState<FeedbackSubmission[]>([]);
  const [filteredFeedbacks, setFilteredFeedbacks] = useState<FeedbackSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackSubmission | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    loadFeedbacks();
  }, []);

  useEffect(() => {
    filterFeedbacks();
  }, [feedbacks, statusFilter, ratingFilter, searchTerm]);

  const loadFeedbacks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback_submissions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(`Failed to load feedback: ${error.message}`);
      setFeedbacks([]);
    } else {
      setFeedbacks(data as any || []);
    }
    setLoading(false);
  };

  const filterFeedbacks = () => {
    let filtered = [...feedbacks];

    if (statusFilter !== "all") {
      filtered = filtered.filter((f) => f.status === statusFilter);
    }

    if (ratingFilter !== "all") {
      filtered = filtered.filter((f) => f.rating === parseInt(ratingFilter));
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (f) =>
          f.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          f.customer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          f.feedback_message?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredFeedbacks(filtered);
  };

  const updateStatus = async (id: string, status: string, additionalData?: any) => {
    const { error } = await supabase
      .from("feedback_submissions")
      .update({
        status,
        ...(status === "reviewed" && { reviewed_at: new Date().toISOString() }),
        ...additionalData,
      })
      .eq("id", id);

    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success(`Feedback marked as ${status}`);
      loadFeedbacks();
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.length === 0) return;

    const { error } = await supabase
      .from("feedback_submissions")
      .update({ status: "archived" })
      .in("id", selectedIds);

    if (error) {
      toast.error("Failed to archive selected feedback");
    } else {
      toast.success(`${selectedIds.length} feedback(s) archived`);
      setSelectedIds([]);
      loadFeedbacks();
    }
  };

  const publishToReviews = async (feedback: FeedbackSubmission) => {
    try {
      // Create testimonial from feedback
      const { error: createError } = await supabase
        .from("testimonials")
        .insert({
          feedback_id: feedback.id,
          customer_name: feedback.customer_name,
          anonymised: false,
          content: feedback.feedback_message,
          review_text: feedback.feedback_message,
          rating: feedback.rating || 5,
          is_active: true,
          is_featured: false,
        });

      if (createError) throw createError;

      // Update feedback status to published
      const { error: updateError } = await supabase
        .from("feedback_submissions")
        .update({
          status: "published",
        })
        .eq("id", feedback.id);

      if (updateError) throw updateError;

      toast.success("Feedback published to reviews successfully");
      setViewDialogOpen(false);
      loadFeedbacks();
    } catch (error) {
      console.error("Publish error:", error);
      toast.error("Failed to publish feedback to reviews");
    }
  };

  const stats = useMemo(() => ({
    total: feedbacks.length,
    new: feedbacks.filter((f) => f.status === "pending").length,
    reviewed: feedbacks.filter((f) => f.status === "reviewed").length,
    published: feedbacks.filter((f) => f.status === "published").length,
    avgRating: feedbacks.length
      ? (feedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / feedbacks.length).toFixed(1)
      : "0",
  }), [feedbacks]);

  const getStatusBadge = (status: string | null) => {
    const statusConfig: Record<string, { variant: any; label: string }> = {
      pending: { variant: "default", label: "New" },
      new: { variant: "default", label: "New" },
      reviewed: { variant: "secondary", label: "Reviewed" },
      published: { variant: "outline", label: "Published" },
      archived: { variant: "destructive", label: "Archived" },
      approved: { variant: "secondary", label: "Approved" },
      converted: { variant: "outline", label: "Converted" },
    };

    const config = statusConfig[status || "pending"] || { variant: "default", label: status || "New" };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getSourceBadge = (source: string) => {
    const sourceConfig: Record<string, string> = {
      website_form: "Website",
      email: "Email",
      import: "Import",
    };

    return (
      <Badge variant="outline" className="text-xs">
        {sourceConfig[source] || source}
      </Badge>
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredFeedbacks.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredFeedbacks.map(f => f.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">Feedback Management</h1>
          <p className="text-muted-foreground">Private inbox for customer feedback submissions</p>
        </div>
        <Button onClick={loadFeedbacks} variant="outline" className="gap-2">
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card className="border-blue-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              New
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{stats.new}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Reviewed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.reviewed}</div>
          </CardContent>
        </Card>

        <Card className="border-accent/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Published</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-accent">{stats.published}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Avg Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              {stats.avgRating}
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Feedback Submissions</CardTitle>
              <CardDescription>Review, publish, or archive customer feedback</CardDescription>
            </div>
            {selectedIds.length > 0 && (
              <div className="flex gap-2">
                <Badge variant="secondary">{selectedIds.length} selected</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkArchive}
                  className="gap-2"
                >
                  <Archive className="w-4 h-4" />
                  Archive Selected
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or message..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>

            <Select value={ratingFilter} onValueChange={setRatingFilter}>
              <SelectTrigger className="md:w-40">
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ratings</SelectItem>
                <SelectItem value="5">5 Stars</SelectItem>
                <SelectItem value="4">4 Stars</SelectItem>
                <SelectItem value="3">3 Stars</SelectItem>
                <SelectItem value="2">2 Stars</SelectItem>
                <SelectItem value="1">1 Star</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p>Loading...</p>
          ) : filteredFeedbacks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                <Inbox className="w-10 h-10 text-accent" />
              </div>
              <h3 className="text-xl font-display font-bold mb-2">No feedback yet</h3>
              <p className="text-muted-foreground max-w-md">
                New website submissions will appear here. You can publish selected items to Customer Reviews.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedIds.length === filteredFeedbacks.length && filteredFeedbacks.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFeedbacks.map((feedback) => (
                    <TableRow key={feedback.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(feedback.id)}
                          onCheckedChange={() => toggleSelect(feedback.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{feedback.customer_name}</p>
                          <p className="text-sm text-muted-foreground">{feedback.customer_email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {feedback.rating}
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        </div>
                      </TableCell>
                      <TableCell>{getSourceBadge(feedback.service_type || "website")}</TableCell>
                      <TableCell>{getStatusBadge(feedback.status)}</TableCell>
                      <TableCell>{new Date(feedback.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedFeedback(feedback);
                            setViewDialogOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Feedback Details</DialogTitle>
          </DialogHeader>
          {selectedFeedback && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Customer Name</Label>
                  <p className="text-foreground">{selectedFeedback.customer_name}</p>
                </div>
                <div>
                  <Label>Email</Label>
                  <p className="text-foreground">{selectedFeedback.customer_email}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <Label>Rating</Label>
                  <div className="flex gap-1 mt-1">
                    {Array.from({ length: selectedFeedback.rating || 5 }).map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Source</Label>
                  <div className="mt-1">{getSourceBadge(selectedFeedback.service_type || "website")}</div>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedFeedback.status || "pending")}</div>
                </div>
              </div>

              <div>
                <Label>Feedback Message</Label>
                <p className="whitespace-pre-wrap mt-1 p-3 bg-muted/30 rounded-lg border border-border">
                  {selectedFeedback.feedback_message}
                </p>
              </div>

              <div>
                <Label htmlFor="notes">Admin Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add internal notes about this feedback..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                {selectedFeedback.status === "pending" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      updateStatus(selectedFeedback.id, "reviewed");
                      setViewDialogOpen(false);
                    }}
                  >
                    Mark as Reviewed
                  </Button>
                )}
                {selectedFeedback.status !== "archived" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      updateStatus(selectedFeedback.id, "archived");
                      setViewDialogOpen(false);
                    }}
                    className="gap-2"
                  >
                    <Archive className="h-4 w-4" />
                    Archive
                  </Button>
                )}
                {selectedFeedback.status !== "published" && (
                  <Button
                    onClick={() => publishToReviews(selectedFeedback)}
                    className="gap-2 gradient-accent shadow-glow"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Publish to Reviews
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}