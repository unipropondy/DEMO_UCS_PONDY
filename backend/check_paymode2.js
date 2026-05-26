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

  // Full Vw_Paymodesales definition
  console.log("\n=== Vw_Paymodesales FULL DEFINITION ===");
  const vDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('Vw_Paymodesales')) AS def
  `);
  console.log(vDef.recordset[0]?.def || "NOT FOUND");

  // Check what vw_paymentdetail InvoiceDate looks like
  console.log("\n=== vw_PaymentDetail sample (InvoiceDate) ===");
  try {
    const vpd = await pool.request().query(`
      SELECT TOP 5 
        OrderId, BillNumber, InvoiceDate, PayModeName, PayMode, CollectedAmount,
        PaymentCollectedOn
      FROM vw_PaymentDetail
      ORDER BY PaymentCollectedOn DESC
    `);
    console.table(vpd.recordset);
  } catch(e) {
    console.log("Error querying vw_PaymentDetail:", e.message);
  }

  // Check RestaurantInvoice.InvoiceDate - is it a DATE or DATETIME?
  console.log("\n=== RestaurantInvoice InvoiceDate column type ===");
  const riCol = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantInvoice' AND COLUMN_NAME = 'InvoiceDate'
  `);
  console.table(riCol.recordset);

  // Check all columns of Vw_Paymodesales
  console.log("\n=== Vw_Paymodesales columns ===");
  const vCols = await pool.request().query(`
    SELECT TOP 1 * FROM Vw_Paymodesales
  `);
  if (vCols.recordset.length > 0) {
    console.log("Columns:", Object.keys(vCols.recordset[0]));
    console.log("Sample row:", vCols.recordset[0]);
  }

  // Look for what view Vw_Paymodesales depends on
  console.log("\n=== Views that Vw_Paymodesales depends on ===");
  const deps = await pool.request().query(`
    SELECT DISTINCT OBJECT_NAME(d.referenced_id) AS ReferencedObject
    FROM sys.sql_expression_dependencies d
    WHERE OBJECT_NAME(d.referencing_id) = 'Vw_Paymodesales'
  `);
  console.table(deps.recordset);

  await pool.close();
}

check().catch(console.error);
