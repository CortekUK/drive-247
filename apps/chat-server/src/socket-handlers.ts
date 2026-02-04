import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  JoinRoomPayload,
  LeaveRoomPayload,
  SendMessagePayload,
  MarkReadPayload,
  TypingPayload,
  BulkMessagePayload,
} from './types.js';
import {
  getOrCreateChannel,
  insertMessage,
  markMessagesRead,
  getUnreadCount,
  getCustomer,
  updatePresence,
  getPresence,
} from './supabase-client.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Helper to create room ID from customer ID
function getRoomId(customerId: string): string {
  return `chat:${customerId}`;
}

// Helper to create tenant-wide room ID
function getTenantRoomId(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function registerSocketHandlers(io: TypedServer): void {
  io.on('connection', (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    // Track which rooms this socket has joined
    const joinedRooms = new Set<string>();

    /**
     * JOIN ROOM
     * Client joins a chat room for a specific customer
     */
    socket.on('join_room', async (payload: JoinRoomPayload) => {
      const { customerId, userType, userId, tenantId } = payload;
      const roomId = getRoomId(customerId);

      try {
        // Verify the customer belongs to the tenant
        const customer = await getCustomer(customerId);
        if (!customer) {
          socket.emit('error', { message: 'Customer not found' });
          return;
        }

        if (customer.tenant_id !== tenantId) {
          socket.emit('error', { message: 'Customer does not belong to this tenant' });
          return;
        }

        // Join the room
        await socket.join(roomId);
        joinedRooms.add(roomId);

        console.log(`${userType}:${userId} joined room ${roomId}`);

        // Get or create the channel and send current unread count
        const channel = await getOrCreateChannel(tenantId, customerId);
        const unreadCount = await getUnreadCount(channel.id, userType);

        socket.emit('unread_count', {
          channelId: channel.id,
          count: unreadCount,
        });

        // Update presence to online
        await updatePresence(channel.id, userType, userId, true);

        // Notify others in the room that this user is online
        socket.to(roomId).emit('presence_update', {
          channelId: channel.id,
          participantType: userType,
          participantId: userId,
          isOnline: true,
          lastSeenAt: new Date().toISOString(),
        });

        // Get the other participant's presence and send to this user
        const otherType = userType === 'tenant' ? 'customer' : 'tenant';
        const otherPresence = await getPresence(channel.id, otherType);
        if (otherPresence) {
          socket.emit('presence_update', {
            channelId: channel.id,
            participantType: otherType,
            participantId: otherType === 'customer' ? customerId : 'tenant',
            isOnline: otherPresence.is_online,
            lastSeenAt: otherPresence.last_seen_at,
          });
        }
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    /**
     * LEAVE ROOM
     * Client leaves a chat room
     */
    socket.on('leave_room', async (payload: LeaveRoomPayload & { userType?: 'tenant' | 'customer'; userId?: string; tenantId?: string }) => {
      const { customerId, userType, userId, tenantId } = payload;
      const roomId = getRoomId(customerId);

      // Update presence to offline if we have the info
      if (userType && userId && tenantId) {
        try {
          const channel = await getOrCreateChannel(tenantId, customerId);
          await updatePresence(channel.id, userType, userId, false);

          // Notify others in the room
          socket.to(roomId).emit('presence_update', {
            channelId: channel.id,
            participantType: userType,
            participantId: userId,
            isOnline: false,
            lastSeenAt: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Error updating presence on leave:', error);
        }
      }

      socket.leave(roomId);
      joinedRooms.delete(roomId);

      console.log(`Socket ${socket.id} left room ${roomId}`);
    });

    /**
     * JOIN TENANT ROOM
     * Portal joins tenant-wide room to receive all messages for badge updates
     */
    socket.on('join_tenant_room', async (payload: { tenantId: string }) => {
      const { tenantId } = payload;
      const tenantRoomId = getTenantRoomId(tenantId);

      await socket.join(tenantRoomId);
      joinedRooms.add(tenantRoomId);

      console.log(`Socket ${socket.id} joined tenant room ${tenantRoomId}`);
    });

    /**
     * SEND MESSAGE
     * Client sends a message to a chat room
     */
    socket.on('send_message', async (payload: SendMessagePayload) => {
      const { customerId, tenantId, senderType, senderId, content, metadata } = payload;
      const roomId = getRoomId(customerId);

      try {
        // Get or create the channel
        const channel = await getOrCreateChannel(tenantId, customerId);

        // Insert the message
        const message = await insertMessage(
          channel.id,
          senderType,
          senderId,
          content,
          metadata || {}
        );

        const messagePayload = {
          id: message.id,
          channelId: channel.id,
          senderType: message.sender_type,
          senderId: message.sender_id,
          content: message.content,
          isRead: message.is_read,
          createdAt: message.created_at,
          metadata: message.metadata,
        };

        // Broadcast to all clients in the customer room
        io.to(roomId).emit('new_message', messagePayload);

        // Also broadcast to tenant room for badge updates
        const tenantRoomId = getTenantRoomId(tenantId);
        io.to(tenantRoomId).emit('new_message', messagePayload);

        console.log(`Message sent in room ${roomId} and ${tenantRoomId} by ${senderType}:${senderId}`);
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    /**
     * MARK READ
     * Client marks messages as read in a channel
     */
    socket.on('mark_read', async (payload: MarkReadPayload) => {
      const { channelId, readerType } = payload;

      try {
        const updatedCount = await markMessagesRead(channelId, readerType);

        if (updatedCount > 0) {
          // Notify all clients in related rooms about the read status update
          // We need to find the room ID from the channel
          // For now, broadcast to all connected sockets (can be optimized)
          io.emit('messages_read', {
            channelId,
            readerType,
          });

          console.log(`Marked ${updatedCount} messages as read in channel ${channelId}`);
        }
      } catch (error) {
        console.error('Error marking messages read:', error);
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });

    /**
     * TYPING
     * Client broadcasts typing indicator
     */
    socket.on('typing', (payload: TypingPayload) => {
      const { customerId, userType, userId, isTyping } = payload;
      const roomId = getRoomId(customerId);

      // Broadcast to other clients in the room (not the sender)
      socket.to(roomId).emit('typing', {
        customerId,
        userType,
        userId,
        isTyping,
      });
    });

    /**
     * BULK MESSAGE
     * Tenant sends a message to multiple customers at once
     */
    socket.on('bulk_message', async (payload: BulkMessagePayload) => {
      const { tenantId, customerIds, senderId, content } = payload;

      console.log(`Bulk message to ${customerIds.length} customers from tenant ${tenantId}`);

      for (const customerId of customerIds) {
        const roomId = getRoomId(customerId);

        try {
          // Get or create the channel
          const channel = await getOrCreateChannel(tenantId, customerId);

          // Insert the message
          const message = await insertMessage(
            channel.id,
            'tenant',
            senderId,
            content,
            { bulk: true }
          );

          // Broadcast to all clients in the room
          io.to(roomId).emit('new_message', {
            id: message.id,
            channelId: channel.id,
            senderType: 'tenant',
            senderId,
            content: message.content,
            isRead: message.is_read,
            createdAt: message.created_at,
            metadata: message.metadata,
          });
        } catch (error) {
          console.error(`Error sending bulk message to customer ${customerId}:`, error);
        }
      }
    });

    /**
     * DISCONNECT
     * Clean up when client disconnects
     */
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id}, reason: ${reason}`);
      joinedRooms.clear();
    });
  });
}
