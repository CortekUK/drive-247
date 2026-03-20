"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface BlurredImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  label?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function BlurredImage({
  src,
  alt,
  className,
  containerClassName,
  label,
  onError,
}: BlurredImageProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className={cn("relative cursor-pointer select-none", containerClassName)}
      onClick={() => setRevealed((prev) => !prev)}
      title={revealed ? "Click to blur" : "Click to reveal"}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full h-full object-cover transition-all duration-300",
          !revealed && "blur-lg scale-105",
          className
        )}
        onError={onError}
      />
      {!revealed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 rounded-[inherit]">
          <Eye className="h-5 w-5 text-white drop-shadow-md" />
          {label && (
            <span className="text-[10px] text-white mt-1 font-medium drop-shadow-md">
              Click to reveal
            </span>
          )}
        </div>
      )}
      {revealed && (
        <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/40 text-white opacity-0 hover:opacity-100 transition-opacity">
          <EyeOff className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
