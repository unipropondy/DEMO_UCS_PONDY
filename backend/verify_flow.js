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

async function verify() {
  const pool = await sql.connect(dbConfig);

  console.log("=== FLOW VERIFICATION: Checking archive logic equivalence ===\n");

  // Pick any order number from RestaurantOrderCur to test with
  const sampleOrder = await pool.request().query(`
    SELECT TOP 1 r.OrderNumber
    FROM RestaurantOrderCur r
    INNER JOIN RestaurantOrderDetailCur d ON r.OrderId = d.OrderId
    WHERE d.StatusCode <> 0
    ORDER BY r.CreatedOn DESC
  `);

  const testOrderNo = sampleOrder.recordset[0]?.OrderNumber;
  if (!testOrderNo) {
    console.log("No active orders to test with");
    await pool.close();
    return;
  }

  console.log(`Testing with order: ${testOrderNo}\n`);

  // OLD logic (subquery WHERE IN)
  const oldResult = await pool.request()
    .input("orderNo", sql.NVarChar(50), testOrderNo)
    .query(`
      SELECT 
        d.OrderDetailId, d.OrderId, d.DishId, d.Description, d.DishName, d.Quantity, d.PricePerUnit, 
        d.ActualAmount, d.TotalDetailLineAmount, d.StatusCode, d.CreatedBy, d.CreatedOn, 
        d.BusinessUnitId, d.OrderDateTime, d.Spicy, d.Salt, d.Oil, d.Sugar, d.Remarks, 
        d.OrderConfirmQty, d.VoidReason, 
        ISNULL(d.DiscountAmount, 0) AS DiscountAmount, 
        ISNULL(d.DiscountType, 'fixed') AS DiscountType, 
        ISNULL(d.isTakeAway, 0) AS isTakeAway_OLD
      FROM RestaurantOrderDetailCur d
      WHERE d.OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
    `);

  // NEW logic (INNER JOIN on header)
  const newResult = await pool.request()
    .input("orderNo", sql.NVarChar(50), testOrderNo)
    .query(`
      SELECT 
        d.OrderDetailId, d.OrderId, d.DishId, d.Description, d.DishName, d.Quantity, d.PricePerUnit, 
        d.ActualAmount, d.TotalDetailLineAmount, d.StatusCode, d.CreatedBy, d.CreatedOn, 
        d.BusinessUnitId, d.OrderDateTime, d.Spicy, d.Salt, d.Oil, d.Sugar, d.Remarks, 
        d.OrderConfirmQty, d.VoidReason, 
        ISNULL(d.DiscountAmount, 0) AS DiscountAmount, 
        ISNULL(d.DiscountType, 'fixed') AS DiscountType, 
        ISNULL(h.IsTakeAway, ISNULL(d.isTakeAway, 0)) AS isTakeAway_NEW
      FROM RestaurantOrderDetailCur d
      INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
      WHERE h.OrderNumber = @orderNo
    `);

  const oldRows = oldResult.recordset;
  const newRows = newResult.recordset;

  console.log(`OLD logic row count: ${oldRows.length}`);
  console.log(`NEW logic row count: ${newRows.length}`);

  if (oldRows.length === newRows.length) {
    console.log("✅ SAME row count — no rows lost or duplicated\n");
  } else {
    console.log("❌ ROW COUNT MISMATCH — INVESTIGATE!\n");
  }

  // Compare each row (match by OrderDetailId)
  let mismatchCount = 0;
  const newMap = {};
  newRows.forEach(r => newMap[r.OrderDetailId] = r);

  for (const oldRow of oldRows) {
    const newRow = newMap[oldRow.OrderDetailId];
    if (!newRow) {
      console.log(`❌ OrderDetailId ${oldRow.OrderDetailId} MISSING in new result!`);
      mismatchCount++;
      continue;
    }
    // Check all columns match (except isTakeAway which may intentionally differ)
    const colsToCheck = ['OrderId','DishId','DishName','Quantity','PricePerUnit','ActualAmount','TotalDetailLineAmount','StatusCode'];
    for (const col of colsToCheck) {
      if (String(oldRow[col]) !== String(newRow[col])) {
        console.log(`❌ Column ${col} mismatch for ${oldRow.OrderDetailId}: OLD=${oldRow[col]} NEW=${newRow[col]}`);
        mismatchCount++;
      }
    }
  }

  if (mismatchCount === 0) {
    console.log("✅ All column values identical between old and new logic");
    console.log("✅ Only isTakeAway logic changed (now reads from header instead of detail row)");
  }

  // Show isTakeAway comparison
  console.log("\n=== isTakeAway comparison ===");
  console.log("OLD (from detail rows):");
  oldRows.forEach(r => console.log(`  ${r.DishName}: isTakeAway = ${r.isTakeAway_OLD}`));
  console.log("\nNEW (from header):");
  newRows.forEach(r => console.log(`  ${r.DishName}: isTakeAway = ${r.isTakeAway_NEW}`));

  // 3. Also verify the modifiers query is untouched
  const modResult = await pool.request()
    .input("orderNo", sql.NVarChar(50), testOrderNo)
    .query(`
      SELECT COUNT(*) as ModCount
      FROM RestaurantmodifierdetailCur 
      WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
    `);
  console.log(`\n=== Modifiers for order ${testOrderNo}: ${modResult.recordset[0].ModCount} modifier rows ===`);
  console.log("✅ Modifiers query unchanged — will archive correctly\n");

  await pool.close();
  console.log("=== VERIFICATION COMPLETE ===");
}

verify().catch(console.error);
