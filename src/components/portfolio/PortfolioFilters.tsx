import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface PortfolioFiltersProps {
  onFilter: (filters: {
    serviceType: string;
    vehicle: string;
    location: string;
    year: string;
    search: string;
  }) => void;
  items: Array<{
    service_type: string;
    vehicle_used: string;
    location: string;
    event_date: string;
  }>;
}

export const PortfolioFilters = ({ onFilter, items }: PortfolioFiltersProps) => {
  const [serviceType, setServiceType] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [location, setLocation] = useState("all");
  const [year, setYear] = useState("all");
  const [search, setSearch] = useState("");

  const uniqueYears = useMemo(() => {
    const years = items.map((item) => new Date(item.event_date).getFullYear());
    return [...new Set(years)].sort((a, b) => b - a);
  }, [items]);

  const uniqueVehicles = useMemo(() => {
    const vehicles = items
      .map((item) => item.vehicle_used)
      .filter((v) => v && v.trim() !== "");
    return [...new Set(vehicles)].sort();
  }, [items]);

  const uniqueLocations = useMemo(() => {
    const locations = items
      .map((item) => item.location)
      .filter((l) => l && l.trim() !== "");
    return [...new Set(locations)].sort();
  }, [items]);

  const handleFilterChange = (updates: {
    serviceType?: string;
    vehicle?: string;
    location?: string;
    year?: string;
    search?: string;
  }) => {
    const newFilters = {
      serviceType: updates.serviceType !== undefined ? updates.serviceType : serviceType,
      vehicle: updates.vehicle !== undefined ? updates.vehicle : vehicle,
      location: updates.location !== undefined ? updates.location : location,
      year: updates.year !== undefined ? updates.year : year,
      search: updates.search !== undefined ? updates.search : search,
    };

    if (updates.serviceType !== undefined) setServiceType(updates.serviceType);
    if (updates.vehicle !== undefined) setVehicle(updates.vehicle);
    if (updates.location !== undefined) setLocation(updates.location);
    if (updates.year !== undefined) setYear(updates.year);
    if (updates.search !== undefined) setSearch(updates.search);

    onFilter(newFilters);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Service Type */}
        <Select value={serviceType} onValueChange={(value) => handleFilterChange({ serviceType: value })}>
          <SelectTrigger className="bg-card border-border/50">
            <SelectValue placeholder="Service Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            <SelectItem value="chauffeur">Chauffeur</SelectItem>
            <SelectItem value="close_protection">Close Protection</SelectItem>
            <SelectItem value="both">Both Services</SelectItem>
          </SelectContent>
        </Select>

        {/* Vehicle */}
        <Select value={vehicle} onValueChange={(value) => handleFilterChange({ vehicle: value })}>
          <SelectTrigger className="bg-card border-border/50">
            <SelectValue placeholder="Vehicle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vehicles</SelectItem>
            {uniqueVehicles.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Location */}
        <Select value={location} onValueChange={(value) => handleFilterChange({ location: value })}>
          <SelectTrigger className="bg-card border-border/50">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {uniqueLocations.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Year */}
        <Select value={year} onValueChange={(value) => handleFilterChange({ year: value })}>
          <SelectTrigger className="bg-card border-border/50">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {uniqueYears.map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => handleFilterChange({ search: e.target.value })}
            className="pl-10 bg-card border-border/50"
          />
        </div>
      </div>
    </div>
  );
};
