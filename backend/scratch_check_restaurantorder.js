const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

async function check() {
  const pool = await sql.connect(dbConfig);
  try {
    console.log("=== ALL ORDERS CREATED TODAY IN RestaurantOrder ===");
    const res = await pool.request().query(`
      SELECT OrderId, OrderNumber, CreatedOn, TotalAmount, TotalLineItemAmount, IsTakeAway, StatusCode
      FROM RestaurantOrder
      WHERE CreatedOn >= '2026-05-27'
      ORDER BY CreatedOn DESC
    `);
    console.table(res.recordset);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.close();
  }
}

check().catch(console.error);
