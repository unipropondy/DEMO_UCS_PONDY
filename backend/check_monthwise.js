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

  // 1. Get definition of vw_RestaurantInvoiceForDishwiseSales
  console.log("\n=== vw_RestaurantInvoiceForDishwiseSales DEFINITION ===");
  const vDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('vw_RestaurantInvoiceForDishwiseSales')) AS def
  `);
  console.log(vDef.recordset[0]?.def || "NOT FOUND");

  // 2. Check RestaurantOrderDetail columns (isTakeAway)
  console.log("\n=== RestaurantOrderDetail columns (takeaway related) ===");
  const rodCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'RestaurantOrderDetail'
      AND COLUMN_NAME LIKE '%[Tt]ake%'
    ORDER BY COLUMN_NAME
  `);
  console.table(rodCols.recordset);

  // 3. Check RestaurantOrder columns (isTakeAway)
  console.log("\n=== RestaurantOrder columns (takeaway related) ===");
  const roCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'RestaurantOrder'
      AND COLUMN_NAME LIKE '%[Tt]ake%'
    ORDER BY COLUMN_NAME
  `);
  console.table(roCols.recordset);

  // 4. Check RestaurantOrderCur columns (isTakeAway)
  console.log("\n=== RestaurantOrderCur columns (takeaway related) ===");
  const rocCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'RestaurantOrderCur'
      AND COLUMN_NAME LIKE '%[Tt]ake%'
    ORDER BY COLUMN_NAME
  `);
  console.table(rocCols.recordset);

  // 5. Sample rows from Vw_MonthwiseSales with isTakeAway
  console.log("\n=== Sample from Vw_MonthwiseSales (last 5, isTakeAway column) ===");
  try {
    const sample = await pool.request().query(`
      SELECT TOP 5 OrderId, DishName, isTakeAway, InvoiceDate, TotalAmount
      FROM Vw_MonthwiseSales
      ORDER BY InvoiceDate DESC
    `);
    console.table(sample.recordset);
  } catch(e) {
    console.log("Error querying Vw_MonthwiseSales:", e.message);
  }

  // 6. Check what columns Vw_MonthwiseSales exposes
  console.log("\n=== Vw_MonthwiseSales COLUMNS via ROD ===");
  const vCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'RestaurantOrderDetail'
    ORDER BY COLUMN_NAME
  `);
  console.table(vCols.recordset);

  // 7. Check vw_dishwisesales
  console.log("\n=== vw_dishwisesales or vw_Dishsalesreport DEFINITION ===");
  const dvDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('vw_Dishsalesreport')) AS def
  `);
  console.log(dvDef.recordset[0]?.def || "NOT FOUND");

  await pool.close();
}

check().catch(console.error);
