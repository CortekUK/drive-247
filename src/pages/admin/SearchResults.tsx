import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Users,
  Car,
  MessageSquare,
  Image,
  Search,
  ExternalLink,
  Calendar,
  Mail,
  Phone,
  MapPin
} from "lucide-react";

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [results, setResults] = useState<any>({
    bookings: [],
    drivers: [],
    vehicles: [],
    testimonials: [],
    portfolio: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (query) {
      performSearch(query);
    }
  }, [query]);

  const performSearch = async (searchQuery: string) => {
    setLoading(true);
    try {
      const searchTerm = `%${searchQuery.toLowerCase()}%`;

      // Search Bookings
      const { data: bookings } = await supabase
        .from("bookings")
        .select("*, vehicles(name)")
        .or(`customer_name.ilike.${searchTerm},customer_email.ilike.${searchTerm},customer_phone.ilike.${searchTerm},pickup_location.ilike.${searchTerm},dropoff_location.ilike.${searchTerm}`)
        .order("created_at", { ascending: false })
        .limit(10);

      // Search Drivers
      const { data: drivers } = await supabase
        .from("drivers")
        .select("*")
        .or(`name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm},license_number.ilike.${searchTerm}`)
        .limit(10);

      // Search Vehicles
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("*")
        .or(`name.ilike.${searchTerm},category.ilike.${searchTerm},registration.ilike.${searchTerm}`)
        .limit(10);

      // Search Testimonials
      const { data: testimonials } = await supabase
        .from("testimonials")
        .select("*")
        .or(`client_name.ilike.${searchTerm},content.ilike.${searchTerm}`)
        .limit(10);

      // Search Portfolio
      const { data: portfolio } = await supabase
        .from("portfolio")
        .select("*")
        .or(`title.ilike.${searchTerm},description.ilike.${searchTerm},location.ilike.${searchTerm}`)
        .limit(10);

      setResults({
        bookings: bookings || [],
        drivers: drivers || [],
        vehicles: vehicles || [],
        testimonials: testimonials || [],
        portfolio: portfolio || []
      });
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalResults =
    results.bookings.length +
    results.drivers.length +
    results.vehicles.length +
    results.testimonials.length +
    results.portfolio.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Searching...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Search Results</h1>
        <p className="text-muted-foreground">
          Found <span className="font-semibold text-foreground">{totalResults}</span> results for "{query}"
        </p>
      </div>

      {totalResults === 0 && (
        <Card className="p-12 text-center">
          <Search className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No results found</h3>
          <p className="text-muted-foreground">Try different keywords or check your spelling</p>
        </Card>
      )}

      {/* Bookings Results */}
      {results.bookings.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-amber-500" />
            <h2 className="text-xl font-semibold">Bookings ({results.bookings.length})</h2>
          </div>
          <div className="grid gap-4">
            {results.bookings.map((booking: any) => (
              <Card key={booking.id} className="p-4 hover:border-amber-500/50 transition-colors">
                <Link to={`/admin/jobs/${booking.id}`} className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{booking.customer_name}</h3>
                        <Badge variant={booking.status === 'confirmed' ? 'default' : 'secondary'}>
                          {booking.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {booking.pickup_location}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {booking.pickup_date}
                        </div>
                        <div className="flex items-center gap-1">
                          <Mail className="w-4 h-4" />
                          {booking.customer_email}
                        </div>
                        <div className="flex items-center gap-1">
                          <Phone className="w-4 h-4" />
                          {booking.customer_phone}
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Drivers Results */}
      {results.drivers.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            <h2 className="text-xl font-semibold">Drivers ({results.drivers.length})</h2>
          </div>
          <div className="grid gap-4">
            {results.drivers.map((driver: any) => (
              <Card key={driver.id} className="p-4 hover:border-blue-500/50 transition-colors">
                <Link to="/admin/drivers" className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{driver.name}</h3>
                        <Badge variant={driver.is_active ? 'default' : 'secondary'}>
                          {driver.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Mail className="w-4 h-4" />
                          {driver.email}
                        </div>
                        <div className="flex items-center gap-1">
                          <Phone className="w-4 h-4" />
                          {driver.phone}
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Vehicles Results */}
      {results.vehicles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Car className="w-5 h-5 text-green-500" />
            <h2 className="text-xl font-semibold">Vehicles ({results.vehicles.length})</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {results.vehicles.map((vehicle: any) => (
              <Card key={vehicle.id} className="p-4 hover:border-green-500/50 transition-colors">
                <Link to="/admin/vehicles" className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{vehicle.name}</h3>
                        <Badge variant={vehicle.is_active ? 'default' : 'secondary'}>
                          {vehicle.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{vehicle.category}</p>
                      {vehicle.registration && (
                        <p className="text-xs text-muted-foreground">Reg: {vehicle.registration}</p>
                      )}
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Testimonials Results */}
      {results.testimonials.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-500" />
            <h2 className="text-xl font-semibold">Testimonials ({results.testimonials.length})</h2>
          </div>
          <div className="grid gap-4">
            {results.testimonials.map((testimonial: any) => (
              <Card key={testimonial.id} className="p-4 hover:border-purple-500/50 transition-colors">
                <Link to="/admin/testimonials" className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <h3 className="font-semibold">{testimonial.client_name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{testimonial.content}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio Results */}
      {results.portfolio.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-orange-500" />
            <h2 className="text-xl font-semibold">Portfolio ({results.portfolio.length})</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {results.portfolio.map((item: any) => (
              <Card key={item.id} className="p-4 hover:border-orange-500/50 transition-colors">
                <Link to={`/admin/portfolio/edit/${item.id}`} className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                      {item.location && (
                        <p className="text-xs text-muted-foreground">📍 {item.location}</p>
                      )}
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchResults;
