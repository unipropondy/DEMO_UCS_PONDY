const sql = require("mssql");
const { poolPromise } = require("../config/db");

let cachedHoldOvertimeMinutes = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 60 seconds cache TTL

async function getHoldOvertimeMinutes() {
  const now = Date.now();
  if (cachedHoldOvertimeMinutes !== null && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedHoldOvertimeMinutes;
  }

  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const result = await pool.request().query("SELECT TOP 1 HoldOvertimeMinutes FROM CompanySettings WITH (NOLOCK)");
      if (result.recordset.length > 0) {
        cachedHoldOvertimeMinutes = result.recordset[0].HoldOvertimeMinutes || 30;
      } else {
        cachedHoldOvertimeMinutes = 30;
      }
      lastFetchTime = now;
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching HoldOvertimeMinutes:", err.message);
    if (cachedHoldOvertimeMinutes === null) {
      return 30; // Return default if not yet cached
    }
  }

  return cachedHoldOvertimeMinutes;
}

function invalidateCache() {
  cachedHoldOvertimeMinutes = null;
  lastFetchTime = 0;
}

module.exports = {
  getHoldOvertimeMinutes,
  invalidateCache
};
