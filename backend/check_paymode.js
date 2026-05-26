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

  // 1. View definition
  console.log("\n=== Vw_Paymodesales DEFINITION ===");
  const vDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('Vw_Paymodesales')) AS def
  `);
  console.log(vDef.recordset[0]?.def || "NOT FOUND");

  // 2. Sample data
  console.log("\n=== Sample from Vw_Paymodesales (last 10) ===");
  try {
    const sample = await pool.request().query(`
      SELECT TOP 10 * FROM Vw_Paymodesales ORDER BY InvoiceDate DESC
    `);
    console.table(sample.recordset);
  } catch(e) {
    console.log("Error:", e.message);
    // Try without ORDER BY if InvoiceDate is null issue
    const sample2 = await pool.request().query(`SELECT TOP 10 * FROM Vw_Paymodesales`);
    console.table(sample2.recordset);
  }

  // 3. Check what tables it joins and their InvoiceDate values
  console.log("\n=== RestaurantInvoice sample (InvoiceDate col) ===");
  const ri = await pool.request().query(`
    SELECT TOP 5 OrderId, BillNumber, InvoiceDate, StatusCode, CreatedOn 
    FROM RestaurantInvoice 
    ORDER BY CreatedOn DESC
  `);
  console.table(ri.recordset);

  // 4. Check PaymentDetail
  console.log("\n=== PaymentDetail sample ===");
  const pd = await pool.request().query(`
    SELECT TOP 5 PaymentId, OrderId, RestaurantBillId, PaymentCollectedOn, Amount
    FROM PaymentDetail 
    ORDER BY CreatedOn DESC
  `);
  console.table(pd.recordset);

  // 5. Check vw_paymentdetail if it exists
  console.log("\n=== vw_paymentdetail definition (if exists) ===");
  const pvDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('vw_paymentdetail')) AS def
  `);
  console.log(pvDef.recordset[0]?.def || "NOT FOUND");

  await pool.close();
}

check().catch(console.error);
