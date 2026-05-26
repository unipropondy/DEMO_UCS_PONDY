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

  // 1. Check if RestaurantOrderDetailCur has isTakeAway column
  console.log("\n=== RestaurantOrderDetailCur columns ===");
  const rodcCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'RestaurantOrderDetailCur'
    ORDER BY COLUMN_NAME
  `);
  console.table(rodcCols.recordset);

  // 2. Sample - check if isTakeAway is set in detail cur table
  console.log("\n=== Sample RestaurantOrderDetailCur isTakeAway values ===");
  const detailSample = await pool.request().query(`
    SELECT TOP 10 
      d.OrderDetailId, d.DishName, d.isTakeAway as DetailIsTakeAway,
      h.IsTakeAway as HeaderIsTakeAway, h.OrderNumber
    FROM RestaurantOrderDetailCur d
    JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
    ORDER BY d.CreatedOn DESC
  `);
  console.table(detailSample.recordset);

  // 3. Sample - check RestaurantOrderDetail isTakeAway (historical)
  console.log("\n=== Sample RestaurantOrderDetail (historical) isTakeAway values ===");
  const histSample = await pool.request().query(`
    SELECT TOP 10 
      d.OrderDetailId, d.DishName, d.isTakeAway as DetailIsTakeAway,
      h.IsTakeAway as HeaderIsTakeAway, h.OrderNumber
    FROM RestaurantOrderDetail d
    JOIN RestaurantOrder h ON d.OrderId = h.OrderId
    ORDER BY d.CreatedOn DESC
  `);
  console.table(histSample.recordset);

  // 4. Check the vw_RestaurantInvoiceForDishwiseSales definition fully
  console.log("\n=== Full vw_RestaurantInvoiceForDishwiseSales DEFINITION ===");
  const vDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('vw_RestaurantInvoiceForDishwiseSales')) AS def
  `);
  console.log(vDef.recordset[0]?.def || "NOT FOUND");

  await pool.close();
}

check().catch(console.error);
