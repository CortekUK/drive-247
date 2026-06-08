import { Users, UserCheck, UserX, Briefcase } from "lucide-react";
import { KpiTile } from "@/components/bento";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  status: string;
  whatsapp_opt_in: boolean;
  is_blocked?: boolean;
  is_gig_driver?: boolean;
}

interface CustomerSummaryCardsProps {
  customers: Customer[];
}

export const CustomerSummaryCards = ({ customers }: CustomerSummaryCardsProps) => {
  // Filter out blocked customers from all counts
  const nonBlockedCustomers = customers.filter((c) => !c.is_blocked);
  const totalCustomers = nonBlockedCustomers.length;
  const activeCustomers = nonBlockedCustomers.filter((c) => c.status === "Active").length;
  const rejectedCustomers = nonBlockedCustomers.filter((c) => c.status === "Rejected").length;
  const gigDrivers = nonBlockedCustomers.filter((c) => c.is_gig_driver).length;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiTile
        variant="feature"
        label="Total Customers"
        value={totalCustomers}
        sub="All customers in database"
        icon={<Users className="h-4 w-4" />}
      />
      <KpiTile
        label="Active"
        value={activeCustomers}
        sub="Currently active customers"
        icon={<UserCheck className="h-4 w-4" />}
      />
      <KpiTile
        label="Rejected"
        value={rejectedCustomers}
        sub="Customers pending review"
        icon={<UserX className="h-4 w-4" />}
      />
      <KpiTile
        label="Gig Drivers"
        value={gigDrivers}
        sub="Registered as gig drivers"
        icon={<Briefcase className="h-4 w-4" />}
      />
    </div>
  );
};
