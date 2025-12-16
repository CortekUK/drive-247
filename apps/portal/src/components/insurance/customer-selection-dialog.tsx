import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, Phone, Mail } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  customer_type: string | null;
}

interface CustomerSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerSelect: (customerId: string) => void;
}

export function CustomerSelectionDialog({
  open,
  onOpenChange,
  onCustomerSelect
}: CustomerSelectionDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers-search", searchTerm],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("id, name, email, phone, customer_type")
        .order("name", { ascending: true });

      if (searchTerm.trim()) {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data as Customer[];
    },
    enabled: open,
  });

  const handleSelectCustomer = (customerId: string) => {
    onCustomerSelect(customerId);
    onOpenChange(false);
    setSearchTerm("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Select Customer</DialogTitle>
          <DialogDescription>
            Choose a customer to create an insurance policy for
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search customers by name, email, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Customer List */}
          <ScrollArea className="h-[400px] border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-muted-foreground">Searching customers...</div>
              </div>
            ) : customers.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <User className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <div className="text-muted-foreground">
                    {searchTerm ? "No customers found matching your search" : "No customers found"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {customers.map((customer) => (
                  <Button
                    key={customer.id}
                    variant="ghost"
                    className="w-full h-auto p-4 justify-start"
                    onClick={() => handleSelectCustomer(customer.id)}
                  >
                    <div className="flex items-center gap-3 w-full">
                      <div className="p-2 bg-primary/10 rounded-full">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium">{customer.name}</div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                          {customer.email && (
                            <div className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              <span>{customer.email}</span>
                            </div>
                          )}
                          {customer.phone && (
                            <div className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              <span>{customer.phone}</span>
                            </div>
                          )}
                          {customer.customer_type && (
                            <Badge variant="outline" className="text-xs">
                              {customer.customer_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}