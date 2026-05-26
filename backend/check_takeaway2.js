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

  // 1. What does RestaurantOrder.IsTakeAway look like?
  console.log("\n=== RestaurantOrder IsTakeAway distribution ===");
  const headerDist = await pool.request().query(`
    SELECT 
      IsTakeAway, 
      COUNT(*) as Count,
      MAX(OrderDateTime) as LatestOrder
    FROM RestaurantOrder
    GROUP BY IsTakeAway
    ORDER BY IsTakeAway
  `);
  console.table(headerDist.recordset);

  // 2. Check RestaurantOrderCur distribution
  console.log("\n=== RestaurantOrderCur IsTakeAway distribution ===");
  const curDist = await pool.request().query(`
    SELECT 
      IsTakeAway, 
      COUNT(*) as Count,
      MAX(OrderDateTime) as LatestOrder
    FROM RestaurantOrderCur
    GROUP BY IsTakeAway
    ORDER BY IsTakeAway
  `);
  console.table(curDist.recordset);

  // 3. Check any orders that look like takeaway (TAKEAWAY table number or null table)
  console.log("\n=== RestaurantOrder rows that look like takeaway (Tableno) ===");
  const looksTakeaway = await pool.request().query(`
    SELECT TOP 10 OrderId, OrderNumber, Tableno, IsTakeAway, OrderDateTime
    FROM RestaurantOrder
    WHERE Tableno IS NULL OR Tableno = 'TAKEAWAY' OR Tableno = ''
    ORDER BY OrderDateTime DESC
  `);
  console.table(looksTakeaway.recordset);

  // 4. Check the ones in RestaurantOrderCur (active orders)
  console.log("\n=== RestaurantOrderCur rows that look like takeaway ===");
  const curTakeaway = await pool.request().query(`
    SELECT TOP 10 OrderId, OrderNumber, Tableno, IsTakeAway, OrderDateTime
    FROM RestaurantOrderCur
    WHERE Tableno IS NULL OR Tableno = 'TAKEAWAY' OR Tableno = ''
    ORDER BY OrderDateTime DESC
  `);
  console.table(curTakeaway.recordset);

  // 5. Check what orderType values look like in SettlementHeader
  console.log("\n=== SettlementHeader OrderType distribution ===");
  const settleDist = await pool.request().query(`
    SELECT OrderType, COUNT(*) as Count
    FROM SettlementHeader
    GROUP BY OrderType
    ORDER BY OrderType
  `);
  console.table(settleDist.recordset);

  await pool.close();
}

check().catch(console.error);
