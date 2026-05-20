import { io, Socket } from "socket.io-client";
import { API_URL } from "./Config";

export const socket: Socket = io(API_URL, {
  transports: ["websocket", "polling"], // websocket first skips polling handshake delay on mobile
  reconnectionAttempts: 20,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  autoConnect: true,
  forceNew: false,
});

socket.on("connect", () => {
  console.log("🔌 Socket connected:", socket.id);
});

socket.on("connect_error", (error) => {
  console.error("🔌 Socket connection error:", error);
});
