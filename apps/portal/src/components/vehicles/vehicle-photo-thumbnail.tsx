import { cn } from "@/lib/utils";

interface VehiclePhotoThumbnailProps {
  photoUrl?: string;
  vehicleReg: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

function CarSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Car body */}
      <path
        d="M8 28h48c1.1 0 2-.9 2-2v-6c0-1.1-.5-2.1-1.3-2.7L50 12l-6-6c-.8-.8-1.8-1.2-2.8-1.2H22.8c-1 0-2 .4-2.8 1.2l-6 6-6.7 5.3C7.5 17.9 7 18.9 7 20v6c0 1.1.9 2 2 2h-1z"
        fill="currentColor"
        opacity="0.15"
      />
      {/* Car outline */}
      <path
        d="M10 28h44c1.7 0 3-1.3 3-3v-5c0-1.3-.6-2.5-1.6-3.3L50 12.5 44.5 7c-1-.9-2.2-1.5-3.5-1.5H23c-1.3 0-2.5.5-3.5 1.5L14 12.5l-5.4 4.2C7.6 17.5 7 18.7 7 20v5c0 1.7 1.3 3 3 3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      {/* Windshield */}
      <path
        d="M20 12l-4.5 5H17c1 0 1.8-.4 2.4-1L24 12h-4z"
        fill="currentColor"
        opacity="0.1"
      />
      <path
        d="M44 12l4.5 5H47c-1 0-1.8-.4-2.4-1L40 12h4z"
        fill="currentColor"
        opacity="0.1"
      />
      {/* Window line */}
      <path
        d="M15.5 17h33"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.2"
      />
      {/* Front wheel */}
      <circle cx="18" cy="28" r="5" fill="currentColor" opacity="0.12" />
      <circle cx="18" cy="28" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <circle cx="18" cy="28" r="2" fill="currentColor" opacity="0.2" />
      {/* Rear wheel */}
      <circle cx="46" cy="28" r="5" fill="currentColor" opacity="0.12" />
      <circle cx="46" cy="28" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <circle cx="46" cy="28" r="2" fill="currentColor" opacity="0.2" />
      {/* Headlight */}
      <rect x="53" y="19" width="3" height="2" rx="1" fill="currentColor" opacity="0.25" />
      {/* Taillight */}
      <rect x="8" y="19" width="3" height="2" rx="1" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

export const VehiclePhotoThumbnail = ({
  photoUrl,
  vehicleReg,
  size = "sm",
  className,
  onClick,
}: VehiclePhotoThumbnailProps) => {
  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const svgSizes = {
    sm: "w-10 h-6",
    md: "w-12 h-8",
    lg: "w-16 h-10",
  };

  const textSizes = {
    sm: "text-[8px]",
    md: "text-[9px]",
    lg: "text-[10px]",
  };

  // Extract first letters of reg for subtle watermark
  const regInitials = vehicleReg.replace(/\s/g, "").slice(0, 3).toUpperCase();

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden flex items-center justify-center",
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
            // Hide the broken image, let the fallback show through
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = "flex";
          }}
        />
      ) : null}

      {/* Placeholder — shown when no photo or image fails to load */}
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          "bg-gradient-to-br from-muted/60 via-muted/40 to-muted/60",
          "border border-muted-foreground/10"
        )}
        style={{ display: photoUrl ? "none" : "flex" }}
      >
        {/* Reg initials watermark */}
        <span
          className={cn(
            "absolute font-black tracking-widest text-muted-foreground/[0.07] select-none",
            size === "lg" ? "text-2xl" : size === "md" ? "text-xl" : "text-lg"
          )}
        >
          {regInitials}
        </span>
        {/* Car silhouette */}
        <CarSilhouette className={cn("text-muted-foreground relative z-10", svgSizes[size])} />
        {/* Reg label */}
        <span
          className={cn(
            "font-semibold tracking-wider text-muted-foreground/40 relative z-10 -mt-0.5",
            textSizes[size]
          )}
        >
          {regInitials}
        </span>
      </div>
    </div>
  );
};
