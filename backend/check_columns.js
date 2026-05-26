const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

async function check() {
  try {
    const pool = await sql.connect(dbConfig);
    
    // Check object type
    const objectType = await pool.request().query(`
      SELECT name, type_desc 
      FROM sys.objects 
      WHERE name = 'Vw_MonthwiseSales'
    `);
    console.log("Object Type Info:");
    console.table(objectType.recordset);

    if (objectType.recordset.length > 0) {
      const type = objectType.recordset[0].type_desc;
      if (type === 'VIEW') {
        const viewDef = await pool.request().query(`
          SELECT OBJECT_DEFINITION(OBJECT_ID('Vw_MonthwiseSales')) AS definition
        `);
        console.log("\n--- VIEW DEFINITION ---");
        console.log(viewDef.recordset[0]?.definition);
      } else {
        const columns = await pool.request().query(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'Vw_MonthwiseSales'
          ORDER BY COLUMN_NAME
        `);
        console.log("\n--- COLUMNS FOR Vw_MonthwiseSales ---");
        console.table(columns.recordset);
      }
    } else {
      console.log("Vw_MonthwiseSales not found in sys.objects.");
    }
    
    await pool.close();
  } catch (err) {
    console.error(err);
  }
}

check();
