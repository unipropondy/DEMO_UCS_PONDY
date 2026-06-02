const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { sql, poolPromise } = require("./config/db");

async function killOrphans() {
  console.log("🔍 [Cleanup] Connecting to database...");
  const pool = await poolPromise;
  if (!pool || !pool.connected) {
    console.error("❌ [Cleanup] Failed to connect to database pool.");
    process.exit(1);
  }

  console.log("🔍 [Cleanup] Querying open transactions and blocked sessions...");
  
  // Find all user sessions that have open transactions (excluding current query execution)
  const result = await pool.request().query(`
    SELECT DISTINCT
        s.session_id AS SessionID,
        s.login_name AS LoginName,
        s.host_name AS HostName,
        s.program_name AS ProgramName,
        s.status AS SessionStatus,
        DATEDIFF(second, dt.database_transaction_begin_time, GETDATE()) AS TxDurationSeconds
    FROM sys.dm_tran_session_transactions st
    JOIN sys.dm_exec_sessions s ON st.session_id = s.session_id
    JOIN sys.dm_tran_database_transactions dt ON st.transaction_id = dt.transaction_id
    WHERE s.is_user_process = 1 AND s.session_id <> @@SPID;
  `);

  const sessions = result.recordset || [];
  console.log(`🔍 [Cleanup] Found ${sessions.length} sessions with open transactions.`);

  if (sessions.length === 0) {
    console.log("✅ [Cleanup] No active orphan transactions found.");
    process.exit(0);
  }

  for (const session of sessions) {
    console.log(`\n⚠️ [Cleanup] Session ID: ${session.SessionID} | Host: ${session.HostName} | Program: ${session.ProgramName} | Status: ${session.SessionStatus} | Duration: ${session.TxDurationSeconds}s`);
    
    // Kill the session
    console.log(`🔥 [Cleanup] Killing session ${session.SessionID}...`);
    try {
      await pool.request().query(`KILL ${session.SessionID}`);
      console.log(`✅ [Cleanup] Session ${session.SessionID} successfully killed.`);
    } catch (killErr) {
      console.error(`❌ [Cleanup] Failed to kill session ${session.SessionID}:`, killErr.message);
    }
  }

  console.log("\n✅ [Cleanup] Orphan cleanup complete.");
  process.exit(0);
}

killOrphans();
