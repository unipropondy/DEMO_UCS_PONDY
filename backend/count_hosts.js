const { poolPromise } = require("./config/db");

async function countHosts() {
  try {
    const pool = await poolPromise;
    if (!pool) {
      console.error("Could not connect to database.");
      return;
    }

    const result = await pool.request().query(`
      SELECT 
        hostname AS HostName,
        program_name AS ProgramName,
        status AS Status,
        COUNT(*) AS ConnectionCount
      FROM sys.sysprocesses
      GROUP BY hostname, program_name, status
      ORDER BY ConnectionCount DESC;
    `);

    console.log("=== CONNECTIONS BY HOST AND PROGRAM ===");
    console.table(result.recordset.map(row => ({
      HostName: row.HostName?.trim(),
      ProgramName: row.ProgramName?.trim(),
      Status: row.Status?.trim(),
      Count: row.ConnectionCount
    })));

  } catch (err) {
    console.error("Error counting hosts:", err.message);
  } finally {
    process.exit(0);
  }
}

countHosts();
