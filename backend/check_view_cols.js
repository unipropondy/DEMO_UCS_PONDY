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

  // Check actual columns on vw_RestaurantOrderDetailCur
  console.log("\n=== Actual columns returned by vw_RestaurantOrderDetailCur ===");
  const res = await pool.request().query(`SELECT TOP 1 * FROM vw_RestaurantOrderDetailCur`);
  console.log(Object.keys(res.recordset[0] || {}));

  // Check actual columns on vw_RestaurantOrderDetail  
  console.log("\n=== Actual columns returned by vw_RestaurantOrderDetail ===");
  const res2 = await pool.request().query(`SELECT TOP 1 * FROM vw_RestaurantOrderDetail`);
  console.log(Object.keys(res2.recordset[0] || {}));

  // Check RestaurantOrderDetailCur actual columns
  console.log("\n=== RestaurantOrderDetailCur actual columns in DB ===");
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetailCur'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(cols.recordset);

  // Check RestaurantOrderDetail actual columns
  console.log("\n=== RestaurantOrderDetail actual columns in DB ===");
  const cols2 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetail'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(cols2.recordset);

  // The DiscountAmount/DiscountType in vw_RestaurantOrderDetailCur might be 
  // aliased differently (because view uses OD.* which includes DishGroupId from DishGroup join)
  // Let's check if the view has column name conflicts
  console.log("\n=== Test direct column access on vw_RestaurantOrderDetailCur ===");
  try {
    const t1 = await pool.request().query(`SELECT TOP 1 DiscountAmount FROM vw_RestaurantOrderDetailCur`);
    console.log("DiscountAmount OK:", t1.recordset[0]);
  } catch(e) { console.log("DiscountAmount ERROR:", e.message); }

  try {
    const t2 = await pool.request().query(`SELECT TOP 1 DiscountType FROM vw_RestaurantOrderDetailCur`);
    console.log("DiscountType OK:", t2.recordset[0]);
  } catch(e) { console.log("DiscountType ERROR:", e.message); }

  // Check if it's ambiguous - DishGroupId appears in OD.* AND DishGroup.*
  console.log("\n=== DishGroup columns (possible conflicts with RestaurantOrderDetailCur) ===");
  const dg = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DishGroupMaster'
    ORDER BY ORDINAL_POSITION
  `);
  console.log("DishGroupMaster cols:", dg.recordset.map(r => r.COLUMN_NAME));

  await pool.close();
}

check().catch(console.error);
