const { poolPromise } = require("./config/db");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Connected to database successfully.\n");

    const query = `
      SELECT DishId, Name, IsOpenItem, isServiceCharge, IsActive 
      FROM DishMaster 
      WHERE Name LIKE '%crab%' OR Name LIKE '%noodle%'
    `;

    const res = await pool.request().query(query);
    console.log(JSON.stringify(res.recordset, null, 2));

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();
