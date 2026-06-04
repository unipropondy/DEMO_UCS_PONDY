/**
 * ============================================================
 *  UCS PONDY — INFRASTRUCTURE BOTTLENECK DIAGNOSTIC TOOL
 *  Run: node diagnose_bottleneck.js
 *  Output: bottleneck_report.json + console summary
 * ============================================================
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const net  = require("net");
const dns  = require("dns").promises;
const http = require("http");
const os   = require("os");
const sql  = require("mssql");

// ── config ────────────────────────────────────────────────────
const DB_SERVER   = process.env.DB_SERVER;
const DB_PORT     = parseInt(process.env.DB_PORT, 10) || 1433;
const DB_USER     = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME     = process.env.DB_NAME;

const LOCAL_API   = "http://localhost:3000";
const LATENCY_SAMPLES = 10;      // TCP ping samples
const QUERY_RUNS      = 5;       // query repetitions for average

// ── helpers ───────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const avg   = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const min   = (arr) => Math.min(...arr);
const max   = (arr) => Math.max(...arr);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function color(code, text) {
  const codes = { red: 31, yellow: 33, green: 32, cyan: 36, bold: 1, reset: 0 };
  return `\x1b[${codes[code]}m${text}\x1b[0m`;
}

function rating(value, good, warn) {
  if (value <= good) return color("green",  "✅ GOOD");
  if (value <= warn) return color("yellow", "⚠️  WARN");
  return color("red",    "🔴 CRITICAL");
}

// ── 1. DNS resolution time ────────────────────────────────────
async function measureDNS() {
  console.log("\n🔍 [1/7] Resolving DNS for SQL Server host...");
  const start = Date.now();
  try {
    const addrs = await dns.lookup(DB_SERVER, { all: true });
    const dnsMs = Date.now() - start;
    console.log(`   Host: ${DB_SERVER} → ${addrs.map(a => a.address).join(", ")}`);
    console.log(`   DNS resolution: ${dnsMs}ms  ${rating(dnsMs, 20, 100)}`);
    return { dnsMs, resolved: addrs[0]?.address || DB_SERVER };
  } catch (e) {
    console.log(color("red", `   DNS FAILED: ${e.message}`));
    return { dnsMs: null, resolved: DB_SERVER, error: e.message };
  }
}

// ── 2. TCP latency (raw network) ─────────────────────────────
async function measureTCPLatency(host, port, samples = LATENCY_SAMPLES) {
  console.log(`\n🏓 [2/7] TCP Latency → ${host}:${port} (${samples} samples)...`);
  const times = [];
  for (let i = 0; i < samples; i++) {
    await new Promise((resolve) => {
      const t0     = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.connect(port, host, () => {
        times.push(Date.now() - t0);
        socket.destroy();
        resolve();
      });
      socket.on("error",   () => { times.push(null); resolve(); });
      socket.on("timeout", () => { socket.destroy(); times.push(null); resolve(); });
    });
    await sleep(100);
  }

  const valid = times.filter((t) => t !== null);
  if (valid.length === 0) {
    console.log(color("red", "   ❌ All TCP connection attempts failed!"));
    return { avgMs: null, minMs: null, maxMs: null, failures: samples };
  }

  const result = {
    avgMs:    round(avg(valid)),
    minMs:    min(valid),
    maxMs:    max(valid),
    failures: times.length - valid.length,
    samples:  valid.length,
  };

  console.log(`   Avg: ${result.avgMs}ms  Min: ${result.minMs}ms  Max: ${result.maxMs}ms  Failures: ${result.failures}/${samples}`);
  console.log(`   Rating: ${rating(result.avgMs, 5, 30)}`);
  return result;
}

// ── 3. SQL query benchmarks ───────────────────────────────────
const QUERIES = [
  {
    name: "Ping (SELECT 1)",
    sql:  "SELECT 1 AS pong",
  },
  {
    name: "TableMaster (live state)",
    sql:  "SELECT TableId, Status, TotalAmount, CurrentOrderId FROM TableMaster WITH (NOLOCK)",
  },
  {
    name: "Active cart (RestaurantOrderCur)",
    sql:  `SELECT TOP 50 OrderId, Tableno, TotalAmount, isOrderClosed
           FROM RestaurantOrderCur WITH (NOLOCK)
           WHERE isOrderClosed = 0 OR isOrderClosed IS NULL`,
  },
  {
    name: "Menu load (DishMaster)",
    sql:  `SELECT d.DishId, d.Name, d.Price, dg.DishGroupName, c.CategoryName
           FROM DishMaster d WITH (NOLOCK)
           LEFT JOIN DishGroupMaster dg WITH (NOLOCK) ON d.DishGroupId = dg.DishGroupId
           LEFT JOIN CategoryMaster  c  WITH (NOLOCK) ON dg.CategoryId = c.CategoryId
           WHERE d.Isactive = 1`,
  },
  {
    name: "Sales report (SettlementHeader TOP 200)",
    sql:  `SELECT TOP 200 sh.SettlementID, sh.LastSettlementDate, sh.SysAmount,
                  sts.PayMode
           FROM SettlementHeader sh WITH (NOLOCK)
           LEFT JOIN SettlementTotalSales sts WITH (NOLOCK) ON sh.SettlementID = sts.SettlementID
           ORDER BY sh.LastSettlementDate DESC`,
  },
  {
    name: "DMV: CPU + Memory snapshot",
    sql:  `SELECT
             record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]','int')
               AS sql_cpu_utilization,
             record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]','int')
               + record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]','int')
               AS combined,
             100 - record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]','int')
               AS total_cpu_utilization
           FROM (
             SELECT TOP 1 CONVERT(XML, record) AS record
             FROM sys.dm_os_ring_buffers
             WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
               AND record LIKE '%<SystemHealth>%'
             ORDER BY timestamp DESC
           ) AS t`,
    isDMV: true,
  },
  {
    name: "DMV: Memory usage (MB)",
    sql:  `SELECT
             physical_memory_in_use_kb / 1024.0  AS memory_used_mb,
             page_fault_count,
             memory_utilization_percentage
           FROM sys.dm_os_process_memory`,
    isDMV: true,
  },
  {
    name: "DMV: Disk I/O (top 5 tables by reads)",
    sql:  `SELECT TOP 5
             OBJECT_NAME(ios.object_id, ios.database_id) AS table_name,
             ios.leaf_physical_reads   AS physical_reads,
             ios.leaf_logical_reads    AS logical_reads,
             ios.leaf_physical_writes  AS physical_writes
           FROM sys.dm_db_index_operational_stats(DB_ID(), NULL, NULL, NULL) ios
           ORDER BY ios.leaf_physical_reads DESC`,
    isDMV: true,
  },
  {
    name: "DMV: Connection pool & active sessions",
    sql:  `SELECT
             COUNT(*) AS total_sessions,
             SUM(CASE WHEN status = 'running'  THEN 1 ELSE 0 END) AS active_sessions,
             SUM(CASE WHEN status = 'sleeping' THEN 1 ELSE 0 END) AS sleeping_sessions,
             SUM(CASE WHEN wait_type IS NOT NULL AND wait_type <> '' THEN 1 ELSE 0 END) AS waiting_sessions
           FROM sys.dm_exec_sessions
           WHERE is_user_process = 1`,
    isDMV: true,
  },
  {
    name: "DMV: Top slow queries (avg elapsed > 100ms)",
    sql:  `SELECT TOP 10
             SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
               ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
                 ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text,
             qs.execution_count,
             qs.total_elapsed_time / qs.execution_count / 1000.0 AS avg_elapsed_ms,
             qs.total_logical_reads / qs.execution_count          AS avg_logical_reads,
             qs.total_worker_time   / qs.execution_count / 1000.0 AS avg_cpu_ms
           FROM sys.dm_exec_query_stats qs
           CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
           WHERE qs.execution_count > 1
             AND qs.total_elapsed_time / qs.execution_count > 100000
           ORDER BY qs.total_elapsed_time / qs.execution_count DESC`,
    isDMV: true,
  },
];

async function benchmarkQueries(pool) {
  console.log(`\n⚡ [3/7] SQL Query benchmarks (${QUERY_RUNS} runs each)...`);
  const results = [];

  for (const q of QUERIES) {
    const times  = [];
    let   rows   = 0;
    let   dmvData = null;
    let   error  = null;

    const runs = q.isDMV ? 1 : QUERY_RUNS;
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      try {
        const r = await pool.request().query(q.sql);
        times.push(Date.now() - t0);
        rows   = r.recordset?.length ?? 0;
        if (q.isDMV) dmvData = r.recordset;
      } catch (e) {
        times.push(null);
        error = e.message;
      }
      await sleep(50);
    }

    const valid = times.filter((t) => t !== null);
    const entry = {
      query:   q.name,
      avgMs:   valid.length ? round(avg(valid)) : null,
      minMs:   valid.length ? min(valid)         : null,
      maxMs:   valid.length ? max(valid)         : null,
      rows,
      error,
      dmvData,
    };

    if (q.isDMV) {
      console.log(`   📊 ${q.name}: ${entry.avgMs ?? "ERR"}ms`);
    } else {
      console.log(`   ▸ ${q.name}: avg=${entry.avgMs ?? "ERR"}ms  rows=${rows}  ${
        entry.avgMs !== null ? rating(entry.avgMs, 50, 300) : color("red","FAIL")
      }`);
    }
    results.push(entry);
  }
  return results;
}

// ── 4. API response time ──────────────────────────────────────
const API_ENDPOINTS = [
  { name: "Health check",       method: "GET", path: "/health" },
  { name: "Tables (all)",       method: "GET", path: "/api/tables/all" },
  { name: "Menu dishes (all)",  method: "GET", path: "/api/menu/dishes/all" },
  { name: "Menu kitchens",      method: "GET", path: "/api/menu/kitchens" },
  { name: "Sales report",       method: "GET", path: "/api/sales/all" },
];

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    http.get(url, { timeout: 15000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end",  () => resolve({ ms: Date.now() - t0, status: res.statusCode, bytes: body.length }));
    }).on("error", reject).on("timeout", () => reject(new Error("timeout")));
  });
}

async function benchmarkAPI() {
  console.log(`\n🌐 [4/7] API response times (${API_ENDPOINTS.length} endpoints, 3 runs each)...`);
  const results = [];

  for (const ep of API_ENDPOINTS) {
    const times = [];
    let status = null;
    let bytes  = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await httpGet(`${LOCAL_API}${ep.path}`);
        times.push(r.ms);
        status = r.status;
        bytes  = r.bytes;
      } catch (e) {
        times.push(null);
      }
      await sleep(200);
    }

    const valid = times.filter((t) => t !== null);
    const entry = {
      endpoint: ep.name,
      path:     ep.path,
      avgMs:    valid.length ? round(avg(valid)) : null,
      minMs:    valid.length ? min(valid)         : null,
      status,
      bytes,
    };

    console.log(`   ▸ ${ep.name}: avg=${entry.avgMs ?? "FAIL"}ms  status=${status ?? "ERR"}  ${
      entry.avgMs !== null ? rating(entry.avgMs, 200, 800) : color("red", "FAIL")
    }`);
    results.push(entry);
  }
  return results;
}

// ── 5. Local system metrics ───────────────────────────────────
function getLocalMetrics() {
  console.log("\n💻 [5/7] Local system metrics...");
  const cpus    = os.cpus();
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;
  const memPct   = round((usedMem / totalMem) * 100, 1);

  // CPU usage snapshot (1-second sample)
  const cpuCount  = cpus.length;
  const cpuModel  = cpus[0]?.model ?? "Unknown";
  const loadAvg   = os.loadavg();   // 1, 5, 15 min (Linux/Mac only, 0 on Windows)

  const result = {
    cpuModel,
    cpuCount,
    loadAvg1m:  round(loadAvg[0], 2),
    totalMemGB:  round(totalMem / 1024 ** 3, 2),
    usedMemGB:   round(usedMem  / 1024 ** 3, 2),
    freeMemGB:   round(freeMem  / 1024 ** 3, 2),
    memUsedPct:  memPct,
    platform:    os.platform(),
    uptime:      round(os.uptime() / 3600, 1),
  };

  console.log(`   CPU: ${cpuModel} × ${cpuCount} cores`);
  console.log(`   RAM: ${result.usedMemGB}GB used / ${result.totalMemGB}GB total (${memPct}%)  ${rating(memPct, 70, 85)}`);
  console.log(`   Platform: ${result.platform}  Uptime: ${result.uptime}h`);
  return result;
}

// ── 6. Connection pool stress test ───────────────────────────
async function stressTestPool(pool, concurrency = 20) {
  console.log(`\n🔗 [6/7] Connection pool stress test (${concurrency} concurrent queries)...`);
  const t0 = Date.now();
  const promises = Array.from({ length: concurrency }, (_, i) =>
    pool.request().query("SELECT 1 AS stress_test, GETDATE() AS ts").then(() => Date.now() - t0).catch(() => null)
  );
  const results  = await Promise.all(promises);
  const valid    = results.filter((r) => r !== null);
  const failures = results.length - valid.length;

  const result = {
    concurrency,
    successCount:  valid.length,
    failureCount:  failures,
    minMs:         valid.length ? min(valid) : null,
    maxMs:         valid.length ? max(valid) : null,
    avgMs:         valid.length ? round(avg(valid)) : null,
    throughputQps: valid.length > 0 ? round(valid.length / ((Date.now() - t0) / 1000), 1) : 0,
  };

  console.log(`   Concurrent: ${concurrency}  ✅ Success: ${valid.length}  ❌ Fail: ${failures}`);
  console.log(`   Avg completion: ${result.avgMs}ms  Max: ${result.maxMs}ms  QPS: ${result.throughputQps}`);
  console.log(`   Rating: ${rating(result.avgMs ?? 9999, 100, 500)}`);
  return result;
}

// ── 7. Bottleneck classification & recommendations ────────────
function classifyBottleneck(report) {
  const { tcp, queries, api, sqlDmvs, pool } = report;

  const scores = {
    "Network Latency":        0,
    "SQL Execution Time":     0,
    "CPU Pressure":           0,
    "RAM Pressure":           0,
    "Disk I/O":               0,
    "Connection Pool":        0,
  };

  // Network
  if (tcp?.avgMs > 30)  scores["Network Latency"]    += 3;
  if (tcp?.avgMs > 80)  scores["Network Latency"]    += 3;
  if (tcp?.avgMs > 200) scores["Network Latency"]    += 4;

  // SQL execution
  const pingQ   = queries?.find((q) => q.query === "Ping (SELECT 1)");
  const salesQ  = queries?.find((q) => q.query === "Sales report (SettlementHeader TOP 200)");
  if (pingQ?.avgMs  > 50)  scores["SQL Execution Time"] += 2;
  if (salesQ?.avgMs > 300) scores["SQL Execution Time"] += 3;
  if (salesQ?.avgMs > 800) scores["SQL Execution Time"] += 3;

  // CPU (from DMV)
  const cpuRow = sqlDmvs?.cpu?.[0];
  if (cpuRow?.sql_cpu_utilization > 50) scores["CPU Pressure"] += 4;
  if (cpuRow?.sql_cpu_utilization > 80) scores["CPU Pressure"] += 4;

  // RAM (from DMV)
  const memRow = sqlDmvs?.memory?.[0];
  if (memRow?.memory_utilization_percentage > 70) scores["RAM Pressure"] += 4;
  if (memRow?.memory_utilization_percentage > 90) scores["RAM Pressure"] += 4;

  // Disk I/O
  const ioRows = sqlDmvs?.diskIO || [];
  const totalPhysReads = ioRows.reduce((s, r) => s + (r.physical_reads || 0), 0);
  if (totalPhysReads > 10000)  scores["Disk I/O"] += 3;
  if (totalPhysReads > 100000) scores["Disk I/O"] += 4;

  // Connection pool
  const sessRow = sqlDmvs?.sessions?.[0];
  if (sessRow?.waiting_sessions > 5)  scores["Connection Pool"] += 3;
  if (sessRow?.waiting_sessions > 20) scores["Connection Pool"] += 4;
  if (pool?.failureCount > 0)         scores["Connection Pool"] += 3;
  if (pool?.avgMs > 200)              scores["Connection Pool"] += 2;

  // API health
  const apiAvgs = (api || []).map((a) => a.avgMs).filter(Boolean);
  const avgAPI  = apiAvgs.length ? avg(apiAvgs) : null;

  const ranked = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([name, score]) => ({ name, score, severity: score >= 7 ? "CRITICAL" : score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW" }));

  return { ranked, avgAPIMs: avgAPI ? round(avgAPI) : null };
}

function buildRecommendations(report, bottleneck) {
  const { tcp, queries, sqlDmvs } = report;
  const topBottleneck = bottleneck.ranked[0]?.name;

  const pingQ  = queries?.find((q) => q.query === "Ping (SELECT 1)");
  const menuQ  = queries?.find((q) => q.query === "Menu load (DishMaster)");
  const salesQ = queries?.find((q) => q.query === "Sales report (SettlementHeader TOP 200)");
  const cpuRow = sqlDmvs?.cpu?.[0];
  const memRow = sqlDmvs?.memory?.[0];
  const slowQ  = sqlDmvs?.slowQueries || [];

  const recs = [];

  // Redis caching
  const cacheImpact = menuQ?.avgMs > 100
    ? `~${round((menuQ.avgMs - 5) / menuQ.avgMs * 100)}% reduction on menu/static API calls`
    : "40–80% reduction on repeated read queries";
  recs.push({
    rank:   null,
    action: "Add Redis Caching Layer",
    detail: `Cache menu, kitchens, company settings, and paymode lookups (TTL 60–300s). ${cacheImpact}. Currently every request hits SQL Server even for static data.`,
    impactScore: 9,
    effort: "Medium (1–2 days)",
    gain:   "HIGH — eliminates 60–80% of read queries to SQL Server",
  });

  // Query optimization
  const slowQueryCount = slowQ.filter((q) => q.avg_elapsed_ms > 200).length;
  recs.push({
    rank:   null,
    action: "Optimize SQL Queries + Add Indexes",
    detail: `${slowQueryCount} slow queries detected (>200ms avg). Add covering indexes on SettlementHeader(LastSettlementDate), RestaurantOrderCur(isOrderClosed,Tableno), TableMaster(Status). Replace bare CAST in WHERE clauses (non-sargable) with indexed columns. The DB polling SELECT runs every 3 seconds — add an index on TableId+Status.`,
    impactScore: 8,
    effort: "Low-Medium (few hours)",
    gain:   "HIGH — 30–60% query time reduction",
  });

  // Move backend closer
  const networkGain = tcp?.avgMs > 30
    ? `Current TCP: ${tcp.avgMs}ms avg. Co-locating would reduce to <5ms (~${round((tcp.avgMs - 5) / tcp.avgMs * 100)}% latency cut).`
    : `TCP latency is ${tcp?.avgMs ?? "?"}ms. Minor gain expected.`;
  recs.push({
    rank:   null,
    action: "Move Backend Closer to SQL Server",
    detail: `${networkGain} SQL Server is on dynamic DNS (myerpcloud.dyndns.org:9199) suggesting on-premise. If backend is on Railway (US/EU), each SQL round-trip adds 80–200ms+. Deploy backend on a VPS in the same datacenter/city as the SQL Server.`,
    impactScore: tcp?.avgMs > 30 ? 8 : 4,
    effort: "Medium (1 day to migrate to local VPS)",
    gain:   tcp?.avgMs > 30 ? "HIGH — eliminates network overhead on every query" : "LOW",
  });

  // RAM upgrade
  const memUsed = memRow?.memory_utilization_percentage ?? null;
  recs.push({
    rank:   null,
    action: "Upgrade SQL Server RAM",
    detail: `SQL Server memory in use: ${memUsed !== null ? memUsed + "%" : "check DMV output"}. More RAM allows SQL Server to cache more data pages, reducing physical disk reads. Benefit is highest when RAM < buffer pool demand. Aim for minimum 16GB for a POS system with active reporting.`,
    impactScore: memUsed !== null && memUsed > 80 ? 7 : 4,
    effort: "Low (hardware purchase + no code change)",
    gain:   memUsed > 80 ? "HIGH — buffer pool full, disk I/O is spiking" : "MEDIUM — useful but not urgent",
  });

  // CPU upgrade
  const cpuUtil = cpuRow?.sql_cpu_utilization ?? null;
  recs.push({
    rank:   null,
    action: "Upgrade SQL Server CPU",
    detail: `SQL Server CPU: ${cpuUtil !== null ? cpuUtil + "%" : "check DMV output"}. CPU is generally NOT the bottleneck for OLTP POS workloads — it matters more for heavy reporting. Fix queries and indexes first; upgrade CPU only if > 70% sustained utilization persists after optimization.`,
    impactScore: cpuUtil !== null && cpuUtil > 70 ? 5 : 2,
    effort: "High (hardware change, likely server downtime)",
    gain:   cpuUtil > 70 ? "MEDIUM — helps with heavy reports" : "LOW — unlikely to be primary bottleneck",
  });

  // Sort by impact score
  recs.sort((a, b) => b.impactScore - a.impactScore);
  recs.forEach((r, i) => (r.rank = i + 1));
  return recs;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  console.log(color("bold", "\n╔══════════════════════════════════════════════════════╗"));
  console.log(color("bold",   "║   UCS PONDY  —  INFRASTRUCTURE BOTTLENECK ANALYZER  ║"));
  console.log(color("bold",   "╚══════════════════════════════════════════════════════╝"));
  console.log(`   DB Server : ${DB_SERVER}:${DB_PORT}`);
  console.log(`   DB Name   : ${DB_NAME}`);
  console.log(`   Timestamp : ${new Date().toISOString()}\n`);

  const report = {
    timestamp:  new Date().toISOString(),
    dbServer:   `${DB_SERVER}:${DB_PORT}`,
    dbName:     DB_NAME,
    dns:        null,
    tcp:        null,
    queries:    [],
    api:        [],
    localSys:   null,
    pool:       null,
    sqlDmvs:    {},
    bottleneck: null,
    recommendations: [],
  };

  // ── DNS ──────────────────────────────────────────────────────
  report.dns = await measureDNS();

  // ── TCP latency ───────────────────────────────────────────────
  report.tcp = await measureTCPLatency(report.dns.resolved || DB_SERVER, DB_PORT);

  // ── SQL connection ────────────────────────────────────────────
  console.log("\n🔌 Connecting to SQL Server...");
  let pool = null;
  try {
    pool = await new sql.ConnectionPool({
      user:     DB_USER,
      password: DB_PASSWORD,
      server:   DB_SERVER,
      port:     DB_PORT,
      database: DB_NAME,
      options:  { encrypt: false, trustServerCertificate: true },
      pool:     { max: 30, min: 2, idleTimeoutMillis: 10000 },
      connectionTimeout: 30000,
      requestTimeout:    30000,
    }).connect();
    console.log(color("green", "   ✅ SQL Server connected."));
  } catch (e) {
    console.log(color("red", `   ❌ Could not connect: ${e.message}`));
    console.log(color("yellow", "   Skipping SQL benchmarks — API and system metrics will still run.\n"));
  }

  // ── SQL benchmarks ────────────────────────────────────────────
  if (pool) {
    report.queries = await benchmarkQueries(pool);

    // Extract DMV data from query results
    const dmvMap = {};
    for (const q of report.queries) {
      if (q.dmvData) {
        if (q.query.includes("CPU"))        dmvMap.cpu         = q.dmvData;
        if (q.query.includes("Memory"))     dmvMap.memory      = q.dmvData;
        if (q.query.includes("Disk I/O"))   dmvMap.diskIO      = q.dmvData;
        if (q.query.includes("sessions"))   dmvMap.sessions    = q.dmvData;
        if (q.query.includes("slow"))       dmvMap.slowQueries = q.dmvData;
      }
    }
    report.sqlDmvs = dmvMap;

    // ── Connection pool stress ──────────────────────────────────
    report.pool = await stressTestPool(pool, 20);

    await pool.close();
  }

  // ── API benchmarks ────────────────────────────────────────────
  report.api = await benchmarkAPI();

  // ── Local system ──────────────────────────────────────────────
  report.localSys = getLocalMetrics();

  // ── Classification ────────────────────────────────────────────
  console.log("\n🧠 [7/7] Classifying bottleneck...");
  const bottleneck = classifyBottleneck(report);
  report.bottleneck = bottleneck;
  report.recommendations = buildRecommendations(report, bottleneck);

  // ── Print summary ─────────────────────────────────────────────
  console.log(color("bold", "\n╔══════════════════════════════════════════════════╗"));
  console.log(color("bold",   "║              BOTTLENECK RANKING                  ║"));
  console.log(color("bold",   "╚══════════════════════════════════════════════════╝"));
  bottleneck.ranked.forEach((b, i) => {
    const icon = b.severity === "CRITICAL" ? "🔴" : b.severity === "HIGH" ? "🟠" : b.severity === "MEDIUM" ? "🟡" : "🟢";
    console.log(`   ${i + 1}. ${icon} ${b.name.padEnd(28)} Score: ${b.score}  [${b.severity}]`);
  });

  console.log(color("bold", "\n╔══════════════════════════════════════════════════╗"));
  console.log(color("bold",   "║         RECOMMENDED IMPROVEMENTS (RANKED)        ║"));
  console.log(color("bold",   "╚══════════════════════════════════════════════════╝"));
  report.recommendations.forEach((r) => {
    console.log(`\n   ${r.rank}. ${color("cyan", r.action)}`);
    console.log(`      Impact Score : ${r.impactScore}/10`);
    console.log(`      Effort       : ${r.effort}`);
    console.log(`      Expected Gain: ${r.gain}`);
    console.log(`      Detail       : ${r.detail.substring(0, 160)}${r.detail.length > 160 ? "..." : ""}`);
  });

  // ── Key metrics summary ───────────────────────────────────────
  const pingQ  = report.queries?.find((q) => q.query === "Ping (SELECT 1)");
  const salesQ = report.queries?.find((q) => q.query === "Sales report (SettlementHeader TOP 200)");
  const sessRow = report.sqlDmvs?.sessions?.[0];
  const cpuRow  = report.sqlDmvs?.cpu?.[0];
  const memRow  = report.sqlDmvs?.memory?.[0];

  console.log(color("bold", "\n╔══════════════════════════════════════════════════╗"));
  console.log(color("bold",   "║              KEY METRICS SUMMARY                 ║"));
  console.log(color("bold",   "╚══════════════════════════════════════════════════╝"));
  console.log(`   Network TCP latency      : ${report.tcp?.avgMs ?? "N/A"}ms  ${report.tcp?.avgMs != null ? rating(report.tcp.avgMs, 5, 30) : ""}`);
  console.log(`   SQL ping (SELECT 1)      : ${pingQ?.avgMs ?? "N/A"}ms  ${pingQ?.avgMs != null ? rating(pingQ.avgMs, 10, 50) : ""}`);
  console.log(`   SQL sales query          : ${salesQ?.avgMs ?? "N/A"}ms  ${salesQ?.avgMs != null ? rating(salesQ.avgMs, 100, 500) : ""}`);
  console.log(`   Avg API response         : ${bottleneck.avgAPIMs ?? "N/A"}ms  ${bottleneck.avgAPIMs != null ? rating(bottleneck.avgAPIMs, 200, 800) : ""}`);
  console.log(`   SQL Server CPU           : ${cpuRow?.sql_cpu_utilization ?? "N/A"}%  ${cpuRow?.sql_cpu_utilization != null ? rating(cpuRow.sql_cpu_utilization, 40, 70) : ""}`);
  console.log(`   SQL Server RAM used      : ${memRow?.memory_used_mb != null ? round(memRow.memory_used_mb) + " MB" : "N/A"}  ${memRow?.memory_utilization_percentage != null ? rating(memRow.memory_utilization_percentage, 70, 90) : ""}`);
  console.log(`   Active DB sessions       : ${sessRow?.active_sessions ?? "N/A"}  Waiting: ${sessRow?.waiting_sessions ?? "N/A"}`);
  console.log(`   Pool stress (20 conc.)   : avg=${report.pool?.avgMs ?? "N/A"}ms  fail=${report.pool?.failureCount ?? "N/A"}  ${report.pool?.avgMs != null ? rating(report.pool.avgMs, 100, 500) : ""}`);
  console.log(`   Primary Bottleneck       : ${color("bold", bottleneck.ranked[0]?.name ?? "UNKNOWN")}  [${bottleneck.ranked[0]?.severity ?? "?"}]`);

  // ── Save JSON report ───────────────────────────────────────────
  const fs          = require("fs");
  const reportPath  = path.join(__dirname, "bottleneck_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(color("green", `\n✅ Full report saved → ${reportPath}`));
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error(color("red", "\n💥 Diagnostic failed:"), err);
  process.exit(1);
});
