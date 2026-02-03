import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building, UserCheck, XCircle } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  customer_type?: "Individual" | "Company";
  status: string;
  whatsapp_opt_in: boolean;
  is_blocked?: boolean;
}

interface CustomerSummaryCardsProps {
  customers: Customer[];
}

export const CustomerSummaryCards = ({ customers }: CustomerSummaryCardsProps) => {
  // Filter out blocked customers from all counts
  const nonBlockedCustomers = customers.filter(c => !c.is_blocked);
  const totalCustomers = nonBlockedCustomers.length;
  const activeCustomers = nonBlockedCustomers.filter(c => c.status === 'Active').length;
  const rejectedCustomers = nonBlockedCustomers.filter(c => c.status === 'Rejected').length;
  const companies = nonBlockedCustomers.filter(c => c.customer_type === 'Company').length;

  const cards = [
    {
      title: "Total Customers",
      value: totalCustomers,
      icon: Users,
      description: "All customers in database"
    },
    {
      title: "Active",
      value: activeCustomers,
      icon: UserCheck,
      description: "Currently active customers"
    },
    {
      title: "Rejected",
      value: rejectedCustomers,
      icon: XCircle,
      description: "Customers pending review"
    },
    {
      title: "Companies",
      value: companies,
      icon: Building,
      description: "Business customers"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const getCardClassName = () => {
          let baseClasses = "transition-all duration-200 cursor-pointer hover:shadow-md ";
          if (card.title === "Active") {
            return baseClasses + "bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40";
          } else if (card.title === "Rejected") {
            return baseClasses + "bg-gradient-to-br from-red-500/10 to-red-500/5 border-red-500/20 hover:border-red-500/40";
          } else if (card.title === "Companies") {
            return baseClasses + "bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20 hover:border-blue-500/40";
          } else {
            return baseClasses + "bg-card hover:bg-accent/50 border";
          }
        };

        const getIconClassName = () => {
          let baseClasses = "h-4 w-4 ";
          if (card.title === "Active") {
            return baseClasses + "text-success";
          } else if (card.title === "Rejected") {
            return baseClasses + "text-red-500";
          } else if (card.title === "Companies") {
            return baseClasses + "text-blue-500";
          } else {
            return baseClasses + "text-primary";
          }
        };
        
        return (
          <Card key={card.title} className={getCardClassName()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <Icon className={getIconClassName()} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">
                {card.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};