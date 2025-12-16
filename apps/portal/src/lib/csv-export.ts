import { type InsurancePolicy } from "@/hooks/use-insurance-data";
import { format } from "date-fns";

export function exportInsuranceToCSV(policies: InsurancePolicy[], filename?: string) {
  const headers = [
    "Policy Number",
    "Customer Name",
    "Customer Email", 
    "Customer Phone",
    "Vehicle Registration",
    "Vehicle Make/Model",
    "Provider",
    "Start Date",
    "Expiry Date",
    "Status",
    "Documents Count",
    "Notes",
    "Created Date"
  ];

  const rows = policies.map(policy => [
    policy.policy_number,
    policy.customers.name,
    policy.customers.email || "",
    policy.customers.phone || "",
    policy.vehicles?.reg || "",
    policy.vehicles ? `${policy.vehicles.make} ${policy.vehicles.model}` : "",
    policy.provider || "",
    format(new Date(policy.start_date), "yyyy-MM-dd"),
    format(new Date(policy.expiry_date), "yyyy-MM-dd"),
    policy.status,
    policy.docs_count.toString(),
    policy.notes || "",
    format(new Date(policy.created_at), "yyyy-MM-dd HH:mm")
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename || `insurance-policies-${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}