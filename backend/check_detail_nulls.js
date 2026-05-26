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

  // 1. Full column analysis of RestaurantOrderDetail with null counts
  console.log("\n=== RestaurantOrderDetail NULL count per column ===");
  const rodCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetail' ORDER BY ORDINAL_POSITION
  `);
  const cols1 = rodCols.recordset.map(c => c.COLUMN_NAME);
  const totalRes1 = await pool.request().query(`SELECT COUNT(*) as Total FROM RestaurantOrderDetail`);
  const total1 = totalRes1.recordset[0].Total;
  console.log(`Total rows: ${total1}`);
  
  for (const col of cols1) {
    try {
      const r = await pool.request().query(`SELECT COUNT(*) as NullCount FROM RestaurantOrderDetail WHERE [${col}] IS NULL`);
      const nullCount = r.recordset[0].NullCount;
      if (nullCount > 0) console.log(`  ${col}: ${nullCount} NULLs (${((nullCount/total1)*100).toFixed(1)}%)`);
    } catch(e) {}
  }

  // 2. Full column analysis of RestaurantOrderDetailCur with null counts
  console.log("\n=== RestaurantOrderDetailCur NULL count per column ===");
  const rodcCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RestaurantOrderDetailCur' ORDER BY ORDINAL_POSITION
  `);
  const cols2 = rodcCols.recordset.map(c => c.COLUMN_NAME);
  const totalRes2 = await pool.request().query(`SELECT COUNT(*) as Total FROM RestaurantOrderDetailCur`);
  const total2 = totalRes2.recordset[0].Total;
  console.log(`Total rows: ${total2}`);

  for (const col of cols2) {
    try {
      const r = await pool.request().query(`SELECT COUNT(*) as NullCount FROM RestaurantOrderDetailCur WHERE [${col}] IS NULL`);
      const nullCount = r.recordset[0].NullCount;
      if (nullCount > 0) console.log(`  ${col}: ${nullCount} NULLs (${((nullCount/total2)*100).toFixed(1)}%)`);
    } catch(e) {}
  }

  // 3. Sample with DishCode join
  console.log("\n=== RestaurantOrderDetail - fields that should NOT be null ===");
  const sample = await pool.request().query(`
    SELECT TOP 5
      d.OrderDetailId,
      d.DishId,
      d.DishName,
      d.isTakeAway,
      d.DiscountAmount,
      d.DiscountType,
      d.ManualDiscountAmount,
      d.BaseAmount,
      d.SeqNo,
      d.OrderConfirmQty,
      d.VoidReason,
      dm.DishCode,
      dm.Name AS DishMasterName
    FROM RestaurantOrderDetail d
    LEFT JOIN DishMaster dm ON d.DishId = dm.DishId
    ORDER BY d.CreatedOn DESC
  `);
  console.table(sample.recordset);

  // 4. Check what columns RestaurantOrderDetailCur has that ROD doesn't and vice versa
  console.log("\n=== Columns in RestaurantOrderDetailCur but NOT in RestaurantOrderDetail ===");
  const inCurNotHist = cols2.filter(c => !cols1.includes(c));
  console.log(inCurNotHist);

  console.log("\n=== Columns in RestaurantOrderDetail but NOT in RestaurantOrderDetailCur ===");
  const inHistNotCur = cols1.filter(c => !cols2.includes(c));
  console.log(inHistNotCur);

  // 5. Check DishMaster for key columns
  console.log("\n=== DishMaster sample (DishCode, ShortName) ===");
  const dm = await pool.request().query(`
    SELECT TOP 5 DishId, Name, DishCode, ShortName, DishGroupId FROM DishMaster ORDER BY Name
  `);
  console.table(dm.recordset);

  // 6. What does vw_RestaurantOrderDetailCur actually show for current orders?
  console.log("\n=== vw_RestaurantOrderDetailCur sample - checking null cols ===");
  const vcur = await pool.request().query(`
    SELECT TOP 5
      v.OrderDetailId, v.DishId, v.DishName, v.DishCode, 
      v.isTakeAway, v.DiscountAmount, v.DiscountType,
      v.ManualDiscountAmount, v.BaseAmount,
      v.KitchenTypeName, v.DishGroupName, v.StatusCodeName
    FROM vw_RestaurantOrderDetailCur v
    ORDER BY v.CreatedOn DESC
  `);
  console.table(vcur.recordset);

  await pool.close();
}

check().catch(console.error);
