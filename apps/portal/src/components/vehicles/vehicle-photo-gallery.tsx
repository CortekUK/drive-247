import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Trash2, RotateCcw, Car, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
}

export const VehiclePhotoGallery = ({
  vehicleId,
  vehicleReg,
}: VehiclePhotoGalleryProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      const { error: dbError } = await supabase
        .from("vehicle_photos")
        .delete()
        .eq("id", photo.id);

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Camera className="h-4 w-4 text-primary" />
          Vehicle Photos ({photos.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Photo Gallery */}
        {photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-[4/3] bg-muted/30 rounded-lg border-2 border-muted-foreground/20 overflow-hidden group"
              >
                <img
                  src={photo.photo_url}
                  alt={`${vehicleReg} - Photo ${photo.display_order + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error("Image load error:", e);
                    e.currentTarget.style.display = "none";
                  }}
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDeletePhoto(photo)}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <RotateCcw className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ))}
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

        {/* Action Buttons */}
        <div className="flex justify-center gap-1.5">
          <Button
            size="sm"
            onClick={handleUploadClick}
            disabled={isUploading || isDeleting}
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
