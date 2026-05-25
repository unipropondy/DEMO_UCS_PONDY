const { poolPromise } = require("./config/db");

async function main() {
  try {
    const pool = await poolPromise;
    console.log("--- ACTIVE CATEGORIES IN CategoryMaster ---");
    const activeCats = await pool.request().query(`
      SELECT CategoryId, CategoryCode, CategoryName, IsActive 
      FROM CategoryMaster 
      WHERE IsActive = 1
    `);
    console.table(activeCats.recordset);

    console.log("--- MAPPINGS IN CategoryKitchenType FOR ACTIVE CATEGORIES ---");
    const mappings = await pool.request().query(`
      SELECT cm.CategoryId, cm.CategoryName, ckt.KitchenTypeCode, ckt.KitchenTypeName
      FROM CategoryMaster cm
      LEFT JOIN CategoryKitchenType ckt ON cm.CategoryId = ckt.CategoryId
      WHERE cm.IsActive = 1
    `);
    console.table(mappings.recordset);

    console.log("--- PRINTMASTER RECORDS ---");
    const pm = await pool.request().query(`
      SELECT PrinterId, PrinterName, PrinterPath, PrinterType, KitchenTypeValue, KitchenTypeName, IsActive 
      FROM PrintMaster
    `);
    console.table(pm.recordset);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
main();
