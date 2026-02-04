'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTenant } from './TenantContext';
import { useAuthStore } from '@/stores/auth-store';

// Event payload types matching chat-server
interface NewMessagePayload {
  id: number;
  channelId: string;
  senderType: 'tenant' | 'customer';
  senderId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface TypingPayload {
  customerId: string;
  userType: 'tenant' | 'customer';
  userId: string;
  isTyping: boolean;
}

interface UnreadCountPayload {
  channelId: string;
  count: number;
}

interface MessagesReadPayload {
  channelId: string;
  readerType: string;
}

interface PresencePayload {
  channelId: string;
  participantType: 'tenant' | 'customer';
  participantId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

// Socket context type
interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinRoom: (customerId: string) => void;
  leaveRoom: (customerId: string) => void;
  sendMessage: (customerId: string, content: string, metadata?: Record<string, unknown>) => void;
  markRead: (channelId: string) => void;
  sendTyping: (customerId: string, isTyping: boolean) => void;
  sendBulkMessage: (customerIds: string[], content: string) => void;
  onNewMessage: (callback: (payload: NewMessagePayload) => void) => () => void;
  onTyping: (callback: (payload: TypingPayload) => void) => () => void;
  onMessagesRead: (callback: (payload: MessagesReadPayload) => void) => () => void;
  onUnreadCount: (callback: (payload: UnreadCountPayload) => void) => () => void;
  onPresenceUpdate: (callback: (payload: PresencePayload) => void) => () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || 'http://localhost:3005';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();
  const messageListenersRef = useRef<Set<(payload: NewMessagePayload) => void>>(new Set());
  const typingListenersRef = useRef<Set<(payload: TypingPayload) => void>>(new Set());
  const readListenersRef = useRef<Set<(payload: MessagesReadPayload) => void>>(new Set());
  const unreadListenersRef = useRef<Set<(payload: UnreadCountPayload) => void>>(new Set());
  const presenceListenersRef = useRef<Set<(payload: PresencePayload) => void>>(new Set());

  // Initialize socket connection
  useEffect(() => {
    if (!tenant || !appUser) {
      return;
    }

    const newSocket = io(CHAT_SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected to chat server');
      setIsConnected(true);

      // Automatically join tenant room for badge updates
      if (tenant?.id) {
        newSocket.emit('join_tenant_room', { tenantId: tenant.id });
        console.log('[Socket] Joined tenant room for badge updates');
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected from chat server:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
      setIsConnected(false);
    });

    // Set up event listeners
    newSocket.on('new_message', (payload: NewMessagePayload) => {
      messageListenersRef.current.forEach((listener) => listener(payload));
    });

    newSocket.on('typing', (payload: TypingPayload) => {
      typingListenersRef.current.forEach((listener) => listener(payload));
    });

    newSocket.on('messages_read', (payload: MessagesReadPayload) => {
      readListenersRef.current.forEach((listener) => listener(payload));
    });

    newSocket.on('unread_count', (payload: UnreadCountPayload) => {
      unreadListenersRef.current.forEach((listener) => listener(payload));
    });

    newSocket.on('presence_update', (payload: PresencePayload) => {
      presenceListenersRef.current.forEach((listener) => listener(payload));
    });

    newSocket.on('error', (payload: { message: string }) => {
      console.error('[Socket] Server error:', payload.message);
    });

    setSocket(newSocket);

    // Reconnect and rejoin tenant room when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!newSocket.connected) {
          console.log('[Socket] Tab visible, reconnecting...');
          newSocket.connect();
        } else if (tenant?.id) {
          // Re-join tenant room in case connection was maintained but room membership lost
          newSocket.emit('join_tenant_room', { tenantId: tenant.id });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [tenant?.id, appUser?.id]);

  const joinRoom = useCallback(
    (customerId: string) => {
      if (!socket || !tenant || !appUser) return;

      socket.emit('join_room', {
        customerId,
        userType: 'tenant',
        userId: appUser.id,
        tenantId: tenant.id,
      });
    },
    [socket, tenant, appUser]
  );

  const leaveRoom = useCallback(
    (customerId: string) => {
      if (!socket) return;

      socket.emit('leave_room', { customerId });
    },
    [socket]
  );

  const sendMessage = useCallback(
    (customerId: string, content: string, metadata?: Record<string, unknown>) => {
      if (!socket || !tenant || !appUser) return;

      socket.emit('send_message', {
        customerId,
        tenantId: tenant.id,
        senderType: 'tenant',
        senderId: appUser.id,
        content,
        metadata,
      });
    },
    [socket, tenant, appUser]
  );

  const markRead = useCallback(
    (channelId: string) => {
      if (!socket) return;

      socket.emit('mark_read', {
        channelId,
        readerType: 'tenant',
      });
    },
    [socket]
  );

  const sendTyping = useCallback(
    (customerId: string, isTyping: boolean) => {
      if (!socket || !appUser) return;

      socket.emit('typing', {
        customerId,
        userType: 'tenant',
        userId: appUser.id,
        isTyping,
      });
    },
    [socket, appUser]
  );

  const sendBulkMessage = useCallback(
    (customerIds: string[], content: string) => {
      if (!socket || !tenant || !appUser) return;

      socket.emit('bulk_message', {
        tenantId: tenant.id,
        customerIds,
        senderId: appUser.id,
        content,
      });
    },
    [socket, tenant, appUser]
  );

  // Event listener registration functions
  const onNewMessage = useCallback((callback: (payload: NewMessagePayload) => void) => {
    messageListenersRef.current.add(callback);
    return () => {
      messageListenersRef.current.delete(callback);
    };
  }, []);

  const onTyping = useCallback((callback: (payload: TypingPayload) => void) => {
    typingListenersRef.current.add(callback);
    return () => {
      typingListenersRef.current.delete(callback);
    };
  }, []);

  const onMessagesRead = useCallback((callback: (payload: MessagesReadPayload) => void) => {
    readListenersRef.current.add(callback);
    return () => {
      readListenersRef.current.delete(callback);
    };
  }, []);

  const onUnreadCount = useCallback((callback: (payload: UnreadCountPayload) => void) => {
    unreadListenersRef.current.add(callback);
    return () => {
      unreadListenersRef.current.delete(callback);
    };
  }, []);

  const onPresenceUpdate = useCallback((callback: (payload: PresencePayload) => void) => {
    presenceListenersRef.current.add(callback);
    return () => {
      presenceListenersRef.current.delete(callback);
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        joinRoom,
        leaveRoom,
        sendMessage,
        markRead,
        sendTyping,
        sendBulkMessage,
        onNewMessage,
        onTyping,
        onMessagesRead,
        onUnreadCount,
        onPresenceUpdate,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);

  if (context === undefined) {
    // Return safe defaults when provider is not mounted
    return {
      socket: null,
      isConnected: false,
      joinRoom: () => {},
      leaveRoom: () => {},
      sendMessage: () => {},
      markRead: () => {},
      sendTyping: () => {},
      sendBulkMessage: () => {},
      onNewMessage: () => () => {},
      onTyping: () => () => {},
      onMessagesRead: () => () => {},
      onUnreadCount: () => () => {},
      onPresenceUpdate: () => () => {},
    };
  }

  return context;
}
