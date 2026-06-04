const fs = require('fs');

const filepath = 'c:/Users/User/Desktop/DEMO_UCS_PONDY/backend/routes/sales.js';
let content = fs.readFileSync(filepath, 'utf-8');

// 1. Add import for timezoneHelper and settingsCache at the top
if (!content.includes('const { getBusinessTimezoneSettings }')) {
    content = content.replace(
        'const { processSplitPayments } = require("../services/payment.service");',
        'const { processSplitPayments } = require("../services/payment.service");\nconst { getBusinessDaySqlBounds } = require("../utils/timezoneHelper");\nconst { getBusinessTimezoneSettings } = require("../utils/settingsCache");'
    );
}

// 2. Replace getReportDateWhereSql definition
const old_def = `const getReportDateWhereSql = (filter = "daily", saleDateColumn = "sh.LastSettlementDate", date = null) => {
  // Precisely match IST (UTC+5.5) against the drifting Server clock (UTC+7.8)
  // Offset = 7.8 - 5.5 = 2.3 hours = 138 minutes
  const targetDate = date ? \`'\${date}'\` : 'DATEADD(MINUTE, -138, GETDATE())';
  const safeTargetDate = \`CAST(CAST(\${targetDate} AS DATETIME) AS DATE)\`;

  switch (String(filter).toLowerCase()) {
    case "weekly":
      return \`\${saleDateColumn} >= DATEADD(DAY, -6, CAST(\${safeTargetDate} AS DATETIME)) AND \${saleDateColumn} <= DATEADD(HOUR, 36, CAST(\${safeTargetDate} AS DATETIME))\`;
    case "monthly":
      return \`MONTH(CAST(\${saleDateColumn} AS DATETIME)) = MONTH(\${safeTargetDate}) AND YEAR(CAST(\${saleDateColumn} AS DATETIME)) = YEAR(\${safeTargetDate})\`;
    case "yearly":
      return \`YEAR(CAST(\${saleDateColumn} AS DATETIME)) = YEAR(\${safeTargetDate})\`;
    case "daily":
    default:
      // Precisely match the IST day (00:00 to 23:59 IST)
      // IST 00:00 = Server 02:48 AM
      const istStart = \`DATEADD(MINUTE, 168, CAST(\${safeTargetDate} AS DATETIME))\`;
      return \`\${saleDateColumn} >= \${istStart} AND \${saleDateColumn} < DATEADD(DAY, 1, \${istStart})\`;
  }
};`;

const new_def = `const getReportDateWhereSql = async (filter = "daily", saleDateColumn = "sh.LastSettlementDate", date = null) => {
  const { timezone, offsetMinutes } = await getBusinessTimezoneSettings();
  const bounds = getBusinessDaySqlBounds(filter, date, timezone, offsetMinutes);
  return \`\${saleDateColumn} >= '\${bounds.startSqlStr}' AND \${saleDateColumn} < '\${bounds.endSqlStr}'\`;
};`;

content = content.replace(old_def, new_def);

// 3. Add awaits to all getReportDateWhereSql calls
content = content.replace(
    /const appDateWhereSql = getReportDateWhereSql/g,
    'const appDateWhereSql = await getReportDateWhereSql'
);
content = content.replace(
    /const legacyDateWhereSql = getReportDateWhereSql/g,
    'const legacyDateWhereSql = await getReportDateWhereSql'
);
content = content.replace(
    /const dateWhereClause = getReportDateWhereSql/g,
    'const dateWhereClause = await getReportDateWhereSql'
);

// 4. Replace getReportDateRange which is used for the header dates in sales.js
const old_getReportDateRange = `const getReportDateRange = (req) => {
  const filter = (req.query.filter || "daily").toLowerCase();
  const start = new Date();
  const end = new Date();

  // Default to day boundaries
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (filter === "weekly") {
    start.setDate(start.getDate() - 6);
  } else if (filter === "monthly") {
    start.setDate(1);
    // end maintains today
  } else if (filter === "yearly") {
    start.setMonth(0, 1);
    // end maintains today
  }
  // Daily uses today's start/end

  return { start, end };
};`;

const new_getReportDateRange = `const getReportDateRange = async (req) => {
  const filter = (req.query.filter || "daily").toLowerCase();
  const { timezone, offsetMinutes } = await getBusinessTimezoneSettings();
  const bounds = getBusinessDaySqlBounds(filter, req.query.date, timezone, offsetMinutes);
  return { start: bounds.startBoundUtc, end: bounds.endBoundUtc };
};`;

content = content.replace(old_getReportDateRange, new_getReportDateRange);

// Replace the single call to getReportDateRange in sales.js (if any)
content = content.replace(
    /const dateRange = getReportDateRange\(req\);/g,
    'const dateRange = await getReportDateRange(req);'
);

fs.writeFileSync(filepath, content, 'utf-8');
console.log("sales.js refactored successfully.");
