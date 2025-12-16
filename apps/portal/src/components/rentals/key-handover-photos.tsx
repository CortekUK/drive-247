import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Trash2, X, ZoomIn, RotateCcw } from "lucide-react";
import { HandoverPhoto } from "@/hooks/use-key-handover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyHandoverPhotosProps {
  photos: HandoverPhoto[];
  onUpload: (file: File) => void;
  onDelete: (photo: HandoverPhoto) => void;
  isUploading: boolean;
  isDeleting: boolean;
  disabled?: boolean;
  maxPhotos?: number;
}

export const KeyHandoverPhotos = ({
  photos,
  onUpload,
  onDelete,
  isUploading,
  isDeleting,
  disabled = false,
  maxPhotos = 10,
}: KeyHandoverPhotosProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<HandoverPhoto | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<HandoverPhoto | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    // Upload each file
    Array.from(files).forEach((file) => {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        return;
      }
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        return;
      }
      onUpload(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const canUpload = !disabled && photos.length < maxPhotos;

  return (
    <div className="space-y-3">
      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative group aspect-[4/3] rounded-lg overflow-hidden border bg-muted/20"
          >
            <img
              src={photo.file_url}
              alt={photo.file_name}
              className="w-full h-full object-cover cursor-pointer transition-transform group-hover:scale-105"
              onClick={() => setSelectedPhoto(photo)}
            />
            {/* Overlay with actions */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8"
                onClick={() => setSelectedPhoto(photo)}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              {!disabled && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-8 w-8"
                  onClick={() => setDeleteConfirm(photo)}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}

        {/* Upload Button */}
        {canUpload && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="aspect-[4/3] rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <RotateCcw className="h-8 w-8 animate-spin" />
                <span className="text-xs">Uploading...</span>
              </>
            ) : (
              <>
                <Camera className="h-8 w-8" />
                <span className="text-xs">Add Photo</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Empty state */}
      {photos.length === 0 && !canUpload && (
        <div className="text-center py-8 text-muted-foreground">
          <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No photos uploaded</p>
        </div>
      )}

      {/* Upload instructions */}
      {canUpload && (
        <p className="text-xs text-muted-foreground text-center">
          Upload up to {maxPhotos} photos • JPG, PNG, WebP • Max 10MB each
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Photo Preview Dialog */}
      <Dialog open={!!selectedPhoto} onOpenChange={() => setSelectedPhoto(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedPhoto?.file_name}</DialogTitle>
          </DialogHeader>
          {selectedPhoto && (
            <div className="relative">
              <img
                src={selectedPhoto.file_url}
                alt={selectedPhoto.file_name}
                className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Uploaded: {new Date(selectedPhoto.uploaded_at).toLocaleString()}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Photo?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            Are you sure you want to delete this photo? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm) {
                  onDelete(deleteConfirm);
                  setDeleteConfirm(null);
                }
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
