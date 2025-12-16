import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, AlertTriangle, XCircle, Pause } from "lucide-react";
import { type InsuranceStats } from "@/hooks/use-insurance-data";

interface InsuranceKPIsProps {
  stats: InsuranceStats;
  isFiltered?: boolean;
}

export function InsuranceKPIs({ stats, isFiltered = false }: InsuranceKPIsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <Card className="bg-card hover:bg-accent/50 border shadow-sm transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {isFiltered ? "Filtered" : "Total"} Policies
          </CardTitle>
          <Shield className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
          {isFiltered && (
            <p className="text-xs text-muted-foreground">in current view</p>
          )}
        </CardContent>
      </Card>
      
      <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active</CardTitle>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <CheckCircle className="h-4 w-4 text-success" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-success">{stats.active}</div>
          <p className="text-xs text-muted-foreground">policies active</p>
        </CardContent>
      </Card>
      
      <Card className="bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20 hover:border-warning/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full" />
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-warning">{stats.expiringSoon}</div>
          <p className="text-xs text-muted-foreground">next 30 days</p>
        </CardContent>
      </Card>
      
      <Card className="bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20 hover:border-destructive/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Expired</CardTitle>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{stats.expired}</div>
          <p className="text-xs text-muted-foreground">need renewal</p>
        </CardContent>
      </Card>

      <Card className="bg-card hover:bg-accent/50 border shadow-sm transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Inactive</CardTitle>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-gray-500 rounded-full" />
            <Pause className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-muted-foreground">{stats.inactive}</div>
          <p className="text-xs text-muted-foreground">disabled</p>
        </CardContent>
      </Card>
    </div>
  );
}