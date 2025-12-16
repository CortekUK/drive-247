'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const navigation = [
    { name: 'Dashboard', href: '/admin/dashboard', icon: '📊' },
    { name: 'Rental Companies', href: '/admin/rentals', icon: '🏢' },
    { name: 'Contact Requests', href: '/admin/contacts', icon: '📧' },
  ];

  // Only show "Manage Admins" to primary super admin
  if (user?.is_primary_super_admin) {
    navigation.push({
      name: 'Manage Admins',
      href: '/admin/admins',
      icon: '👥',
    });
  }

  const isActive = (href: string) => pathname === href;

  return (
    <div className="flex flex-col h-screen w-64 bg-dark-card border-r border-dark-border text-white">
      <div className="flex items-center justify-center h-16 bg-dark-bg border-b border-dark-border">
        <div className="text-center">
          <h1 className="text-xl font-bold gradient-text">CORTEK</h1>
          <p className="text-xs text-gray-400">Admin Portal</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-2">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
              isActive(item.href)
                ? 'bg-primary-600 text-white'
                : 'text-gray-300 hover:bg-dark-hover hover:text-white'
            }`}
          >
            <span className="mr-3 text-lg">{item.icon}</span>
            {item.name}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-dark-border">
        <div className="mb-4">
          <p className="text-sm text-gray-400">Signed in as</p>
          <p className="text-sm font-medium truncate">{user?.email}</p>
          {user?.is_primary_super_admin && (
            <span className="inline-block mt-1 px-2 py-1 text-xs font-semibold text-yellow-900 bg-yellow-200 rounded">
              Primary Admin
            </span>
          )}
        </div>
        <button
          onClick={() => logout()}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
