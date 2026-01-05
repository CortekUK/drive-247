import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";

interface RentalsFiltersProps {
  filters: RentalFilters;
  onFiltersChange: (filters: RentalFilters) => void;
  onClearFilters: () => void;
}

export const RentalsFilters = ({ filters, onFiltersChange, onClearFilters }: RentalsFiltersProps) => {
  const router = useRouter();
  const [localSearch, setLocalSearch] = useState(filters.search || "");

  // Sync local state when filters are cleared externally
  useEffect(() => {
    setLocalSearch(filters.search || "");
  }, [filters.search]);

  // Debounce search filter updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== (filters.search || "")) {
        onFiltersChange({ ...filters, search: localSearch, page: 1 });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  const updateFilter = (key: keyof RentalFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value, page: 1 });
  };

  const hasActiveFilters = Object.values(filters).some(value => 
    value && value !== "all" && value !== "" && value !== 1
  );

  return (
    <div className="space-y-4">
      {/* Search and filters in one row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by customer, vehicle reg, or rental #..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={filters.status || "all"} onValueChange={(value) => updateFilter("status", value)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.customerType || "all"} onValueChange={(value) => updateFilter("customerType", value)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Individual">Individual</SelectItem>
            <SelectItem value="Company">Company</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters} className="gap-1">
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}

        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateFilter("status", "pending")}
            className={filters.status === "pending" ? "bg-accent" : ""}
          >
            <Clock className="h-4 w-4 mr-1" />
            Pending Approvals
          </Button>
          <Button
            size="sm"
            onClick={() => router.push("/rentals/new")}
            className="bg-gradient-primary"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Booking
          </Button>
        </div>
      </div>
    </div>
  );
};