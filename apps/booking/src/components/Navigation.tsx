'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Phone, X, User, LogIn, LogOut, ChevronDown, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { AuthPromptDialog } from '@/components/booking/AuthPromptDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const Navigation = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { settings } = useSiteSettings();
  const { customerUser, session, signOut, loading: authLoading } = useCustomerAuthStore();
  const isActive = (path: string) => pathname === path;

  // Determine if user is authenticated
  const isAuthenticated = !!customerUser && !!session;

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  // Format phone number for tel: link (remove spaces and special chars except +)
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');
  const phoneDisplay = settings.phone_display || settings.phone;

  useEffect(() => {
    // Set initial scroll state
    setIsScrolled(window.scrollY > 20);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { path: '/', label: 'Home' },
    { path: '/about', label: 'About' },
    { path: '/fleet', label: 'Fleet & Pricing' },
    { path: '/testimonials', label: 'Reviews' },
    { path: '/promotions', label: 'Promotions' },
    { path: '/contact', label: 'Contact' }
  ];

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm border-b shadow-metal "
      style={{ backgroundColor: 'hsl(var(--nav-bg))', borderColor: 'hsl(var(--nav-bg))' }}
    >
      <div className="container mx-auto px-2 lg:px-4">
        <div className="flex items-center w-full justify-between gap-2 lg:gap-4 xl:gap-8">
          {/* Logo/Branding - Left */}
          <Link href="/" className="flex items-center gap-2 lg:gap-3 flex-shrink-0 group py-1">
            {settings.logo_url ? (
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || 'Drive247'}
                className="h-14 lg:h-16 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <div className="flex flex-col py-4 ">
                <span
                  className="text-base lg:text-lg xl:text-2xl font-luxury font-semibold leading-tight whitespace-nowrap tracking-wide uppercase"
                  style={{ color: 'hsl(var(--nav-foreground))' }}
                >
                  {settings.company_name || 'Drive247'}
                </span>
                <div className="h-0.5 w-full bg-accent/60 mt-0.5 lg:mt-1" />
              </div>
            )}
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden xl:flex items-center justify-center flex-1 gap-3 2xl:gap-5">
            {navLinks.map(link => (
              <Link
                key={link.path}
                href={link.path}
                className={`text-sm font-medium transition-colors hover:text-accent px-2 whitespace-nowrap ${isActive(link.path) ? 'text-accent' : ''}`}
                style={!isActive(link.path) ? { color: 'hsl(var(--nav-foreground) / 0.8)' } : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right-side Action Area */}
          <div className="hidden xl:flex items-center gap-3 flex-shrink-0">
            {/* Auth Button - Dropdown for logged in, Login button for guests */}
            {!authLoading && (
              isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="text-sm font-medium border-accent/50 hover:bg-accent hover:text-accent-foreground gap-2 bg-background text-foreground"
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={customerUser?.customer?.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs bg-accent/20 text-foreground">
                          {getInitials(customerUser?.customer?.name || 'U')}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-[100px] truncate text-foreground">
                        {customerUser?.customer?.name || 'User'}
                      </span>
                      <ChevronDown className="h-4 w-4 text-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-popover text-popover-foreground">
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium text-popover-foreground">{customerUser?.customer?.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {customerUser?.customer?.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => router.push('/portal')}
                      className="flex items-center cursor-pointer text-popover-foreground"
                    >
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      <span>My Portal</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="text-destructive focus:text-destructive cursor-pointer"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Sign Out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowAuthDialog(true)}
                  className="text-sm font-medium border-accent/50 hover:bg-accent hover:text-accent-foreground"
                  style={{ color: 'hsl(var(--nav-foreground))' }}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  Login / Sign Up
                </Button>
              )
            )}
            <ThemeToggle />
            <a href={`tel:${phoneLink}`}>
              <Button className="gradient-accent shadow-glow text-sm font-semibold whitespace-nowrap">
                <Phone className="w-4 h-4 2xl:mr-2" />
                <span className="hidden 2xl:inline">{phoneDisplay}</span>
              </Button>
            </a>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex xl:hidden items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2"
              style={{ color: 'hsl(var(--nav-foreground))' }}
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isOpen && (
          <div
            className="xl:hidden pb-4 pt-4 space-y-3 border-t mt-4 backdrop-blur-sm -mx-2 px-2"
            style={{ backgroundColor: 'hsl(var(--nav-bg))', borderColor: 'hsl(var(--nav-foreground) / 0.2)' }}
          >
            {navLinks.map(link => (
              <Link
                key={link.path}
                href={link.path}
                onClick={() => setIsOpen(false)}
                className={`block py-2.5 text-sm font-medium transition-colors pl-0 ${isActive(link.path) ? 'text-accent' : ''}`}
                style={!isActive(link.path) ? { color: 'hsl(var(--nav-foreground) / 0.8)' } : undefined}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-4 space-y-3">
              {/* Auth Buttons in Mobile Menu */}
              {!authLoading && (
                isAuthenticated ? (
                  <>
                    <div className="flex items-center gap-3 px-2 py-2 rounded-md bg-muted/50">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={customerUser?.customer?.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs bg-accent/20 text-foreground">
                          {getInitials(customerUser?.customer?.name || 'U')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate text-foreground">{customerUser?.customer?.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{customerUser?.customer?.email}</p>
                      </div>
                    </div>
                    <Link href="/portal" onClick={() => setIsOpen(false)}>
                      <Button variant="outline" className="w-full">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        My Portal
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive border-destructive/50 hover:bg-destructive/10"
                      onClick={() => {
                        setIsOpen(false);
                        handleSignOut();
                      }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setIsOpen(false);
                      setShowAuthDialog(true);
                    }}
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Login / Sign Up
                  </Button>
                )
              )}
              <a href={`tel:${phoneLink}`}>
                <Button className="w-full gradient-accent shadow-glow">
                  <Phone className="w-4 h-4 mr-2" />
                  {phoneDisplay}
                </Button>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Auth Dialog for navbar login */}
      <AuthPromptDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
        prefillEmail=""
        onSkip={() => setShowAuthDialog(false)}
        onSuccess={() => setShowAuthDialog(false)}
      />
    </nav>
  );
};

export default Navigation;
