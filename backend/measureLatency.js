const axios = require("axios");
const sql = require("mssql");
const { poolPromise } = require("./config/db");

const LOCAL_URL = "http://localhost:3000";
const REMOTE_URL = "https://demoucspondy-production.up.railway.app";

async function measureEndpoint(client, label, method, path, data = null) {
  const start = Date.now();
  try {
    const url = `${client.defaults.baseURL}${path}`;
    let res;
    if (method === "GET") {
      res = await client.get(path);
    } else {
      res = await client.post(path, data);
    }
    const duration = Date.now() - start;
    return { success: true, duration, status: res.status, size: JSON.stringify(res.data).length };
  } catch (err) {
    const duration = Date.now() - start;
    return { success: false, duration, error: err.message, status: err.response?.status };
  }
}

async function main() {
  console.log("🔍 Fetching a valid test Table ID from database...");
  const pool = await poolPromise;
  if (!pool) {
    console.error("Could not connect to database.");
    process.exit(1);
  }

  const tableRes = await pool.request().query("SELECT TOP 1 TableId, CurrentOrderId FROM TableMaster WHERE Status = 1");
  const testTable = tableRes.recordset[0] || { TableId: "81970863-A2FB-4E2D-9EA4-7FF1EE017C09", CurrentOrderId: "20260603-0083" };
  const tableId = testTable.TableId;
  const orderId = testTable.CurrentOrderId;
  console.log(`🎯 Using test Table ID: ${tableId} | Order ID: ${orderId}`);

  const localClient = axios.create({ baseURL: LOCAL_URL, timeout: 15000 });
  const remoteClient = axios.create({ baseURL: REMOTE_URL, timeout: 15000 });

  const testCases = [
    { name: "Menu Load (Kitchens)", method: "GET", path: "/api/menu/kitchens" },
    { name: "Menu Load (All Dishes)", method: "GET", path: "/api/menu/dishes/all" },
    { name: "Table Load (All)", method: "GET", path: "/api/tables/all" },
    { name: "Cart Load", method: "GET", path: `/api/orders/cart/${tableId}` },
    { 
      name: "Sync Operation (Save Cart)", 
      method: "POST", 
      path: "/api/orders/save-cart", 
      data: {
        tableId: tableId,
        orderId: orderId || null,
        userId: "A2C77148-444E-4F26-90CE-687D00640A93",
        lastUpdate: Date.now(),
        version: 1,
        items: [
          {
            lineItemId: "00000000-0000-0000-0000-000000009999",
            id: "E28D7C8A-02DF-4395-92FE-F2D725C21C90", // Sample dish ID
            name: "Test Dish",
            qty: 1,
            price: 10.0,
            status: "NEW"
          }
        ]
      }
    },
    {
      name: "Checkout",
      method: "POST",
      path: "/api/orders/checkout",
      data: { tableId: tableId }
    }
  ];

  console.log("\n⚡ Measuring API response times (10-second run)...");
  
  const results = [];
  for (const tc of testCases) {
    console.log(`⏱️  Testing: ${tc.name}...`);
    const localRes = await measureEndpoint(localClient, "LOCAL", tc.method, tc.path, tc.data);
    const remoteRes = await measureEndpoint(remoteClient, "REMOTE", tc.method, tc.path, tc.data);

    results.push({
      "Operation": tc.name,
      "Local Time (ms)": localRes.success ? `${localRes.duration}ms` : `FAIL (${localRes.error})`,
      "Remote Time (ms)": remoteRes.success ? `${remoteRes.duration}ms` : `FAIL (${remoteRes.error})`,
      "Local Size (bytes)": localRes.success ? localRes.size : "-",
      "Remote Size (bytes)": remoteRes.success ? remoteRes.size : "-",
      "Ratio (Remote/Local)": localRes.success && remoteRes.success ? `${(remoteRes.duration / localRes.duration).toFixed(1)}x slower` : "-"
    });
  }

  console.log("\n=== PERFORMANCE TIMING LOG COMPARISON ===");
  console.table(results);

  console.log("\n🔄 Restoring table status...");
  try {
    await pool.request()
      .input("tid", sql.VarChar(50), tableId)
      .input("oid", sql.NVarChar(50), orderId)
      .query("UPDATE TableMaster SET Status = 1, CurrentOrderId = @oid WHERE TableId = @tid");
    console.log("✅ Restored table status successfully.");
  } catch (restoreErr) {
    console.error("❌ Failed to restore table status:", restoreErr.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
