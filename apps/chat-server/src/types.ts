// Socket event payload types

export interface JoinRoomPayload {
  customerId: string;
  userType: 'tenant' | 'customer';
  userId: string;  // app_users.id for tenant, customers.id for customer
  tenantId: string;
}

export interface LeaveRoomPayload {
  customerId: string;
}

export interface SendMessagePayload {
  customerId: string;
  tenantId: string;
  senderType: 'tenant' | 'customer';
  senderId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface NewMessagePayload {
  id: number;
  channelId: string;
  senderType: 'tenant' | 'customer';
  senderId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface MarkReadPayload {
  channelId: string;
  readerType: 'tenant' | 'customer';
}

export interface TypingPayload {
  customerId: string;
  userType: 'tenant' | 'customer';
  userId: string;
  isTyping: boolean;
}

export interface BulkMessagePayload {
  tenantId: string;
  customerIds: string[];
  senderId: string;
  content: string;
}

export interface UnreadCountPayload {
  channelId: string;
  count: number;
}

export interface PresencePayload {
  channelId: string;
  participantType: 'tenant' | 'customer';
  participantId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

// Server to client events
export interface ServerToClientEvents {
  new_message: (payload: NewMessagePayload) => void;
  typing: (payload: TypingPayload) => void;
  messages_read: (payload: { channelId: string; readerType: string }) => void;
  unread_count: (payload: UnreadCountPayload) => void;
  presence_update: (payload: PresencePayload) => void;
  error: (payload: { message: string }) => void;
}

// Client to server events
export interface ClientToServerEvents {
  join_room: (payload: JoinRoomPayload) => void;
  leave_room: (payload: LeaveRoomPayload) => void;
  join_tenant_room: (payload: { tenantId: string }) => void;
  send_message: (payload: SendMessagePayload) => void;
  mark_read: (payload: MarkReadPayload) => void;
  typing: (payload: TypingPayload) => void;
  bulk_message: (payload: BulkMessagePayload) => void;
}

// Database types
export interface ChatChannel {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: 'active' | 'archived';
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  channel_id: string;
  sender_type: 'tenant' | 'customer';
  sender_id: string;
  content: string;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
