// Enhanced search service with comprehensive search, ranking, and fuzzy matching
import { supabase } from "@/integrations/supabase/client";

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  url: string;
  icon?: string;
  score?: number; // For ranking
}

export interface SearchResults {
  customers: SearchResult[];
  vehicles: SearchResult[];
  rentals: SearchResult[];
  fines: SearchResult[];
  payments: SearchResult[];
  plates: SearchResult[];
  insurance: SearchResult[];
}

// Fuzzy matching utility
const fuzzyMatch = (text: string, query: string): number => {
  if (!text || !query) return 0;
  
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  // Exact match gets highest score
  if (lowerText === lowerQuery) return 100;
  
  // Starts with gets high score
  if (lowerText.startsWith(lowerQuery)) return 90;
  
  // Contains gets medium score
  if (lowerText.includes(lowerQuery)) return 70;
  
  // Character-by-character fuzzy matching for typos
  let score = 0;
  let queryIndex = 0;
  
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 1;
      queryIndex++;
    }
  }
  
  // Score based on how many characters matched in order
  const fuzzyScore = (score / lowerQuery.length) * 50;
  return queryIndex === lowerQuery.length ? fuzzyScore : 0;
};

// Smart ranking function
const rankResults = (results: SearchResult[], query: string): SearchResult[] => {
  return results
    .map(result => ({
      ...result,
      score: Math.max(
        fuzzyMatch(result.title, query),
        fuzzyMatch(result.subtitle, query)
      )
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5); // Cap at 5 results per category
};

export const searchService = {
  async searchAll(query: string, entityFilter: string = 'all', tenantId?: string): Promise<SearchResults> {
    if (!query.trim()) {
      return {
        customers: [],
        vehicles: [],
        rentals: [],
        fines: [],
        payments: [],
        plates: [],
        insurance: [],
      };
    }

    const searchTerm = `%${query.trim()}%`;
    const results: SearchResults = {
      customers: [],
      vehicles: [],
      rentals: [],
      fines: [],
      payments: [],
      plates: [],
      insurance: [],
    };

    try {
      // Search customers (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'customers') {
        let customerQuery = supabase
          .from("customers")
          .select("id, name, email, phone, customer_type, status")
          .or(`name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm},customer_type.ilike.${searchTerm}`);

        if (tenantId) {
          customerQuery = customerQuery.eq("tenant_id", tenantId);
        }

        const { data: customers } = await customerQuery.limit(10);

        const customerResults = (customers || []).map(customer => ({
          id: customer.id,
          title: customer.name,
          subtitle: `${customer.email || customer.phone || ''} • ${customer.customer_type || 'Individual'} • ${customer.status || 'Active'}`,
          category: "Customers",
          url: `/customers/${customer.id}`,
          icon: "user",
        }));

        results.customers = rankResults(customerResults, query);
      }

      // Search vehicles (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'vehicles') {
        let vehicleQuery = supabase
          .from("vehicles")
          .select("id, reg, make, model, status, colour, color, acquisition_type")
          .or(`reg.ilike.${searchTerm},make.ilike.${searchTerm},model.ilike.${searchTerm},colour.ilike.${searchTerm},color.ilike.${searchTerm}`);

        if (tenantId) {
          vehicleQuery = vehicleQuery.eq("tenant_id", tenantId);
        }

        const { data: vehicles } = await vehicleQuery.limit(10);

        const vehicleResults = (vehicles || []).map(vehicle => ({
          id: vehicle.id,
          title: `${vehicle.reg}`,
          subtitle: `${vehicle.make} ${vehicle.model} • ${vehicle.colour || vehicle.color || ''} • ${vehicle.status}`,
          category: "Vehicles",
          url: `/vehicles/${vehicle.id}`,
          icon: "car",
        }));

        results.vehicles = rankResults(vehicleResults, query);
      }

      // Search rentals (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'rentals') {
        let rentalQuery = supabase
          .from("rentals")
          .select(`
            id,
            rental_number,
            start_date,
            end_date,
            status,
            customers(name),
            vehicles(reg, make, model)
          `)
          .or(`rental_number.ilike.${searchTerm}`);

        if (tenantId) {
          rentalQuery = rentalQuery.eq("tenant_id", tenantId);
        }

        const { data: rentals } = await rentalQuery
          .order('start_date', { ascending: false })
          .limit(10);

        const rentalResults = (rentals || [])
          .filter(rental => rental.customers && rental.vehicles)
          .map(rental => ({
            id: rental.id,
            title: rental.rental_number || `${(rental.customers as any)?.name} Rental`,
            subtitle: `${(rental.customers as any)?.name} • ${(rental.vehicles as any)?.reg} • ${rental.status}`,
            category: "Rentals",
            url: `/rentals/${rental.id}`,
            icon: "calendar",
          }));

        results.rentals = rankResults(rentalResults, query);
      }

      // Search fines (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'fines') {
        let fineQuery = supabase
          .from("fines")
          .select(`
            id,
            reference_no,
            type,
            amount,
            status,
            customers(name),
            vehicles(reg)
          `)
          .or(`reference_no.ilike.${searchTerm},type.ilike.${searchTerm}`);

        if (tenantId) {
          fineQuery = fineQuery.eq("tenant_id", tenantId);
        }

        const { data: fines } = await fineQuery
          .order('issue_date', { ascending: false })
          .limit(10);

        const fineResults = (fines || []).map(fine => ({
          id: fine.id,
          title: fine.reference_no || `${fine.type} Fine`,
          subtitle: `$${fine.amount} • ${(fine.vehicles as any)?.reg} • ${(fine.customers as any)?.name || 'Unknown'} • ${fine.status}`,
          category: "Fines",
          url: `/fines/${fine.id}`,
          icon: "alert-triangle",
        }));

        results.fines = rankResults(fineResults, query);
      }

      // Search payments (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'payments') {
        let paymentQuery = supabase
          .from("payments")
          .select(`
            id,
            amount,
            payment_date,
            method,
            payment_type,
            customers(name)
          `)
          .or(`method.ilike.${searchTerm},payment_type.ilike.${searchTerm}`);

        if (tenantId) {
          paymentQuery = paymentQuery.eq("tenant_id", tenantId);
        }

        const { data: payments } = await paymentQuery
          .order('payment_date', { ascending: false })
          .limit(10);

        const paymentResults = (payments || [])
          .filter(payment => payment.customers)
          .map(payment => ({
            id: payment.id,
            title: `$${payment.amount} ${payment.payment_type}`,
            subtitle: `${(payment.customers as any)?.name} • ${payment.method || 'Unknown method'} • ${payment.payment_date}`,
            category: "Payments",
            url: `/payments/${payment.id}`,
            icon: "credit-card",
          }));

        results.payments = rankResults(paymentResults, query);
      }

      // Search plates (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'plates') {
        let plateQuery = supabase
          .from("plates")
          .select(`
            id,
            plate_number,
            status,
            supplier,
            notes,
            vehicles(reg, make, model)
          `)
          .or(`plate_number.ilike.${searchTerm},supplier.ilike.${searchTerm}`);

        if (tenantId) {
          plateQuery = plateQuery.eq("tenant_id", tenantId);
        }

        const { data: plates } = await plateQuery.limit(10);

        const plateResults = (plates || []).map(plate => ({
          id: plate.id,
          title: plate.plate_number,
          subtitle: plate.vehicles 
            ? `${(plate.vehicles as any).reg} • ${(plate.vehicles as any).make} ${(plate.vehicles as any).model} • ${plate.status || 'Unknown'}`
            : `Not Assigned • ${plate.status || 'Unknown'}`,
          category: "Plates",
          url: `/plates/${plate.id}`,
          icon: "hash",
        }));

        results.plates = rankResults(plateResults, query);
      }

      // Search insurance policies (if not filtered out)
      if (entityFilter === 'all' || entityFilter === 'insurance') {
        let insuranceQuery = supabase
          .from("insurance_policies")
          .select(`
            id,
            policy_number,
            provider,
            status,
            expiry_date,
            customers(name),
            vehicles(reg, make, model)
          `)
          .or(`policy_number.ilike.${searchTerm},provider.ilike.${searchTerm}`);

        if (tenantId) {
          insuranceQuery = insuranceQuery.eq("tenant_id", tenantId);
        }

        const { data: insurance } = await insuranceQuery
          .order('expiry_date', { ascending: false })
          .limit(10);

        const insuranceResults = (insurance || [])
          .filter(policy => policy.customers)
          .map(policy => ({
            id: policy.id,
            title: `Policy ${policy.policy_number}`,
            subtitle: `${(policy.customers as any)?.name} • ${policy.provider || 'Unknown provider'} • ${policy.status} • Expires ${policy.expiry_date}`,
            category: "Insurance",
            url: `/insurance?policy=${policy.id}`,
            icon: "shield",
          }));

        results.insurance = rankResults(insuranceResults, query);
      }

    } catch (error) {
      console.error('Search error:', error);
    }

    return results;
  },
};