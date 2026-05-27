const sql = require("mssql");
const path = require("path");
// Load .env from backend directory
require("dotenv").config({ path: "c:/Users/User/Desktop/DEMO_UCS_PONDY/backend/.env" });

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

async function check() {
  console.log("Connecting with config:", { ...dbConfig, password: "***" });
  const pool = await sql.connect(dbConfig);
  try {
    console.log("\n=== RestaurantOrderCur NULL Check ===");
    const resCurNull = await pool.request().query(`
      SELECT COUNT(*) as count FROM RestaurantOrderCur WHERE TotalLineItemAmount IS NULL
    `);
    console.log("RestaurantOrderCur rows with NULL TotalLineItemAmount:", resCurNull.recordset[0].count);

    console.log("\n=== RestaurantOrder NULL Check ===");
    const resHistNull = await pool.request().query(`
      SELECT COUNT(*) as count FROM RestaurantOrder WHERE TotalLineItemAmount IS NULL
    `);
    console.log("RestaurantOrder rows with NULL TotalLineItemAmount:", resHistNull.recordset[0].count);

    console.log("\n=== Recent RestaurantOrder rows with NULL TotalLineItemAmount ===");
    const recentNulls = await pool.request().query(`
      SELECT TOP 10 OrderId, OrderNumber, OrderDateTime, TotalAmount, TotalLineItemAmount, StatusCode, isOrderClosed, IsTakeAway
      FROM RestaurantOrder
      WHERE TotalLineItemAmount IS NULL
      ORDER BY CreatedOn DESC
    `);
    console.table(recentNulls.recordset);

    console.log("\n=== Recent RestaurantOrderCur rows with NULL TotalLineItemAmount ===");
    const recentCurNulls = await pool.request().query(`
      SELECT TOP 10 OrderId, OrderNumber, OrderDateTime, TotalAmount, TotalLineItemAmount, StatusCode, isOrderClosed, IsTakeAway
      FROM RestaurantOrderCur
      WHERE TotalLineItemAmount IS NULL
      ORDER BY CreatedOn DESC
    `);
    console.table(recentCurNulls.recordset);

    console.log("\n=== Recent successfully populated RestaurantOrder rows ===");
    const recentOk = await pool.request().query(`
      SELECT TOP 5 OrderId, OrderNumber, OrderDateTime, TotalAmount, TotalLineItemAmount, StatusCode, isOrderClosed, IsTakeAway
      FROM RestaurantOrder
      WHERE TotalLineItemAmount IS NOT NULL
      ORDER BY CreatedOn DESC
    `);
    console.table(recentOk.recordset);

  } catch (err) {
    console.error("Error querying DB:", err);
  } finally {
    await pool.close();
  }
}

check().catch(console.error);
