import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { registerSocketHandlers } from './socket-handlers.js';
import type { ClientToServerEvents, ServerToClientEvents } from './types.js';

// Load environment variables
dotenv.config({ path: '../../.env' });
dotenv.config({ path: '../../.env.local' });

const PORT = process.env.CHAT_SERVER_PORT || 3005;

// Create HTTP server
const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  res.writeHead(404);
  res.end();
});

// Create Socket.IO server with CORS configuration
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      /\.drive-247\.com$/,
      /\.vercel\.app$/,
    ],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Register socket event handlers
registerSocketHandlers(io);

// Start the server
httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Chat Server is running!                               ║
║                                                            ║
║   Port: ${PORT}                                              ║
║   Health: http://localhost:${PORT}/health                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  io.close(() => {
    console.log('Socket.IO server closed');
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  io.close(() => {
    console.log('Socket.IO server closed');
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});
