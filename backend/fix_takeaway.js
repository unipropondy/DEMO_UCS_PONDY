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

async function fix() {
  const pool = await sql.connect(dbConfig);

  console.log("=== BACKFILL: isTakeAway from header to detail rows ===\n");

  // 1. Check how many RestaurantOrderDetail rows need updating
  const countRes = await pool.request().query(`
    SELECT COUNT(*) as NeedsUpdate
    FROM RestaurantOrderDetail d
    INNER JOIN RestaurantOrder h ON d.OrderId = h.OrderId
    WHERE h.IsTakeAway = 1 AND (d.isTakeAway = 0 OR d.isTakeAway IS NULL)
  `);
  console.log(`Detail rows to update (isTakeAway mismatch): ${countRes.recordset[0].NeedsUpdate}`);

  // 2. Also check RestaurantOrderCur mismatch (for live orders not yet archived)
  const curCountRes = await pool.request().query(`
    SELECT COUNT(*) as NeedsUpdate
    FROM RestaurantOrderDetailCur d
    INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
    WHERE h.IsTakeAway = 1 AND (d.isTakeAway = 0 OR d.isTakeAway IS NULL)
  `);
  console.log(`Current detail rows to update (isTakeAway mismatch): ${curCountRes.recordset[0].NeedsUpdate}`);

  // 3. Backfill RestaurantOrderDetail (historical)
  const updateRes = await pool.request().query(`
    UPDATE d
    SET d.isTakeAway = h.IsTakeAway
    FROM RestaurantOrderDetail d
    INNER JOIN RestaurantOrder h ON d.OrderId = h.OrderId
    WHERE h.IsTakeAway = 1 AND (d.isTakeAway = 0 OR d.isTakeAway IS NULL)
  `);
  console.log(`\n✅ Updated RestaurantOrderDetail rows: ${updateRes.rowsAffected[0]}`);

  // 4. Backfill RestaurantOrderDetailCur (live orders)
  const updateCurRes = await pool.request().query(`
    UPDATE d
    SET d.isTakeAway = h.IsTakeAway
    FROM RestaurantOrderDetailCur d
    INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
    WHERE h.IsTakeAway = 1 AND (d.isTakeAway = 0 OR d.isTakeAway IS NULL)
  `);
  console.log(`✅ Updated RestaurantOrderDetailCur rows: ${updateCurRes.rowsAffected[0]}`);

  // 5. Verify Vw_MonthwiseSales now shows isTakeAway correctly
  console.log("\n=== Verification: Vw_MonthwiseSales after fix ===");
  const verify = await pool.request().query(`
    SELECT TOP 10 
      OrderId, DishName, isTakeAway, InvoiceDate, TotalAmount
    FROM Vw_MonthwiseSales
    ORDER BY InvoiceDate DESC
  `);
  console.table(verify.recordset);

  // 6. Summary: how many takeaway rows are now visible
  const summary = await pool.request().query(`
    SELECT 
      SUM(CASE WHEN isTakeAway = 1 THEN 1 ELSE 0 END) as TakeAwayRows,
      SUM(CASE WHEN isTakeAway = 0 THEN 1 ELSE 0 END) as DineInRows,
      COUNT(*) as TotalRows
    FROM Vw_MonthwiseSales
  `);
  console.log("\n=== Summary ===");
  console.table(summary.recordset);

  await pool.close();
  console.log("\nDone!");
}

fix().catch(console.error);
