import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  const nonBlockedCustomers = customers.filter(c => !c.is_blocked);
  const totalCustomers = nonBlockedCustomers.length;
  const activeCustomers = nonBlockedCustomers.filter(c => c.status === 'Active').length;
  const rejectedCustomers = nonBlockedCustomers.filter(c => c.status === 'Rejected').length;
  const gigDrivers = nonBlockedCustomers.filter(c => c.is_gig_driver).length;

  const cards = [
    {
      title: "Total Customers",
      value: totalCustomers,
      description: "All customers in database"
    },
    {
      title: "Active",
      value: activeCustomers,
      description: "Currently active customers"
    },
    {
      title: "Rejected",
      value: rejectedCustomers,
      description: "Customers pending review"
    },
    {
      title: "Gig Drivers",
      value: gigDrivers,
      description: "Customers registered as gig drivers"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const getCardClassName = () => {
          let baseClasses = "transition-all duration-200 cursor-pointer hover:shadow-md ";
          if (card.title === "Active") {
            return baseClasses + "bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40";
          } else if (card.title === "Rejected") {
            return baseClasses + "bg-gradient-to-br from-red-500/10 to-red-500/5 border-red-500/20 hover:border-red-500/40";
          } else if (card.title === "Gig Drivers") {
            return baseClasses + "bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20 hover:border-purple-500/40";
          } else {
            return baseClasses + "bg-card hover:bg-accent/50 border";
          }
        };

        return (
          <Card key={card.title} className={getCardClassName()}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
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