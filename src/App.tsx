import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import Pricing from "./pages/Pricing";
import About from "./pages/About";
import Testimonials from "./pages/Testimonials";
import Contact from "./pages/Contact";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Admin from "./pages/Admin";
import Auth from "./pages/Auth";
import FAQ from "./pages/FAQ";
import Portfolio from "./pages/Portfolio";
import PortfolioDetail from "./pages/PortfolioDetail";
import Promotions from "./pages/Promotions";
import FleetDetail from "./pages/FleetDetail";
import NotFound from "./pages/NotFound";
import GDPRConsent from "./components/GDPRConsent";
import ScrollToTopOnNavigate from "./components/ScrollToTopOnNavigate";
import BookingSuccess from "./pages/BookingSuccess";
import BookingCancelled from "./pages/BookingCancelled";
import Booking from "./pages/Booking";
import BookingVehicles from "./pages/BookingVehicles";
import BookingCheckout from "./pages/BookingCheckout";
import VeriffCallback from "./pages/VeriffCallback";
import Setup from "./pages/admin/Setup";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider 
      attribute="class" 
      defaultTheme="dark" 
      enableSystem={true}
      storageKey="vite-ui-theme"
      disableTransitionOnChange
    >
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTopOnNavigate />
          <GDPRConsent />
          <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/fleet" element={<Pricing />} />
          <Route path="/fleet/:id" element={<FleetDetail />} />
          <Route path="/pricing" element={<Navigate to="/fleet" replace />} />
          <Route path="/about" element={<About />} />
          <Route path="/testimonials" element={<Testimonials />} />
          <Route path="/reviews" element={<Navigate to="/testimonials" replace />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/promotions" element={<Promotions />} />
          <Route path="/promotions/:slug" element={<Navigate to="/promotions" replace />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/booking/vehicles" element={<BookingVehicles />} />
          <Route path="/booking/checkout" element={<BookingCheckout />} />
          <Route path="/booking-success" element={<BookingSuccess />} />
          <Route path="/booking-cancelled" element={<BookingCancelled />} />
          <Route path="/veriff-callback" element={<VeriffCallback />} />

          {/* Redirects for old routes */}
          <Route path="/chauffeur-services" element={<Navigate to="/fleet" replace />} />
          <Route path="/close-protection" element={<Navigate to="/contact" replace />} />
          <Route path="/portfolio" element={<Navigate to="/promotions" replace />} />
          <Route path="/portfolio/:slug" element={<Navigate to="/promotions" replace />} />
          <Route path="/projects" element={<Navigate to="/promotions" replace />} />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
