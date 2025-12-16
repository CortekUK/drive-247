import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface GalleryImage {
  url: string;
  caption?: string;
  alt: string;
}

interface PortfolioGalleryProps {
  images: GalleryImage[];
}

export const PortfolioGallery = ({ images }: PortfolioGalleryProps) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const openLightbox = (index: number) => {
    setCurrentIndex(index);
    setLightboxOpen(true);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") goToPrevious();
    if (e.key === "ArrowRight") goToNext();
    if (e.key === "Escape") setLightboxOpen(false);
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {images.map((image, index) => (
          <button
            key={index}
            onClick={() => openLightbox(index)}
            className="relative aspect-[16/9] overflow-hidden gallery-item group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`View image ${index + 1}: ${image.alt}`}
          >
            <img
              src={image.url}
              alt={image.alt}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
            {image.caption && (
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <p className="text-white text-sm">{image.caption}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          className="max-w-7xl w-full h-[90vh] p-0 bg-black/95 backdrop-blur-xl"
          onKeyDown={handleKeyDown}
        >
          <div className="relative w-full h-full flex items-center justify-center p-4">
            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 z-10 bg-black/50 hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close gallery"
            >
              <X className="w-4 h-4" />
            </Button>

            {/* Previous Button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
              onClick={goToPrevious}
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>

            {/* Image */}
            <div className="max-w-full max-h-full flex flex-col items-center gap-4">
              <img
                src={images[currentIndex].url}
                alt={images[currentIndex].alt}
                className="max-w-full max-h-[calc(90vh-8rem)] object-contain"
              />
              {images[currentIndex].caption && (
                <p className="text-sm text-muted-foreground text-center max-w-2xl">
                  {images[currentIndex].caption}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {currentIndex + 1} / {images.length}
              </p>
            </div>

            {/* Next Button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
              onClick={goToNext}
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
