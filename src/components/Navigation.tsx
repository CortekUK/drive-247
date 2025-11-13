import { Link, useLocation } from "react-router-dom";
import { Menu, Phone, X } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSiteSettings } from "@/hooks/useSiteSettings";
const Navigation = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { settings } = useSiteSettings();
  const isActive = (path: string) => location.pathname === path;
  
  // Format phone number for tel: link (remove spaces and special chars except +)
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');

  useEffect(() => {
    // Set initial scroll state
    setIsScrolled(window.scrollY > 20);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  const navLinks = [{
    path: "/",
    label: "Home"
  }, {
    path: "/fleet",
    label: "Fleet & Pricing"
  }, {
    path: "/promotions",
    label: "Promotions"
  }, {
    path: "/about",
    label: "About"
  }, {
    path: "/testimonials",
    label: "Reviews"
  }, {
    path: "/contact",
    label: "Contact"
  }];
  return <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm border-b shadow-metal py-3 h-[72px]" style={{ backgroundColor: 'hsl(var(--nav-bg))', borderColor: 'hsl(var(--nav-bg))' }}>
      <div className="container mx-auto px-2 lg:px-4">
        <div className="flex items-center w-full justify-between gap-2 lg:gap-4 xl:gap-8">
          {/* Logo/Branding - Left */}
          <Link to="/" className="flex items-center gap-2 lg:gap-3 flex-shrink-0 group">
            <div className="flex flex-col">
              <span className="text-base lg:text-lg xl:text-2xl font-luxury font-semibold leading-tight whitespace-nowrap tracking-wide" style={{ color: 'hsl(var(--nav-foreground))' }}>
                Drive917
              </span>
              <div className="h-0.5 w-full bg-accent/60 mt-0.5 lg:mt-1" />
            </div>
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden xl:flex items-center justify-center flex-1 gap-3 2xl:gap-5">
            {navLinks.map(link => <Link key={link.path} to={link.path} className={`text-sm font-medium transition-colors hover:text-accent px-2 whitespace-nowrap ${isActive(link.path) ? "text-accent" : ""}`} style={!isActive(link.path) ? { color: 'hsl(var(--nav-foreground) / 0.8)' } : undefined}>
                {link.label}
              </Link>)}
          </div>

          {/* Right-side Action Area */}
          <div className="hidden xl:flex items-center gap-3 flex-shrink-0">
            <ThemeToggle />
            <a href={`tel:${phoneLink}`}>
              <Button className="gradient-accent shadow-glow text-sm font-semibold whitespace-nowrap">
                <Phone className="w-4 h-4 2xl:mr-2" />
                <span className="hidden 2xl:inline">{settings.phone}</span>
              </Button>
            </a>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex xl:hidden items-center gap-2">
            <ThemeToggle />
            <button onClick={() => setIsOpen(!isOpen)} className="p-2" style={{ color: 'hsl(var(--nav-foreground))' }}>
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isOpen && <div className="xl:hidden pb-4 pt-4 space-y-3 border-t mt-4 backdrop-blur-sm -mx-2 px-2" style={{ backgroundColor: 'hsl(var(--nav-bg))', borderColor: 'hsl(var(--nav-foreground) / 0.2)' }}>
            {navLinks.map(link => <Link key={link.path} to={link.path} onClick={() => setIsOpen(false)} className={`block py-2.5 text-sm font-medium transition-colors pl-0 ${isActive(link.path) ? "text-accent" : ""}`} style={!isActive(link.path) ? { color: 'hsl(var(--nav-foreground) / 0.8)' } : undefined}>
                {link.label}
              </Link>)}
            <div className="pt-4 space-y-3">
              <a href={`tel:${phoneLink}`}>
                <Button className="w-full gradient-accent shadow-glow">
                  <Phone className="w-4 h-4 mr-2" />
                  {settings.phone}
                </Button>
              </a>
            </div>
          </div>}
      </div>
    </nav>;
};
export default Navigation;