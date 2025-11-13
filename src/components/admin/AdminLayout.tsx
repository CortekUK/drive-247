import { ReactNode, useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Users,
  Car,
  Settings,
  LogOut,
  Search,
  Home,
  BarChart2,
  Tag,
  RefreshCw,
  CalendarX,
  Wrench,
  Star,
  MessageCircle,
  CalendarCheck,
  Gift,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import BlockedDatesModal from "./BlockedDatesModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import NotificationBell from "./NotificationBell";

interface AdminLayoutProps {
  children: ReactNode;
  user: any;
}

interface NavItem {
  label: string;
  icon: any;
  href: string;
  badge?: number;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: Home, href: "/admin" },
      { label: "Rentals", icon: CalendarCheck, href: "/admin/rentals" },
      { label: "Clients", icon: Users, href: "/admin/clients" },
    ],
  },
  {
    title: "FLEET & OPERATIONS",
    items: [
      { label: "Vehicles", icon: Car, href: "/admin/vehicles" },
      { label: "Fleet Maintenance", icon: Wrench, href: "/admin/maintenance" },
      { label: "Pricing", icon: Tag, href: "/admin/pricing" },
      { label: "Promotions & Offers", icon: Gift, href: "/admin/promotions" },
      { label: "Analytics & Reports", icon: BarChart2, href: "/admin/analytics" },
    ],
  },
  {
    title: "CUSTOMER & SYSTEM",
    items: [
      { label: "Customer Reviews", icon: Star, href: "/admin/reviews" },
      { label: "Feedback", icon: MessageCircle, href: "/admin/feedback" },
      { label: "Settings", icon: Settings, href: "/admin/settings" },
    ],
  },
];

function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { open } = useSidebar();
  const [jobsCount, setJobsCount] = useState(0);

  useEffect(() => {
    loadJobsCount();
  }, []);

  const loadJobsCount = async () => {
    // Count all rentals to match the Rentals page total
    const { count } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true });
    setJobsCount(count || 0);
  };

  const isActive = (url: string) => {
    if (url === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(url);
  };

  const getNavSections = (): NavSection[] => {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.href === "/admin/rentals") {
          return { ...item, badge: jobsCount };
        }
        return item;
      }),
    }));
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    const button = (
      <SidebarMenuButton
        onClick={() => navigate(item.href)}
        className={`
          relative h-11 px-3
          ${active 
            ? "bg-amber-500/10 text-amber-400 border-l-[3px] border-amber-500 font-medium" 
            : "text-gray-300 hover:text-white hover:bg-white/5"
          }
          transition-all duration-200 cursor-pointer
        `}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="h-5 w-5" />
        {open && (
          <>
            <span className="ml-3 text-[13px]">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <Badge 
                className="ml-auto h-5 min-w-[20px] px-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-xs font-medium"
              >
                {item.badge}
              </Badge>
            )}
          </>
        )}
      </SidebarMenuButton>
    );

    if (!open) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              {button}
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              {item.label}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">({item.badge})</span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  };

  return (
    <Sidebar 
      className={open ? "w-[260px]" : "w-[72px]"} 
      collapsible="icon"
      style={{ backgroundColor: "#0F1115" }}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 py-6">
            <h2 className="text-xl font-display font-bold text-gray-100">
              {open ? "Admin Portal" : "AP"}
            </h2>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Admin navigation">
              {getNavSections().map((section, sectionIndex) => (
                <div key={section.title} className={sectionIndex > 0 ? "mt-6" : ""}>
                  {open && (
                    <div className="px-4 mb-2">
                      <span className="text-[10px] font-semibold tracking-wider text-amber-500/70 uppercase">
                        {section.title}
                      </span>
                    </div>
                  )}
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        {renderNavItem(item)}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </div>
              ))}
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function AdminLayout({ children, user }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>({
    bookings: [],
    drivers: [],
    vehicles: [],
  });
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showBlockedDatesModal, setShowBlockedDatesModal] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Persist sidebar state
  useEffect(() => {
    const savedState = localStorage.getItem("admin-sidebar-collapsed");
    if (savedState !== null) {
      // State is managed by SidebarProvider
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const performSearch = async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults({ bookings: [], drivers: [], vehicles: [] });
        setShowSearchResults(false);
        return;
      }

      setSearchLoading(true);
      setShowSearchResults(true);

      try {
        const searchTerm = `%${searchQuery.toLowerCase()}%`;

        // Search Bookings (limit 5)
        const { data: bookings } = await supabase
          .from("bookings")
          .select("id, customer_name, customer_email, pickup_location, pickup_date, status")
          .or(`customer_name.ilike.${searchTerm},customer_email.ilike.${searchTerm},pickup_location.ilike.${searchTerm}`)
          .order("created_at", { ascending: false })
          .limit(5);

        // Search Drivers (limit 5)
        const { data: drivers } = await supabase
          .from("drivers")
          .select("id, name, email, phone")
          .or(`name.ilike.${searchTerm},email.ilike.${searchTerm}`)
          .limit(5);

        // Search Vehicles (limit 5) - search both active and inactive
        const { data: vehicles, error: vehiclesError } = await supabase
          .from("vehicles")
          .select("id, name, category, is_active")
          .or(`name.ilike.${searchTerm},category.ilike.${searchTerm}`)
          .limit(5);

        if (vehiclesError) {
          console.error("Vehicles search error:", vehiclesError);
        }

        setSearchResults({
          bookings: bookings || [],
          drivers: drivers || [],
          vehicles: vehicles || [],
        });
      } catch (error) {
        console.error("Search error:", error);
      } finally {
        setSearchLoading(false);
      }
    };

    const debounceTimer = setTimeout(performSearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  const handleLogout = async () => {
    try {
      // Sign out and clear all sessions
      await supabase.auth.signOut({ scope: 'global' });

      // Clear any cached data
      localStorage.clear();
      sessionStorage.clear();

      toast.success("Logged out successfully");

      // Force navigation to home page
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Error logging out");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/admin/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchQuery("");
    }
  };

  const handleClearCache = () => {
    // Save important data before clearing
    const keysToPreserve = Object.keys(localStorage).filter(key =>
      key.startsWith('sb-') ||
      key.includes('supabase') ||
      key.includes('cookie') ||
      key.includes('consent') ||
      key === 'admin-sidebar-collapsed'
    );
    const preservedData: Record<string, string> = {};
    keysToPreserve.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) preservedData[key] = value;
    });

    // Clear storage
    localStorage.clear();
    sessionStorage.clear();

    // Restore preserved data
    Object.entries(preservedData).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    toast.success("Cache cleared! Reloading...");
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="h-screen flex w-full bg-background overflow-hidden">
        <AdminSidebar />

        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Top Bar */}
          <header className="z-40 border-b border-white/10 bg-[hsl(165,20%,17%)] flex-shrink-0">
            <div className="flex h-16 items-center gap-4 px-6">
              <SidebarTrigger className="text-gray-300 hover:text-white" />
              
              <div ref={searchRef} className="flex-1 max-w-md relative">
                <form onSubmit={handleSearch}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="search"
                      placeholder="Search rentals, clients, vehicles..."
                      className="pl-10 pr-4 bg-white/10 text-white placeholder:text-gray-400 border-white/20"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
                    />
                  </div>
                </form>

                {/* Search Results Dropdown */}
                {showSearchResults && (
                  <div className="absolute top-full mt-2 w-full bg-card border border-border rounded-lg shadow-lg max-h-[500px] overflow-auto z-50">
                    {searchLoading ? (
                      <div className="p-4 text-center">
                        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-accent border-r-transparent"></div>
                        <p className="mt-2 text-sm text-muted-foreground">Searching...</p>
                      </div>
                    ) : (
                      <>
                        {searchResults.bookings.length === 0 &&
                         searchResults.drivers.length === 0 &&
                         searchResults.vehicles.length === 0 ? (
                          <div className="p-4 text-center text-muted-foreground">
                            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No results found</p>
                          </div>
                        ) : (
                          <>
                            {/* Rentals Results */}
                            {searchResults.bookings.length > 0 && (
                              <div className="border-b border-border">
                                <div className="px-4 py-2 bg-muted/50 font-semibold text-sm flex items-center gap-2">
                                  <CalendarCheck className="w-4 h-4 text-amber-500" />
                                  Rentals
                                </div>
                                {searchResults.bookings.map((booking: any) => (
                                  <button
                                    key={booking.id}
                                    onClick={() => {
                                      navigate(`/admin/rentals/${booking.id}`);
                                      setShowSearchResults(false);
                                      setSearchQuery("");
                                    }}
                                    className="w-full px-4 py-3 hover:bg-muted/50 text-left transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                                  >
                                    <CalendarCheck className="w-4 h-4 mt-1 text-amber-500 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm">{booking.customer_name}</div>
                                      <div className="text-xs text-muted-foreground truncate">
                                        {booking.pickup_location} • {booking.pickup_date}
                                      </div>
                                    </div>
                                    <Badge
                                      className={`text-xs font-medium ${
                                        booking.status === 'new' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                        booking.status === 'in_progress' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                        booking.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                        booking.status === 'confirmed' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                        'bg-muted/50 text-muted-foreground'
                                      }`}
                                    >
                                      {booking.status === 'in_progress' ? 'In Progress' :
                                       booking.status === 'new' ? 'New' :
                                       booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                                    </Badge>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Clients Results */}
                            {searchResults.drivers.length > 0 && (
                              <div className="border-b border-border">
                                <div className="px-4 py-2 bg-muted/50 font-semibold text-sm flex items-center gap-2">
                                  <Users className="w-4 h-4 text-blue-500" />
                                  Clients
                                </div>
                                {searchResults.drivers.map((driver: any) => (
                                  <button
                                    key={driver.id}
                                    onClick={() => {
                                      navigate('/admin/clients');
                                      setShowSearchResults(false);
                                      setSearchQuery("");
                                    }}
                                    className="w-full px-4 py-3 hover:bg-muted/50 text-left transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                                  >
                                    <Users className="w-4 h-4 mt-1 text-blue-500 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm">{driver.name}</div>
                                      <div className="text-xs text-muted-foreground truncate">{driver.email}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Vehicles Results */}
                            {searchResults.vehicles.length > 0 && (
                              <div>
                                <div className="px-4 py-2 bg-muted/50 font-semibold text-sm flex items-center gap-2">
                                  <Car className="w-4 h-4 text-green-500" />
                                  Vehicles
                                </div>
                                {searchResults.vehicles.map((vehicle: any) => (
                                  <button
                                    key={vehicle.id}
                                    onClick={() => {
                                      navigate('/admin/vehicles');
                                      setShowSearchResults(false);
                                      setSearchQuery("");
                                    }}
                                    className="w-full px-4 py-3 hover:bg-muted/50 text-left transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                                  >
                                    <Car className="w-4 h-4 mt-1 text-green-500 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm">{vehicle.name}</div>
                                      <div className="text-xs text-muted-foreground">{vehicle.category}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* View All Results */}
                            <button
                              onClick={() => {
                                navigate(`/admin/search?q=${encodeURIComponent(searchQuery)}`);
                                setShowSearchResults(false);
                                setSearchQuery("");
                              }}
                              className="w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 text-center text-sm font-medium text-accent transition-colors"
                            >
                              View all results →
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-3">
                <NotificationBell />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowBlockedDatesModal(true)}
                      className="h-9 gap-2 px-3 text-gray-300 hover:text-white hover:bg-white/10"
                    >
                      <CalendarX className="h-4 w-4" />
                      <span className="hidden md:inline text-sm">Block Dates</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Manage Blocked Booking Dates</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearCache}
                      className="h-9 w-9 p-0 text-gray-300 hover:text-white hover:bg-white/10"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear Cache & Reload</p>
                  </TooltipContent>
                </Tooltip>

                <ThemeToggle />
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 text-gray-300 hover:text-white hover:bg-white/10">
                      <Users className="h-5 w-5 text-amber-400" />
                      <span className="hidden md:inline text-sm">{user?.user_metadata?.full_name || user?.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-card border-border">
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>

      {/* Blocked Dates Modal */}
      <BlockedDatesModal
        open={showBlockedDatesModal}
        onOpenChange={setShowBlockedDatesModal}
      />
    </SidebarProvider>
  );
}
