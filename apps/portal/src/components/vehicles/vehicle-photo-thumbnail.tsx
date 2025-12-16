import { Car } from "lucide-react";
import { cn } from "@/lib/utils";

interface VehiclePhotoThumbnailProps {
  photoUrl?: string;
  vehicleReg: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

export const VehiclePhotoThumbnail = ({ 
  photoUrl, 
  vehicleReg, 
  size = "sm",
  className,
  onClick 
}: VehiclePhotoThumbnailProps) => {
  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16", 
    lg: "w-20 h-20"
  };

  const iconSizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10"
  };

  return (
    <div 
      className={cn(
        "relative rounded-md border-2 border-muted-foreground/20 overflow-hidden bg-muted/30 flex items-center justify-center",
        sizeClasses[size],
        onClick && "cursor-pointer hover:border-primary/50 transition-colors",
        className
      )}
      onClick={onClick}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={`Photo of ${vehicleReg}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            console.error('Thumbnail image load error:', e);
            // Hide the image and show placeholder
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <Car className={cn("text-muted-foreground/50", iconSizes[size])} />
      )}
      
      {/* Fallback placeholder that shows if image fails to load */}
      {photoUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30" style={{ display: 'none' }}>
          <Car className={cn("text-muted-foreground/50", iconSizes[size])} />
        </div>
      )}
    </div>
  );
};