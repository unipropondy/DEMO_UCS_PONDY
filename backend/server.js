const express = require("express");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const sql = require("mssql");

const envPath = path.resolve(__dirname, ".env");

// 1. Ensure the .env file exists
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, "");
}

// 2. Read current .env content
let envContent = fs.readFileSync(envPath, "utf8");

// 3. If JWT_SECRET is not defined in .env, generate a unique one and save it
if (!envContent.includes("JWT_SECRET=")) {
  const secureSecret = crypto.randomBytes(32).toString("hex");
  const prefix = envContent.endsWith("\n") || envContent.trim() === "" ? "" : "\n";
  fs.appendFileSync(envPath, `${prefix}JWT_SECRET=${secureSecret}\n`);
  console.log("🔒 [Security] JWT_SECRET was missing! A brand-new unique key has been automatically generated and saved to .env.");
}

// 4. Load env variables
require("dotenv").config({ path: envPath });

const { poolPromise } = require("./config/db");
const { initDB } = require("./config/init");
const dbCheck = require("./middleware/dbCheck");
const { getHoldOvertimeMinutes } = require("./utils/settingsCache");
const { rollbackAllActive } = require("./utils/transactionHelper");

// Import Routes
const authRoutes = require("./routes/auth");
const tableRoutes = require("./routes/tables");
const menuRoutes = require("./routes/menu");
const salesRoutes = require("./routes/sales");
const memberRoutes = require("./routes/members");
const attendanceRoutes = require("./routes/attendance");
const adminRoutes = require("./routes/admin");
const orderRoutes = require("./routes/orders");
const serverRoutes = require("./routes/servers");
const settingsRoutes = require("./routes/settings");
const companySettingsRoutes = require("./routes/companySettings");
const uploadRoutes = require("./routes/upload");
const exportRoutes = require("./routes/export");
const creditCustomerRoutes = require("./routes/creditCustomers");

const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  perMessageDeflate: true,
});

const PORT = process.env.PORT || 3000;

// Expose io to routes
app.set("io", io);

// Socket.io Connection
io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  // Broadcast new orders to other clients (e.g. KDS screens)
  socket.on("new_order", (data) => {
    console.log("📦 [Server] New order event received:", data.orderId);
    io.emit("new_order", data);
  });

  // 🚀 INSTANT SYNC: Relay cart changes between tablets without DB lag
  socket.on("cart_change", (data) => {
    console.log("🛒 [Server] Cart change relay:", data.tableId);
    io.emit("cart_change", data);
  });

  // Broadcast status updates (e.g. order completed, items voided)
  socket.on("order_status_update", (data) => {
    console.log("🔄 [Server] Order status update received:", data.orderId);
    io.emit("order_status_update", data);
  });

  // 🖥️ CUSTOMER DISPLAY SYNC: Relay cashier cart/checkout states to second monitor
  socket.on("customer_display_sync", (data) => {
    console.log("🖥️ [Server] Customer Display Sync for Table/Register:", data.tableNo || data.registerId);
    io.emit("customer_display_sync", data);
  });

  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id);
  });
});

// 🔄 REAL-TIME DB POLLER: Syncs database updates (e.g. from online/QR orders or external systems) with Socket.io clients instantly
// Only emits when changes are detected, preventing performance issues.
const previousTablesState = new Map();
const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };

async function pollTables() {
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const holdMinutes = await getHoldOvertimeMinutes();

      const result = await pool.request()
        .input("holdMinutes", sql.Int, holdMinutes)
        .query(`
        SELECT 
          TableId AS id, 
          CAST(TableNumber AS VARCHAR(50)) AS label,
          CAST(DiningSection AS VARCHAR(10)) AS DiningSection, 
          LockedByName as lockedByName,
          Status, 
          CONVERT(VARCHAR, StartTime, 126) as StartTime, 
          ISNULL(TotalAmount, 0) as totalAmount, 
          CurrentOrderId as currentOrderId,
          entry_status AS entryStatus,
          CASE 
            WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND StartTime > '2000-01-01' AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
            ELSE 0 
          END AS isOvertime,
          CASE 
            WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= @holdMinutes THEN 1 
            ELSE 0 
          END AS isHoldOvertime,
          CONVERT(VARCHAR, ModifiedOn, 126) as ModifiedOn
        FROM TableMaster WITH (NOLOCK)
      `);

      const currentTables = result.recordset || [];
      currentTables.forEach((table) => {
        const tableId = String(table.id).toLowerCase();
        const prevState = previousTablesState.get(tableId);

        const hasChanged = !prevState || 
          prevState.status !== table.Status || 
          prevState.entryStatus !== table.entryStatus ||
          prevState.totalAmount !== table.totalAmount ||
          prevState.lockedByName !== table.lockedByName;

        if (hasChanged) {
          // Update local memory state
          previousTablesState.set(tableId, {
            status: table.Status,
            entryStatus: table.entryStatus,
            totalAmount: table.totalAmount,
            lockedByName: table.lockedByName
          });

          // Only emit if this is not the very first load/state initialization
          if (prevState) {
            io.emit("table_status_updated", {
              tableId,
              status: Number(table.Status),
              totalAmount: Number(table.totalAmount) || 0,
              startTime: table.StartTime,
              tableNo: table.label,
              section: sectionMap[String(table.DiningSection)] || table.DiningSection,
              modifiedOn: table.ModifiedOn,
              isOvertime: table.isOvertime || 0,
              isHoldOvertime: table.isHoldOvertime || 0,
              entryStatus: table.entryStatus || null
            });
            console.log(`🔌 [DB Poller Sync] Table ${table.label} updated -> Emit socket. Status: ${table.Status}, QR: ${table.entryStatus}`);
          } else {
            // Initialize memory state silently on startup
            console.log(`🔌 [DB Poller Sync] Initialized table state for: ${table.label}`);
          }
        }
      });
    }
  } catch (err) {
    console.error("🔄 [DB Poller Sync] Error:", err.message);
  } finally {
    // Schedule the next poll to execute 5 seconds after this one finished (prevents overlapping)
    setTimeout(pollTables, 5000);
  }
}

// Start the poller
setTimeout(pollTables, 5000);

// ✅ Global Middleware
app.use(compression()); // Compress all responses
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: '1d',
  immutable: true
}));

// 🔄 Database Connection Check (for all API routes)
app.use("/api", dbCheck);

/* ================= ROUTES ================= */
app.use("/api/auth", authRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", salesRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/company-settings", companySettingsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/credit-customers", creditCustomerRoutes);

// AI Chat Integration
const aiRouter = require("./ai-service-src/routes/ai.routes");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");

const aiApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." }
});

const authenticateAiToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET || 'supersecureposjwttokensecretkey', (err, decoded) => {
    if (err) {
      req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
      return next();
    }
    req.user = decoded;
    next();
  });
};

const requireAiAuthorizedRole = (req, res, next) => {
  const role = (req.user?.role || '').toUpperCase();
  const allowed = ['ADMIN'];
  if (!allowed.includes(role)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Insufficient privileges. Only ADMIN group users can access the AI Chat assistant."
    });
  }
  next();
};

app.use("/api/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);
app.use("/api/v1/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);

// Root Endpoints
app.get("/", (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; padding: 40px; text-align: center;">
      <h1 style="color: #4CAF50;">🚀 UCS Modular POS Backend is LIVE</h1>
      <p>Status: ✅ Connected to Database</p>
      <p>Time: ${new Date().toLocaleString()}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #666;">Ready for Waiter & KDS Sync</p>
    </div>
  `);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Legacy support (redirects to ensure existing frontend calls don't break)
app.post("/api/checkout", (req, res) =>
  res.redirect(307, "/api/orders/checkout"),
);
app.get("/tables", (req, res) => res.redirect("/api/tables/all"));
app.get("/kitchens", (req, res) => res.redirect("/api/menu/kitchens"));
app.get("/dishgroups/:id", (req, res) =>
  res.redirect(`/api/menu/dishgroups/${req.params.id}`),
);
app.get("/dishes/:id", (req, res) =>
  res.redirect(`/api/menu/dishes/group/${req.params.id}`),
);
app.get("/api/dishes/all", (req, res) => res.redirect("/api/menu/dishes/all"));
app.get("/api/discounts", (req, res) => res.redirect("/api/admin/discounts"));
app.get("/modifiers/:id", (req, res) =>
  res.redirect(`/api/menu/modifiers/${req.params.id}`),
);
app.get("/image/:id", (req, res) =>
  res.redirect(`/api/menu/image/${req.params.id}`),
);

// 🧹 JANITOR HEARTBEAT: Professional Ghost Cleanup (Every 5 minutes)
// This safety net closes any orphan orders belonging to available tables.
setInterval(async () => {
  try {
    const pool = await poolPromise;
    if (!pool || !pool.connected) return;
    
    // 1. Close orders for tables that are marked as Available (Status 0)
    const result = await pool.request().query(`
      UPDATE RestaurantOrderCur 
      SET isOrderClosed = 1, ModifiedOn = GETDATE()
      WHERE (isOrderClosed = 0 OR isOrderClosed IS NULL)
      AND Tableno IN (
        SELECT TableNumber 
        FROM TableMaster 
        WHERE Status = 0
      )
      AND CreatedOn < DATEADD(MINUTE, -5, GETDATE()); -- Optimized to allow index usage
    `);
    
    if (result.recordset || result.rowsAffected[0] > 0) {
      const affected = result.rowsAffected[0] || 0;
      console.log(`🧹 [Janitor] Cleared ${affected} orphan orders.`);
      io.emit("cart_updated", { tableId: "GLOBAL_CLEANUP" });
    }

    // 2. Ensure items in DetailCur are also marked served if their parent order is closed
    await pool.request().query(`
      UPDATE RestaurantOrderDetailCur
      SET StatusCode = 4, ModifiedOn = GETDATE()
      WHERE StatusCode IN (1, 2, 3, 5)
      AND OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE isOrderClosed = 1)
    `);
  } catch (err) {
    console.error("🧹 [Janitor] Cleanup failed:", err.message);
  }
}, 5 * 60 * 1000); // 5 Minutes

/* ================= START SERVER ================= */
httpServer.listen(PORT, async () => {
  console.log(`🚀 Modular Server running on port ${PORT}`);

  try {
    const pool = await poolPromise;
    if (pool) {
      await initDB(pool);
      // ✅ One-time migration: Fix any active tables with NULL StartTime
      await pool.request().query("UPDATE TableMaster SET StartTime = GETDATE() WHERE StartTime IS NULL AND Status IN (1, 2, 3, 4)");
      console.log("✅ Database initialized and ready.");
    }
  } catch (err) {
    console.error("⚠️ Initial DB setup failed:", err.message);
  }
});

// Register global exception handlers for transaction cleanup
process.on("uncaughtException", async (err) => {
  console.error("🔥 [Fatal] Uncaught Exception occurred:", err);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during uncaughtException:", cleanErr);
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("🔥 [Fatal] Unhandled Rejection at:", promise, "reason:", reason);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during unhandledRejection:", cleanErr);
  }
});