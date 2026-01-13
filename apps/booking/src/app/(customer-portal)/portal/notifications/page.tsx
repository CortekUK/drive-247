'use client';

import { useCustomerNotifications } from '@/hooks/use-customer-notifications';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  Car,
  Shield,
  CreditCard,
  Info,
  AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function getNotificationIcon(type: string) {
  switch (type) {
    case 'booking_confirmed':
    case 'rental_started':
    case 'rental_ended':
      return Car;
    case 'verification':
      return Shield;
    case 'payment':
      return CreditCard;
    case 'welcome':
      return Bell;
    case 'alert':
      return AlertCircle;
    default:
      return Info;
  }
}

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useCustomerNotifications();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              : 'All caught up!'}
          </p>
        </div>

        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}

          {notifications.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all your notifications. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearAll.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const Icon = getNotificationIcon(notification.type);
            return (
              <Card
                key={notification.id}
                className={`transition-colors ${
                  !notification.is_read ? 'bg-muted/30 border-accent/30' : ''
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    <div
                      className={`p-2 rounded-full shrink-0 ${
                        !notification.is_read
                          ? 'bg-accent/20'
                          : 'bg-muted'
                      }`}
                    >
                      <Icon
                        className={`h-5 w-5 ${
                          !notification.is_read
                            ? 'text-accent'
                            : 'text-muted-foreground'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium">{notification.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.is_read && (
                          <Badge variant="secondary" className="shrink-0">
                            New
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.created_at), {
                            addSuffix: true,
                          })}
                          {' • '}
                          {format(new Date(notification.created_at), 'PP')}
                        </p>

                        <div className="flex gap-2">
                          {!notification.is_read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAsRead.mutate(notification.id)}
                              disabled={markAsRead.isPending}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Mark read
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteNotification.mutate(notification.id)}
                            disabled={deleteNotification.isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-2">No notifications</h3>
          <p className="text-muted-foreground">
            You don't have any notifications yet. We'll notify you about booking updates, promotions, and more.
          </p>
        </Card>
      )}
    </div>
  );
}
