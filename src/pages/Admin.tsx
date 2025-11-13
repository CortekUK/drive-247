import { useState, useEffect } from "react";
import { useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminDashboardPage from "./AdminDashboard";
import AdminJobs from "./AdminJobs";
import AdminDrivers from "./AdminDrivers";
import AdminVehicles from "./AdminVehicles";
import RentalsManagement from "./admin/RentalsManagement";
import ClientsManagement from "./admin/ClientsManagement";
import FleetMaintenance from "./admin/FleetMaintenance";
import AdminPricing from "./AdminPricing";
import RentalPricingManagement from "./admin/RentalPricingManagement";
import AdminTestimonials from "./AdminTestimonials";
import AdminSettings from "./AdminSettings";
import AdminFeedback from "./AdminFeedback";
import RentalDetail from "./admin/RentalDetail";
import PromotionsManagement from "./admin/PromotionsManagement";
import AdminPromotions from "./AdminPromotions";
import AnalyticsDashboard from "./admin/AnalyticsDashboard";
import SearchResults from "./admin/SearchResults";

const Admin = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate("/auth");
      return;
    }

    setUser(session.user);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <AdminLayout user={user}>
      <Routes>
        <Route path="/" element={<AdminDashboardPage />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/analytics" element={<AnalyticsDashboard />} />
        <Route path="/rentals" element={<RentalsManagement />} />
        <Route path="/rentals/:id" element={<RentalDetail />} />
        <Route path="/clients" element={<ClientsManagement />} />
        <Route path="/vehicles" element={<AdminVehicles />} />
        <Route path="/maintenance" element={<FleetMaintenance />} />
        <Route path="/pricing" element={<RentalPricingManagement />} />
        <Route path="/reviews" element={<AdminTestimonials />} />
        <Route path="/promotions" element={<PromotionsManagement />} />
        <Route path="/feedback" element={<AdminFeedback />} />
        <Route path="/settings" element={<AdminSettings />} />
        
        {/* Redirects for old routes */}
        <Route path="/jobs" element={<Navigate to="/admin/rentals" replace />} />
        <Route path="/jobs/:id" element={<Navigate to="/admin/rentals" replace />} />
        <Route path="/drivers" element={<Navigate to="/admin/clients" replace />} />
        <Route path="/portfolio" element={<Navigate to="/admin/promotions" replace />} />
        <Route path="/portfolio/*" element={<Navigate to="/admin/promotions" replace />} />
        <Route path="/testimonials" element={<Navigate to="/admin/reviews" replace />} />
        
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
};

export default Admin;
