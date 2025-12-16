import { useState, forwardRef, useImperativeHandle } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Trash2, Star, MessageSquareQuote, Edit, AlertTriangle } from "lucide-react";
import { useTestimonials } from "@/hooks/use-testimonials";
import { EmptyState } from "@/components/shared/data-display/empty-state";

export interface TestimonialsManagerRef {
  openDialog: () => void;
}

export const TestimonialsManager = forwardRef<TestimonialsManagerRef>((props, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [author, setAuthor] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [stars, setStars] = useState<string>("5");
  const [review, setReview] = useState("");

  const {
    testimonials,
    isLoading,
    addTestimonial,
    updateTestimonial,
    deleteTestimonial,
    isAdding,
    isUpdating,
    isDeleting
  } = useTestimonials();

  const handleOpenDialog = (testimonial?: any) => {
    if (testimonial) {
      setEditingId(testimonial.id);
      setAuthor(testimonial.author);
      setCompanyName(testimonial.company_name);
      setStars(testimonial.stars.toString());
      setReview(testimonial.review);
    } else {
      setEditingId(null);
      setAuthor("");
      setCompanyName("");
      setStars("5");
      setReview("");
    }
    setIsOpen(true);
  };

  const handleCloseDialog = () => {
    setIsOpen(false);
    setEditingId(null);
    setAuthor("");
    setCompanyName("");
    setStars("5");
    setReview("");
  };

  const handleSubmit = () => {
    if (!author || !companyName || !review) return;

    const testimonialData = {
      author,
      company_name: companyName,
      stars: parseInt(stars),
      review,
    };

    if (editingId) {
      updateTestimonial(
        { id: editingId, data: testimonialData },
        {
          onSuccess: () => {
            handleCloseDialog();
          },
        }
      );
    } else {
      addTestimonial(testimonialData, {
        onSuccess: () => {
          handleCloseDialog();
        },
      });
    }
  };

  const handleDelete = () => {
    if (deletingId) {
      deleteTestimonial(deletingId, {
        onSuccess: () => {
          setDeletingId(null);
        },
      });
    }
  };

  const renderStars = (count: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= count
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    openDialog: () => handleOpenDialog(),
  }));

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Testimonial" : "Add New Testimonial"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Author Name */}
              <div className="space-y-2">
                <Label>Author Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g., John Smith"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>

              {/* Company Name */}
              <div className="space-y-2">
                <Label>Company Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g., ABC Corporation"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              {/* Stars Rating */}
              <div className="space-y-2">
                <Label>Rating <span className="text-red-500">*</span></Label>
                <Select value={stars} onValueChange={setStars}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 Stars</SelectItem>
                    <SelectItem value="4">4 Stars</SelectItem>
                    <SelectItem value="3">3 Stars</SelectItem>
                    <SelectItem value="2">2 Stars</SelectItem>
                    <SelectItem value="1">1 Star</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Review */}
              <div className="space-y-2">
                <Label>Review <span className="text-red-500">*</span></Label>
                <Textarea
                  placeholder="Write the testimonial review here..."
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  className="resize-none min-h-[120px]"
                  rows={6}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!author || !companyName || !review || isAdding || isUpdating}
                >
                  {(isAdding || isUpdating)
                    ? (editingId ? "Updating..." : "Adding...")
                    : (editingId ? "Update Testimonial" : "Add Testimonial")
                  }
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading testimonials...</div>
          ) : testimonials.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={MessageSquareQuote}
                title="No testimonials"
                description="Add customer testimonials to showcase on your website"
              />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Author</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead className="">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testimonials.map((testimonial) => (
                    <TableRow key={testimonial.id}>
                      <TableCell className="font-medium">
                        {testimonial.author}
                      </TableCell>
                      <TableCell>
                        {testimonial.company_name}
                      </TableCell>
                      <TableCell>
                        {renderStars(testimonial.stars)}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {testimonial.review}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-0 hover:bg-transparent hover:text-primary"
                            onClick={() => handleOpenDialog(testimonial)}
                            disabled={isDeleting}
                          >
                            <Edit className="h-4 w-4"  />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-0 hover:bg-transparent hover:text-destructive"
                            onClick={() => setDeletingId(testimonial.id)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Testimonial
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this testimonial? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

TestimonialsManager.displayName = "TestimonialsManager";
