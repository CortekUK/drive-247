'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTenant } from './TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

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
interface CustomerSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinRoom: () => void;
  leaveRoom: () => void;
  sendMessage: (content: string, metadata?: Record<string, unknown>) => void;
  markRead: (channelId: string) => void;
  sendTyping: (isTyping: boolean) => void;
  onNewMessage: (callback: (payload: NewMessagePayload) => void) => () => void;
  onTyping: (callback: (payload: TypingPayload) => void) => () => void;
  onMessagesRead: (callback: (payload: MessagesReadPayload) => void) => () => void;
  onUnreadCount: (callback: (payload: UnreadCountPayload) => void) => () => void;
  onPresenceUpdate: (callback: (payload: PresencePayload) => void) => () => void;
}

const CustomerSocketContext = createContext<CustomerSocketContextType | undefined>(undefined);

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || 'http://localhost:3005';

export function CustomerSocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const messageListenersRef = useRef<Set<(payload: NewMessagePayload) => void>>(new Set());
  const typingListenersRef = useRef<Set<(payload: TypingPayload) => void>>(new Set());
  const readListenersRef = useRef<Set<(payload: MessagesReadPayload) => void>>(new Set());
  const unreadListenersRef = useRef<Set<(payload: UnreadCountPayload) => void>>(new Set());
  const presenceListenersRef = useRef<Set<(payload: PresencePayload) => void>>(new Set());

  // Customer ID from the authenticated customer
  const customerId = customerUser?.customer_id;
  const tenantId = tenant?.id || customerUser?.tenant_id;

  // Initialize socket connection
  useEffect(() => {
    if (!tenantId || !customerId) {
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
      console.log('[CustomerSocket] Connected to chat server');
      setIsConnected(true);

      // Automatically join the customer's chat room for real-time updates
      if (customerId && tenantId) {
        newSocket.emit('join_room', {
          customerId,
          userType: 'customer',
          userId: customerId,
          tenantId,
        });
        console.log('[CustomerSocket] Auto-joined chat room for badge updates');
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[CustomerSocket] Disconnected from chat server:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('[CustomerSocket] Connection error:', error.message);
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
      console.error('[CustomerSocket] Server error:', payload.message);
    });

    setSocket(newSocket);

    // Reconnect and rejoin room when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!newSocket.connected) {
          console.log('[CustomerSocket] Tab visible, reconnecting...');
          newSocket.connect();
        } else if (customerId && tenantId) {
          // Re-join room in case connection was maintained but room membership lost
          newSocket.emit('join_room', {
            customerId,
            userType: 'customer',
            userId: customerId,
            tenantId,
          });
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
  }, [tenantId, customerId]);

  const joinRoom = useCallback(() => {
    if (!socket || !tenantId || !customerId) return;

    socket.emit('join_room', {
      customerId,
      userType: 'customer',
      userId: customerId,
      tenantId,
    });
  }, [socket, tenantId, customerId]);

  const leaveRoom = useCallback(() => {
    if (!socket || !customerId) return;

    socket.emit('leave_room', { customerId });
  }, [socket, customerId]);

  const sendMessage = useCallback(
    (content: string, metadata?: Record<string, unknown>) => {
      if (!socket || !tenantId || !customerId) return;

      socket.emit('send_message', {
        customerId,
        tenantId,
        senderType: 'customer',
        senderId: customerId,
        content,
        metadata,
      });
    },
    [socket, tenantId, customerId]
  );

  const markRead = useCallback(
    (channelId: string) => {
      if (!socket) return;

      socket.emit('mark_read', {
        channelId,
        readerType: 'customer',
      });
    },
    [socket]
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !customerId) return;

      socket.emit('typing', {
        customerId,
        userType: 'customer',
        userId: customerId,
        isTyping,
      });
    },
    [socket, customerId]
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
    <CustomerSocketContext.Provider
      value={{
        socket,
        isConnected,
        joinRoom,
        leaveRoom,
        sendMessage,
        markRead,
        sendTyping,
        onNewMessage,
        onTyping,
        onMessagesRead,
        onUnreadCount,
        onPresenceUpdate,
      }}
    >
      {children}
    </CustomerSocketContext.Provider>
  );
}

export function useCustomerSocket() {
  const context = useContext(CustomerSocketContext);

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
      onNewMessage: () => () => {},
      onTyping: () => () => {},
      onMessagesRead: () => () => {},
      onUnreadCount: () => () => {},
      onPresenceUpdate: () => () => {},
    };
  }

  return context;
}
