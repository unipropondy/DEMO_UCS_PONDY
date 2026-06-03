const { io } = require("socket.io-client");

const LOCAL_URL = "http://localhost:3000";
const REMOTE_URL = "https://demoucspondy-production.up.railway.app";

function monitor(url, label) {
  console.log(` monitor Connecting to ${label} at ${url}...`);
  const socket = io(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000
  });

  let eventCount = 0;

  socket.on("connect", () => {
    console.log(` monitor Connected to ${label}`);
  });

  socket.on("connect_error", (err) => {
    console.error(` monitor ${label} connection error:`, err.message);
  });

  const events = ["table_status_updated", "cart_change", "cart_updated", "new_order"];
  events.forEach(event => {
    socket.on(event, (data) => {
      eventCount++;
      console.log(` monitor [${label}] Event: ${event} | Data:`, JSON.stringify(data));
    });
  });

  setTimeout(() => {
    socket.disconnect();
    console.log(` monitor Disconnected from ${label}. Total events received: ${eventCount}`);
  }, 10000); // monitor for 10 seconds
}

monitor(LOCAL_URL, "LOCAL");
monitor(REMOTE_URL, "REMOTE");
