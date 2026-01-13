'use client';

import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Bell, Settings, LogOut, ChevronDown } from 'lucide-react';
import { useCustomerNotifications } from '@/hooks/use-customer-notifications';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function CustomerPortalHeader() {
  const router = useRouter();
  const { notifications, unreadCount, markAsRead } = useCustomerNotifications();
  const { customerUser, signOut } = useCustomerAuthStore();

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {/* Notification Bell */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-xs font-medium text-destructive-foreground flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <div className="flex items-center justify-between p-4 border-b">
              <h4 className="font-semibold">Notifications</h4>
              {unreadCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <ScrollArea className="h-[300px]">
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No notifications yet
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.slice(0, 10).map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-3 hover:bg-muted/50 cursor-pointer ${
                        !notification.is_read ? 'bg-muted/30' : ''
                      }`}
                      onClick={() => {
                        if (!notification.is_read) {
                          markAsRead.mutate(notification.id);
                        }
                      }}
                    >
                      <p className="text-sm font-medium">{notification.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notification.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            {notifications.length > 0 && (
              <div className="p-2 border-t">
                <Link href="/portal/notifications">
                  <Button variant="ghost" className="w-full" size="sm">
                    View all notifications
                  </Button>
                </Link>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <ThemeToggle />

        {/* Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={customerUser?.customer?.profile_photo_url || undefined} />
                <AvatarFallback className="text-xs bg-primary/10">
                  {getInitials(customerUser?.customer?.name || 'U')}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium leading-none">
                  {customerUser?.customer?.name || 'User'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {customerUser?.customer?.email || ''}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{customerUser?.customer?.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {customerUser?.customer?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/portal/settings" className="flex items-center cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
