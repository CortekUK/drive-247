import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, Upload, RotateCcw, Car, X, GripVertical, Star } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

interface VehiclePhoto {
  id: string;
  vehicle_id: string;
  photo_url: string;
  display_order: number;
  created_at: string;
}

interface VehiclePhotoGalleryProps {
  vehicleId: string;
  vehicleReg: string;
  fallbackPhotoUrl?: string;
}

interface SortablePhotoProps {
  photo: VehiclePhoto;
  index: number;
  vehicleReg: string;
  onDelete: (photo: VehiclePhoto) => void;
  isDeleting: boolean;
}

const SortablePhoto = ({ photo, index, vehicleReg, onDelete, isDeleting }: SortablePhotoProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative aspect-[4/3] bg-muted/30 rounded-lg border-2 overflow-hidden group",
        isDragging
          ? "border-primary shadow-lg z-50 opacity-90"
          : "border-muted-foreground/20",
        index === 0 && "ring-2 ring-primary ring-offset-2"
      )}
    >
      <img
        src={photo.photo_url}
        alt={`${vehicleReg} - Photo ${index + 1}`}
        className="w-full h-full object-cover"
        onError={(e) => {
          console.error("Image load error:", e);
          e.currentTarget.style.display = "none";
        }}
      />

      {/* Banner badge for first image */}
      {index === 0 && (
        <Badge
          className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5"
        >
          <Star className="h-2.5 w-2.5 mr-0.5 fill-current" />
          Banner
        </Badge>
      )}

      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute bottom-1 left-1 p-1 bg-black/50 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 text-white" />
      </div>

      {/* Delete button */}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onDelete(photo)}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <RotateCcw className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
};

export const VehiclePhotoGallery = ({
  vehicleId,
  vehicleReg,
  fallbackPhotoUrl,
}: VehiclePhotoGalleryProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch vehicle photos
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["vehicle-photos", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_photos")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return data as VehiclePhoto[];
    },
  });

  // Reorder photos mutation
  const reorderPhotosMutation = useMutation({
    mutationFn: async (reorderedPhotos: VehiclePhoto[]) => {
      // Update display_order for each photo
      const updates = reorderedPhotos.map((photo, index) => ({
        id: photo.id,
        display_order: index,
      }));

      // Batch update all photos
      for (const update of updates) {
        const { error } = await supabase
          .from("vehicle_photos")
          .update({ display_order: update.display_order })
          .eq("id", update.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-photos", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast({
        title: "Photos Reordered",
        description: "The first photo will be used as the banner image.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reorder photos.",
        variant: "destructive",
      });
      // Refetch to reset order
      queryClient.invalidateQueries({ queryKey: ["vehicle-photos", vehicleId] });
    },
  });

  // Delete photo mutation
  const deletePhotoMutation = useMutation({
    mutationFn: async (photo: VehiclePhoto) => {
      // Extract filename from URL
      const urlParts = photo.photo_url.split("/");
      const fileName = urlParts[urlParts.length - 1];

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("vehicle-photos")
        .remove([fileName]);

      if (storageError) throw storageError;

      // Delete from database
      let deleteQuery = supabase
        .from("vehicle_photos")
        .delete()
        .eq("id", photo.id);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
      }

      const { error: dbError } = await deleteQuery;

      if (dbError) throw dbError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-photos", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast({
        title: "Photo Deleted",
        description: "Vehicle photo has been removed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete photo. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = photos.findIndex((photo) => photo.id === active.id);
      const newIndex = photos.findIndex((photo) => photo.id === over.id);

      const reorderedPhotos = arrayMove(photos, oldIndex, newIndex);

      // Optimistically update the UI
      queryClient.setQueryData(["vehicle-photos", vehicleId], reorderedPhotos);

      // Save to database
      reorderPhotosMutation.mutate(reorderedPhotos);
    }
  };

  // Upload photos
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadingCount(files.length);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid File Type",
          description: `${file.name} is not an image file.`,
          variant: "destructive",
        });
        failCount++;
        continue;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: `${file.name} is larger than 5MB.`,
          variant: "destructive",
        });
        failCount++;
        continue;
      }

      try {
        const fileExt = file.name.split(".").pop();
        const fileName = `${vehicleId}-${Date.now()}-${i}.${fileExt}`;
        const filePath = `${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("vehicle-photos")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from("vehicle-photos").getPublicUrl(filePath);

        // Get current max display order
        const currentMaxOrder = photos.length > 0
          ? Math.max(...photos.map(p => p.display_order))
          : -1;

        // Insert into database
        const { error: dbError } = await supabase
          .from("vehicle_photos")
          .insert({
            vehicle_id: vehicleId,
            photo_url: publicUrl,
            display_order: currentMaxOrder + i + 1,
            tenant_id: tenant?.id,
          });

        if (dbError) {
          // If DB insert fails, clean up uploaded file
          await supabase.storage.from("vehicle-photos").remove([filePath]);
          throw dbError;
        }

        successCount++;
      } catch (error: any) {
        console.error(`Error uploading ${file.name}:`, error);
        failCount++;
      }
    }

    setUploadingCount(0);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    // Refresh photos
    queryClient.invalidateQueries({ queryKey: ["vehicle-photos", vehicleId] });
    queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });

    // Show result toast
    if (successCount > 0 && failCount === 0) {
      toast({
        title: "Photos Uploaded",
        description: `Successfully uploaded ${successCount} photo${successCount > 1 ? "s" : ""}.`,
      });
    } else if (successCount > 0 && failCount > 0) {
      toast({
        title: "Partial Upload",
        description: `Uploaded ${successCount} photo${successCount > 1 ? "s" : ""}, ${failCount} failed.`,
        variant: "default",
      });
    } else if (failCount > 0) {
      toast({
        title: "Upload Failed",
        description: "Failed to upload photos. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDeletePhoto = (photo: VehiclePhoto) => {
    deletePhotoMutation.mutate(photo);
  };

  const isDeleting = deletePhotoMutation.isPending;
  const isUploading = uploadingCount > 0;
  const isReordering = reorderPhotosMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Camera className="h-4 w-4 text-primary" />
          Vehicle Photos ({photos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Photo Gallery with Drag and Drop */}
        {photos.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={photos.map(p => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {photos.map((photo, index) => (
                  <SortablePhoto
                    key={photo.id}
                    photo={photo}
                    index={index}
                    vehicleReg={vehicleReg}
                    onDelete={handleDeletePhoto}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : fallbackPhotoUrl ? (
          <div className="flex justify-center">
            <div className="relative w-64 h-48 bg-muted/30 rounded-lg border-2 border-muted-foreground/20 overflow-hidden">
              <img
                src={fallbackPhotoUrl}
                alt={`${vehicleReg}`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  console.error("Fallback image load error:", e);
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="relative w-64 h-48 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20 overflow-hidden">
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Car className="h-12 w-12 mb-2 opacity-30" />
                <p className="text-xs font-medium">No photos uploaded</p>
                <p className="text-xs opacity-75">Upload photos of {vehicleReg}</p>
              </div>
            </div>
          </div>
        )}

        {/* Drag hint */}
        {photos.length > 1 && (
          <p className="text-xs text-muted-foreground text-center">
            <GripVertical className="h-3 w-3 inline-block mr-1" />
            Drag photos to reorder. First photo is used as the banner.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex justify-center gap-1.5">
          <Button
            size="sm"
            onClick={handleUploadClick}
            disabled={isUploading || isDeleting || isReordering}
            className="flex items-center gap-1.5 text-xs"
          >
            {isUploading ? (
              <RotateCcw className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {photos.length > 0 ? "Add More" : "Upload Photos"}
          </Button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Upload instructions */}
        <div className="text-xs text-muted-foreground/75 text-center">
          <p>JPG, PNG, WebP • Max 5MB per photo • Multiple selection supported</p>
        </div>
      </CardContent>
    </Card>
  );
};
