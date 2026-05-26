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

  // Full definition
  const vDef = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('Vw_Paymodesales')) AS def
  `);
  console.log("=== FULL Vw_Paymodesales DEFINITION ===");
  console.log(vDef.recordset[0]?.def);

  // Check SettlementHeader - does it have InvoiceDate / LastDayEndDate?
  console.log("\n=== SettlementHeader columns ===");
  const shCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SettlementHeader'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(shCols.recordset);

  // Check sample of SettlementHeader LastDayEndDate
  console.log("\n=== SettlementHeader sample (LastDayEndDate, LastSettlementDate) ===");
  const shSample = await pool.request().query(`
    SELECT TOP 5 SettlementID, BillNo, LastSettlementDate, LastDayEndDate, 
      CAST(LastSettlementDate AS DATE) AS SettlementDateOnly
    FROM SettlementHeader
    ORDER BY LastSettlementDate DESC
  `);
  console.table(shSample.recordset);

  await pool.close();
}

check().catch(console.error);
