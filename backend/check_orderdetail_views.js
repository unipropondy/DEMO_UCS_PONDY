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

  // 1. View definitions
  console.log("\n=== vw_RestaurantOrderDetail DEFINITION ===");
  const d1 = await pool.request().query(`SELECT OBJECT_DEFINITION(OBJECT_ID('vw_RestaurantOrderDetail')) AS def`);
  console.log(d1.recordset[0]?.def || "NOT FOUND");

  console.log("\n=== vw_RestaurantOrderDetailCur DEFINITION ===");
  const d2 = await pool.request().query(`SELECT OBJECT_DEFINITION(OBJECT_ID('vw_RestaurantOrderDetailCur')) AS def`);
  console.log(d2.recordset[0]?.def || "NOT FOUND");

  // 2. Sample rows from both views
  console.log("\n=== vw_RestaurantOrderDetail SAMPLE (last 5) ===");
  try {
    const s1 = await pool.request().query(`SELECT TOP 5 * FROM vw_RestaurantOrderDetail ORDER BY CreatedOn DESC`);
    if (s1.recordset.length > 0) {
      console.log("Columns:", Object.keys(s1.recordset[0]));
      s1.recordset.forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r, null, 2)));
    }
  } catch(e) { console.log("Error:", e.message); }

  console.log("\n=== vw_RestaurantOrderDetailCur SAMPLE (last 5) ===");
  try {
    const s2 = await pool.request().query(`SELECT TOP 5 * FROM vw_RestaurantOrderDetailCur ORDER BY CreatedOn DESC`);
    if (s2.recordset.length > 0) {
      console.log("Columns:", Object.keys(s2.recordset[0]));
      s2.recordset.forEach((r, i) => console.log(`Row ${i}:`, JSON.stringify(r, null, 2)));
    }
  } catch(e) { console.log("Error:", e.message); }

  // 3. Check underlying table columns
  console.log("\n=== RestaurantOrderDetail columns ===");
  const c1 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetail' ORDER BY ORDINAL_POSITION
  `);
  console.table(c1.recordset);

  console.log("\n=== RestaurantOrderDetailCur columns ===");
  const c2 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetailCur' ORDER BY ORDINAL_POSITION
  `);
  console.table(c2.recordset);

  // 4. Check DishMaster for DishCode
  console.log("\n=== DishMaster columns (DishCode check) ===");
  const dm = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DishMaster' ORDER BY ORDINAL_POSITION
  `);
  console.table(dm.recordset);

  // 5. Null analysis on RestaurantOrderDetail
  console.log("\n=== NULL analysis on RestaurantOrderDetail (last 20) ===");
  const nullCheck = await pool.request().query(`
    SELECT TOP 20
      d.OrderDetailId,
      d.DishId,
      d.DishName,
      d.isTakeAway,
      d.DiscountAmount,
      d.DiscountType,
      d.ManualDiscountAmount,
      dm.DishCode,
      dm.DishGroupId
    FROM RestaurantOrderDetail d
    LEFT JOIN DishMaster dm ON d.DishId = dm.DishId
    ORDER BY d.CreatedOn DESC
  `);
  console.table(nullCheck.recordset);

  // 6. Null analysis on RestaurantOrderDetailCur
  console.log("\n=== NULL analysis on RestaurantOrderDetailCur (last 20) ===");
  const nullCheckCur = await pool.request().query(`
    SELECT TOP 20
      d.OrderDetailId,
      d.DishId,
      d.DishName,
      d.isTakeAway,
      d.DiscountAmount,
      d.DiscountType,
      h.IsTakeAway AS HeaderTakeAway
    FROM RestaurantOrderDetailCur d
    LEFT JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
    ORDER BY d.CreatedOn DESC
  `);
  console.table(nullCheckCur.recordset);

  await pool.close();
}

check().catch(console.error);
