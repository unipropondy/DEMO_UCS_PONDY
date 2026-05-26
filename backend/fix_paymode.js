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

  console.log("=== BACKFILL: SettlementHeader.LastDayEndDate ===\n");

  // Count null rows
  const countRes = await pool.request().query(`
    SELECT COUNT(*) as NullCount FROM SettlementHeader WHERE LastDayEndDate IS NULL
  `);
  console.log(`Rows with NULL LastDayEndDate: ${countRes.recordset[0].NullCount}`);

  // Backfill: set LastDayEndDate = CAST(LastSettlementDate AS DATE) for existing rows
  const updateRes = await pool.request().query(`
    UPDATE SettlementHeader
    SET LastDayEndDate = CAST(LastSettlementDate AS DATE)
    WHERE LastDayEndDate IS NULL AND LastSettlementDate IS NOT NULL
  `);
  console.log(`✅ Updated rows: ${updateRes.rowsAffected[0]}`);

  // Verify Vw_Paymodesales now has dates
  console.log("\n=== Vw_Paymodesales after fix ===");
  const verify = await pool.request().query(`
    SELECT TOP 10 
      Invoicedate, ItemSales, Cash, Nets, Totcollect
    FROM Vw_Paymodesales
    ORDER BY Invoicedate DESC
  `);
  console.table(verify.recordset);

  // Summary
  const summary = await pool.request().query(`
    SELECT 
      COUNT(*) as TotalRows,
      SUM(CASE WHEN Invoicedate IS NULL THEN 1 ELSE 0 END) as NullDates,
      SUM(CASE WHEN Invoicedate IS NOT NULL THEN 1 ELSE 0 END) as ValidDates
    FROM Vw_Paymodesales
  `);
  console.log("\n=== Summary ===");
  console.table(summary.recordset);

  await pool.close();
  console.log("\nDone!");
}

fix().catch(console.error);
