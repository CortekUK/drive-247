import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TruncatedCellProps {
  content: string | null;
  maxLength?: number;
  className?: string;
}

export function TruncatedCell({ content, maxLength = 30, className }: TruncatedCellProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!content) return <span className="text-muted-foreground">-</span>;

  const needsTruncation = content.length > maxLength;
  const displayContent = needsTruncation
    ? `${content.substring(0, maxLength)}...`
    : content;

  if (!needsTruncation) {
    return <span className={className}>{content}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className="cursor-pointer underline decoration-dotted"
        >
          {displayContent}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="whitespace-pre-wrap">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}