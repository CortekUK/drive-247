'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  totalVehicles: number;
  totalRentals: number;
  totalRevenue: number;
  totalCustomers: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<PlatformMetrics>({
    totalTenants: 0,
    activeTenants: 0,
    totalVehicles: 0,
    totalRentals: 0,
    totalRevenue: 0,
    totalCustomers: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      // Get tenant counts
      const { count: totalTenants } = await supabase
        .from('tenants')
        .select('*', { count: 'exact', head: true });

      const { count: activeTenants } = await supabase
        .from('tenants')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      // Get vehicle count
      const { count: totalVehicles } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });

      // Get rental count
      const { count: totalRentals } = await supabase
        .from('rentals')
        .select('*', { count: 'exact', head: true });

      // Get customer count
      const { count: totalCustomers } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });

      // Calculate total revenue (sum of all rental amounts)
      const { data: rentalsData } = await supabase
        .from('rentals')
        .select('price_per_day, rental_duration');

      const totalRevenue = rentalsData?.reduce((sum, rental) => {
        return sum + (rental.price_per_day * rental.rental_duration || 0);
      }, 0) || 0;

      setMetrics({
        totalTenants: totalTenants || 0,
        activeTenants: activeTenants || 0,
        totalVehicles: totalVehicles || 0,
        totalRentals: totalRentals || 0,
        totalRevenue,
        totalCustomers: totalCustomers || 0,
      });
    } catch (error) {
      console.error('Error loading metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl text-gray-600">Loading metrics...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Platform Dashboard</h1>
        <p className="mt-2 text-gray-600">Overview of all rental companies and platform metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Total Rental Companies"
          value={metrics.totalTenants}
          subtitle={`${metrics.activeTenants} active`}
          icon="🏢"
          bgColor="bg-blue-50"
          textColor="text-blue-700"
        />

        <MetricCard
          title="Total Vehicles"
          value={metrics.totalVehicles}
          subtitle="Across all companies"
          icon="🚗"
          bgColor="bg-green-50"
          textColor="text-green-700"
        />

        <MetricCard
          title="Total Rentals"
          value={metrics.totalRentals}
          subtitle="All-time bookings"
          icon="📋"
          bgColor="bg-purple-50"
          textColor="text-purple-700"
        />

        <MetricCard
          title="Total Customers"
          value={metrics.totalCustomers}
          subtitle="Platform-wide"
          icon="👥"
          bgColor="bg-yellow-50"
          textColor="text-yellow-700"
        />

        <MetricCard
          title="Total Revenue"
          value={`$${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="All-time earnings"
          icon="💰"
          bgColor="bg-indigo-50"
          textColor="text-indigo-700"
        />

        <MetricCard
          title="Platform Health"
          value="Operational"
          subtitle="All systems running"
          icon="✅"
          bgColor="bg-emerald-50"
          textColor="text-emerald-700"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <p className="text-sm text-gray-500">Activity feed coming soon...</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <QuickActionButton href="/admin/rentals" text="Add New Rental Company" />
            <QuickActionButton href="/admin/contacts" text="View Contact Requests" />
            <QuickActionButton href="/admin/admins" text="Manage Super Admins" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  bgColor,
  textColor,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: string;
  bgColor: string;
  textColor: string;
}) {
  return (
    <div className={`${bgColor} rounded-lg p-6 shadow`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className={`text-3xl font-bold ${textColor}`}>{value}</div>
      <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

function QuickActionButton({ href, text }: { href: string; text: string }) {
  return (
    <a
      href={href}
      className="block w-full px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
    >
      {text} →
    </a>
  );
}
