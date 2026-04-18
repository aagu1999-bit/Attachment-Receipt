import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { logger } from "./logger";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socket.io",
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket client connected");

    socket.on("join:session", (sessionCode: string) => {
      socket.join(`session:${sessionCode}`);
      logger.info({ socketId: socket.id, sessionCode }, "Socket joined session room");
    });

    socket.on("leave:session", (sessionCode: string) => {
      socket.leave(`session:${sessionCode}`);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Socket client disconnected");
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitToSession(sessionCode: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`session:${sessionCode}`).emit(event, data);
}
