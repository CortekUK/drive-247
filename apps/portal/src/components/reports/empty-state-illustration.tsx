import React from 'react';
import { FileSearch, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/bento';

interface EmptyStateIllustrationProps {
  title?: string;
  description?: string;
  onClearFilters?: () => void;
  showClearFilters?: boolean;
}

export const EmptyStateIllustration: React.FC<EmptyStateIllustrationProps> = ({
  title = "No results found",
  description = "No data matches your selected filters. Try adjusting your criteria or clearing filters to see all available data.",
  onClearFilters,
  showClearFilters = true
}) => {
  return (
    <EmptyState
      icon={<FileSearch className="h-5 w-5" />}
      title={title}
      description={description}
      action={
        showClearFilters && onClearFilters ? (
          <Button variant="outline" onClick={onClearFilters} className="gap-2">
            <Filter className="h-4 w-4" />
            Clear All Filters
          </Button>
        ) : undefined
      }
    />
  );
};
