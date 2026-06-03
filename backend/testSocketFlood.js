const { io } = require("socket.io-client");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const LOCAL_URL = "http://localhost:3000";
const REMOTE_URL = "https://demoucspondy-production.up.railway.app";

function monitor(url, label) {
  console.log(`🔌 [Monitor] Connecting to ${label} at ${url}...`);
  const socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000
  });

  let eventCount = 0;

  socket.on("connect", () => {
    console.log(`✅ [Monitor] Connected to ${label}`);
  });

  socket.on("connect_error", (err) => {
    console.error(`❌ [Monitor] ${label} connection error:`, err.message);
  });

  const events = ["table_status_updated", "cart_change", "cart_updated", "new_order"];
  events.forEach(event => {
    socket.on(event, (data) => {
      eventCount++;
      console.log(`📡 [${label}] Event: ${event} | Data:`, JSON.stringify(data));
    });
  });

  setTimeout(() => {
    socket.disconnect();
    console.log(`🔌 [Monitor] Disconnected from ${label}. Total events received: ${eventCount}`);
  }, 10000); // monitor for 10 seconds
}

// Monitor both local and remote if possible
monitor(LOCAL_URL, "LOCAL");
monitor(REMOTE_URL, "REMOTE");
