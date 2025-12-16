import React from 'react';
import { FileSearch, Filter, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
    <Card className="w-full">
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="relative mb-6">
          {/* Background Circle */}
          <div className="w-24 h-24 bg-muted/30 rounded-full flex items-center justify-center">
            <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center">
              <FileSearch className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
          
          {/* Floating Icons */}
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-background border border-border rounded-full flex items-center justify-center shadow-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="absolute -bottom-2 -left-2 w-8 h-8 bg-background border border-border rounded-full flex items-center justify-center shadow-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {title}
        </h3>
        
        <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
          {description}
        </p>
        
        {showClearFilters && onClearFilters && (
          <Button 
            variant="outline" 
            onClick={onClearFilters}
            className="text-sm"
          >
            <Filter className="h-4 w-4 mr-2" />
            Clear All Filters
          </Button>
        )}
      </CardContent>
    </Card>
  );
};