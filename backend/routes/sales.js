const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { runInTransaction } = require("../utils/transactionHelper");
const { getActiveOrganization } = require("../utils/organizationHelper");
const { processSplitPayments } = require("../services/payment.service");

// Helper to generate a random 8-character hex ID (e.g. A996E780)
const generateRandomBillId = () => {
    return Math.random().toString(16).slice(2, 10).toUpperCase();
};

const normalizeReportPayModeSql = (columnName = "sts.PayMode") => `
  UPPER(ISNULL(
    (SELECT TOP 1 LTRIM(RTRIM(Description)) 
     FROM Paymode pm 
     WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(ISNULL(${columnName}, '')))
        OR LTRIM(RTRIM(pm.Description)) = LTRIM(RTRIM(ISNULL(${columnName}, '')))
        OR CAST(pm.Position AS NVARCHAR(10)) = LTRIM(RTRIM(ISNULL(${columnName}, '')))
    ),
    CASE
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('CAS', 'CASH', '', '1') THEN 'CASH'
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('CARD', 'VISA', 'MASTER', 'MASTERCARD', 'AMEX', 'DINERS') THEN 'CARD'
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('PAYNOW', 'GRAB', 'FOODPANDA', '3') OR UPPER(${columnName}) LIKE '%PAYNOW%' THEN 'PAYNOW'
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('NETS', '2') OR UPPER(${columnName}) LIKE '%NETS%' THEN 'NETS'
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('UPI', '4') OR UPPER(${columnName}) LIKE '%UPI%' OR UPPER(${columnName}) LIKE '%GPAY%' THEN 'UPI'
      WHEN UPPER(LTRIM(RTRIM(ISNULL(${columnName}, '')))) IN ('MEMBER', '5') OR UPPER(${columnName}) LIKE '%MEMBER%' THEN 'MEMBER'
      ELSE UPPER(LTRIM(RTRIM(ISNULL(${columnName}, 'CASH'))))
    END
  ))
`;

const getReportDateRange = (req) => {
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
};

const getReportDateWhereSql = (filter = "daily", saleDateColumn = "sh.LastSettlementDate", date = null) => {
  // Precisely match IST (UTC+5.5) against the drifting Server clock (UTC+7.8)
  // Offset = 7.8 - 5.5 = 2.3 hours = 138 minutes
  const targetDate = date ? `'${date}'` : 'DATEADD(MINUTE, -138, GETDATE())';
  const safeTargetDate = `CAST(CAST(${targetDate} AS DATETIME) AS DATE)`;

  switch (String(filter).toLowerCase()) {
    case "weekly":
      return `${saleDateColumn} >= DATEADD(DAY, -6, CAST(${safeTargetDate} AS DATETIME)) AND ${saleDateColumn} <= DATEADD(HOUR, 36, CAST(${safeTargetDate} AS DATETIME))`;
    case "monthly":
      return `MONTH(CAST(${saleDateColumn} AS DATETIME)) = MONTH(${safeTargetDate}) AND YEAR(CAST(${saleDateColumn} AS DATETIME)) = YEAR(${safeTargetDate})`;
    case "yearly":
      return `YEAR(CAST(${saleDateColumn} AS DATETIME)) = YEAR(${safeTargetDate})`;
    case "daily":
    default:
      // Precisely match the IST day (00:00 to 23:59 IST)
      // IST 00:00 = Server 02:48 AM
      const istStart = `DATEADD(MINUTE, 168, CAST(${safeTargetDate} AS DATETIME))`;
      return `${saleDateColumn} >= ${istStart} AND ${saleDateColumn} < DATEADD(DAY, 1, ${istStart})`;
  }
};

const normalizeReportFilter = (filter = "daily") => {
  const normalized = String(filter || "daily").toLowerCase();
  return ["daily", "weekly", "monthly", "yearly"].includes(normalized) ? normalized : "daily";
};

const parseCsv = (value) => String(value || "")
  .split(",")
  .map((v) => v.trim().toUpperCase())
  .filter(Boolean);

const normalizePayMode = (paymentMethod = "CASH") => {
  const raw = String(paymentMethod || "CASH").toUpperCase().trim();
  
  if (raw.includes("CASH") || raw === "CAS") return "CASH";
  if (raw.includes("CARD") || raw.includes("VISA") || raw.includes("MASTER") || raw.includes("AMEX") || raw.includes("DINERS")) return "CARD";
  if (raw.includes("PAYNOW") || raw.includes("GRAB") || raw.includes("FOODPANDA")) return "PAYNOW";
  if (raw.includes("UPI") || raw.includes("GPAY") || raw.includes("PHONE") || raw.includes("PAYTM")) return "UPI";
  if (raw.includes("NETS")) return "NETS";
  if (raw.includes("MEMBER")) return "MEMBER";
  
  return raw;
};

const toGuidOrNull = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

const DEFAULT_GUID = "00000000-0000-0000-0000-000000000000";

const sanitizeGuid = (value, fallback = DEFAULT_GUID) => {
  return toGuidOrNull(value) || fallback;
};

const validateSalePayload = ({ totalAmount, paymentMethod, items, payments }) => {
  if (payments && Array.isArray(payments) && payments.length > 0) {
    let sum = 0;
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const amt = parseFloat(p.amount);
      if (isNaN(amt) || amt <= 0) {
        return `Payment row ${i + 1} has an invalid or negative amount.`;
      }
      if (!p.payModeId && !p.payMode) {
        return `Payment row ${i + 1} is missing a payment mode.`;
      }
      sum += amt;
    }
    const diff = Math.abs(sum - Number(totalAmount));
    if (diff > 0.01) {
      return `Total paid amount (${sum.toFixed(2)}) does not match the bill total (${Number(totalAmount).toFixed(2)})`;
    }
  } else if (!paymentMethod || !String(paymentMethod).trim()) {
    return "Payment mode is required";
  }

  const numericTotal = Number(totalAmount);
  if (!Number.isFinite(numericTotal) || numericTotal < 0) {
    return "Total amount must be at least zero";
  }

  if (!Array.isArray(items) || items.length === 0) {
    return "At least one sale item is required";
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const dishId = item.dishId || item.id;
    const dishName = item.dish_name || item.name;
    const qty = Number(item.qty);
    const price = Number(item.price);

    if (!dishId && !dishName) return `Item ${i + 1} is missing dish information`;
    if (!Number.isFinite(qty) || qty <= 0) return `Item ${i + 1} has invalid quantity`;
    if (!Number.isFinite(price) || price < 0) return `Item ${i + 1} has invalid price`;
  }

  return null;
};

/* ================= SALES LIST & SUMMARY ================= */
router.get("/all", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 200 * FROM (
        SELECT 
          sh.SettlementID, 
          DATEADD(MINUTE, -468, sh.LastSettlementDate) AS SettlementDate, 
          sh.BillNo AS OrderId, 
          sh.OrderType,
          sh.TableNo, 
          sh.Section, 
          sh.CashierId, 
          sh.BillNo, 
          sh.SER_NAME,
          ${normalizeReportPayModeSql("sts.PayMode")} as PayMode,
          sh.SysAmount as SysAmount,
          sh.ManualAmount as ManualAmount,
          sh.SubTotal as SubTotal,
          ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
          sh.DiscountType as DiscountType,
          ISNULL(sh.ServiceCharge, 0) as ServiceCharge,
          ISNULL(sts.ReceiptCount, 0) as ReceiptCount,
          ISNULL(sh.VoidItemQty, 0) as VoidQty,
          ISNULL(sh.VoidItemAmount, 0) as VoidAmount,
          sh.IsCancelled,
          sh.CancellationReason,
          DATEADD(MINUTE, -468, sh.CancelledDate) as CancelledDate,
          sh.CancelledByUserName,
          ri.OrderId AS MasterOrderId,
          ISNULL(ri.TotalDiscountAmount, 0) as TotalDiscountAmount,
          ISNULL(ri.TotalLineItemDiscountAmount, 0) as TotalLineItemDiscountAmount,
          sh.RoundedBy as RoundedBy,
          ISNULL(ri.DiscountPercentage, 0) as DiscountPercentage
        FROM SettlementHeader sh
        LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
        LEFT JOIN RestaurantInvoice ri ON sh.SettlementID = ri.RestaurantBillId

        UNION ALL

        SELECT 
          cct.TransactionId AS SettlementID,
          DATEADD(MINUTE, -468, cct.CreatedDate) AS SettlementDate,
          'CREDIT PAYMENT' AS OrderId,
          'LEDGER' AS OrderType,
          'LEDGER' AS TableNo,
          m.Name AS Section,
          CAST(cct.CreatedBy AS VARCHAR(50)) AS CashierId,
          cct.Remarks AS BillNo,
          'Cashier' AS SER_NAME,
          cct.PaymentMethod AS PayMode,
          cct.PaidAmount AS SysAmount,
          cct.PaidAmount AS ManualAmount,
          cct.PaidAmount AS SubTotal,
          0 AS DiscountAmount,
          NULL AS DiscountType,
          0 AS ServiceCharge,
          1 AS ReceiptCount,
          0 AS VoidQty,
          0 AS VoidAmount,
          0 AS IsCancelled,
          NULL AS CancellationReason,
          NULL AS CancelledDate,
          NULL AS CancelledByUserName,
          NULL AS MasterOrderId,
          0 AS TotalDiscountAmount,
          0 AS TotalLineItemDiscountAmount,
          0 AS RoundedBy,
          0 AS DiscountPercentage
        FROM CustomerCreditTransactions cct
        INNER JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId
        WHERE cct.TransactionType = 'PAYMENT'
      ) CombinedSales
      ORDER BY SettlementDate DESC
    `);

    const records = result.recordset || [];
    if (records.length > 0) {
      const masterOrderIds = records
        .map(r => r.MasterOrderId)
        .filter(id => id && id.length > 30);

      const mergeMap = {};
      if (masterOrderIds.length > 0) {
        try {
          const formattedIds = masterOrderIds.map(id => `'${id}'`).join(',');
          const mergeResult = await pool.request().query(`
            SELECT 
              omh.ParentOrderId, 
              omh.ChildTableNo,
              COALESCE(ro.OrderNumber, ro_cur.OrderNumber) AS ChildOrderNo
            FROM OrderMergeHistory omh
            LEFT JOIN RestaurantOrder ro ON omh.ChildOrderId = ro.OrderId
            LEFT JOIN RestaurantOrderCur ro_cur ON omh.ChildOrderId = ro_cur.OrderId
            WHERE omh.ParentOrderId IN (${formattedIds})
          `);
          
          mergeResult.recordset.forEach(row => {
            const parentId = String(row.ParentOrderId).toLowerCase();
            const childTable = String(row.ChildTableNo || "").trim();
            const childOrder = String(row.ChildOrderNo || "").trim();
            const displayStr = childTable ? `T${childTable}${childOrder ? ` [#${childOrder}]` : ""}` : childOrder;
            if (displayStr) {
              if (!mergeMap[parentId]) mergeMap[parentId] = [];
              mergeMap[parentId].push(displayStr);
            }
          });
        } catch (mergeErr) {
          console.error("⚠️ [Report API] Failed to fetch merge history details:", mergeErr.message);
        }
      }

      records.forEach(row => {
        const parentId = row.MasterOrderId ? String(row.MasterOrderId).toLowerCase() : null;
        
        // 1. Merge details
        if (parentId && mergeMap[parentId]) {
          row.isMerged = true;
          row.mergedDetails = [...new Set(mergeMap[parentId])].join(', ');
        } else {
          row.isMerged = false;
          row.mergedDetails = "";
        }

        // 2. Split details
        if (row.BillNo && row.BillNo.includes('-S')) {
          row.isSplit = true;
          row.splitNo = 'S' + row.BillNo.split('-S').pop();
        } else {
          row.isSplit = false;
          row.splitNo = "";
        }
      });
    }

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { startDate, endDate } = req.query;
    const result = await pool.request()
      .input("Start", sql.DateTime, startDate || new Date(new Date().setDate(new Date().getDate() - 30)))
      .input("End", sql.DateTime, endDate || new Date())
      .query(`
        SELECT sh.SettlementID, DATEADD(MINUTE, -468, sh.LastSettlementDate) as LastSettlementDate, sh.BillNo, sh.SysAmount AS TotalAmount, sts.PayMode,
        CONVERT(VARCHAR(8), DATEADD(MINUTE, -468, sh.LastSettlementDate), 112) + '-' + RIGHT('0000' + CAST(sh.OrderId AS VARCHAR(10)), 4) AS OrderId,
        sh.IsCancelled, sh.CancellationReason
        FROM SettlementHeader sh
        LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
        WHERE sh.LastSettlementDate >= DATEADD(hour, -12, CAST(@Start AS DATETIME))
        AND sh.LastSettlementDate <= DATEADD(hour, 36, CAST(@End AS DATETIME))
        ORDER BY sh.LastSettlementDate DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/range", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { startDate, endDate } = req.query;
    const result = await pool.request()
      .input("Start", sql.DateTime, startDate)
      .input("End", sql.DateTime, endDate)
      .query(`
        SELECT ISNULL(SUM(sts.SysAmount), 0) AS TotalSales, 
        COUNT(sh.SettlementID) AS TransactionCount
        FROM SettlementHeader sh
        INNER JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
        WHERE sh.LastSettlementDate >= DATEADD(hour, -12, CAST(@Start AS DATETIME))
        AND sh.LastSettlementDate <= DATEADD(hour, 36, CAST(@End AS DATETIME))
      `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/detail/:id", async (req, res) => {
  try {
    const pool = await poolPromise;
    const itemsResult = await pool.request()
      .input("Id", sql.UniqueIdentifier, req.params.id)
      .query("SELECT * FROM SettlementItemDetail WHERE SettlementID = @Id");
    
    const items = itemsResult.recordset || [];
    
    if (items.length > 0) {
      // Fetch the master OrderId for this settlement from RestaurantInvoice
      const orderIdResult = await pool.request()
        .input("Id", sql.UniqueIdentifier, req.params.id)
        .query("SELECT OrderId FROM RestaurantInvoice WHERE RestaurantBillId = @Id");
        
      const orderId = orderIdResult.recordset[0]?.OrderId;
      
      if (orderId) {
        // Fetch modifiers from both history and live tables
        const modifiersResult = await pool.request()
          .input("OrderId", sql.UniqueIdentifier, orderId)
          .query(`
            SELECT OrderDetailId, DishId, ModifierId, ModifierName, Amount 
            FROM Restaurantmodifierdetail 
            WHERE OrderId = @OrderId
            UNION
            SELECT OrderDetailId, DishId, ModifierId, ModifierName, Amount 
            FROM RestaurantmodifierdetailCur 
            WHERE OrderId = @OrderId
          `);
          
        const modifiers = modifiersResult.recordset || [];
        
        // Group modifiers by OrderDetailId (falling back to DishId for legacy compatibility)
        items.forEach(item => {
          const itemMods = modifiers
            .filter(m => {
              if (item.OrderDetailId && m.OrderDetailId) {
                return String(m.OrderDetailId).toLowerCase() === String(item.OrderDetailId).toLowerCase();
              }
              return m.DishId && item.DishId && String(m.DishId).toLowerCase() === String(item.DishId).toLowerCase();
            })
            .map(m => ({ 
              name: m.ModifierName, 
              ModifierName: m.ModifierName, 
              Amount: m.Amount,
              ModifierId: m.ModifierId
            }));
          item.modifiers = itemMods;
        });
      }
    }
    
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/detail/:id/payments", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("Id", sql.UniqueIdentifier, req.params.id)
      .query(`
        SELECT 
          ptd.PaymentTransactionId,
          ptd.ReferenceType,
          ptd.ReferenceId,
          ptd.PayModeId,
          ptd.Amount,
          ptd.ReferenceNo,
          COALESCE(pm.Description, pm.PayMode) AS PayModeName
        FROM PaymentTransactionDetails ptd
        LEFT JOIN Paymode pm ON pm.Position = ptd.PayModeId
        WHERE ptd.ReferenceId = @Id AND ptd.ReferenceType = 'BILL'
      `);
    
    let payments = result.recordset || [];
    if (payments.length === 0) {
      // Fallback: Query SettlementTotalSales or SettlementHeader to get the single payment mode and total amount
      const fallbackResult = await pool.request()
        .input("Id", sql.UniqueIdentifier, req.params.id)
        .query(`
          SELECT 
            sh.SettlementID AS ReferenceId,
            sh.SysAmount AS Amount,
            sts.PayMode
          FROM SettlementHeader sh
          LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
          WHERE sh.SettlementID = @Id
        `);
      if (fallbackResult.recordset.length > 0) {
        const row = fallbackResult.recordset[0];
        // Resolve paymode name from Paymode table using legacy field
        const paymodeNameResult = await pool.request()
          .input("PayMode", sql.VarChar(50), row.PayMode || '')
          .query(`
            SELECT TOP 1 COALESCE(Description, PayMode) AS PayModeName
            FROM Paymode
            WHERE PayMode = @PayMode OR Description = @PayMode OR CAST(Position AS VARCHAR(10)) = @PayMode
          `);
        const payModeName = paymodeNameResult.recordset[0]?.PayModeName || row.PayMode || 'CASH';
        payments = [{
          PaymentTransactionId: null,
          ReferenceType: 'BILL',
          ReferenceId: row.ReferenceId,
          PayModeId: null,
          Amount: row.Amount,
          ReferenceNo: null,
          PayModeName: payModeName
        }];
      }
    }
    
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/category", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = normalizeReportFilter(req.query.filter);
    const date = req.query.date;
    const appDateWhereSql = getReportDateWhereSql(filter, "sh.LastSettlementDate", date);
    const legacyDateWhereSql = getReportDateWhereSql(filter, "InvoiceDate", date);
    console.log(`[REPORT API] type=category filter=${filter} date=${date || 'today'}`);

    const result = await pool.request().query(`
        WITH AppReport AS (
          SELECT
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM SettlementHeader sh
          INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
          LEFT JOIN DishMaster d ON sid.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
          WHERE ${appDateWhereSql}
            AND ISNULL(sid.Qty, 0) > 0
          GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped'))
        ),
        LegacyReport AS (
          SELECT
            CAST(ISNULL(MAX(CAST(categoryname AS NVARCHAR(255))), 'Unmapped') AS NVARCHAR(255)) AS categoryName,
            SUM(CAST(ISNULL(Sold, 0) AS decimal(18, 3))) AS totalQty,
            CAST(0 AS decimal(18, 3)) AS voidQty,
            SUM(CAST(ISNULL(Revenue, ItemSales) AS decimal(18, 2))) AS totalAmount
          FROM vw_categorysalesreport
          WHERE ${legacyDateWhereSql}
          GROUP BY CategoryId
        ),
        ProfessionalReport AS (
          SELECT
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN rod.StatusCode = 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM RestaurantOrderDetail rod
          INNER JOIN RestaurantOrder ro ON rod.OrderId = ro.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${appDateWhereSql.replace(/sh\.OrderDate|sh\.LastSettlementDate/g, 'ro.OrderDateTime')}
            AND ISNULL(ro.StatusCode, 0) = 3
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.BillNo = ro.OrderNumber
            )
          GROUP BY ISNULL(cm.CategoryName, 'Unmapped')
        )
        SELECT categoryName, SUM(totalQty) AS totalQty, SUM(voidQty) AS voidQty, SUM(totalAmount) AS totalAmount
        FROM (
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM AppReport
          UNION ALL
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM LegacyReport
          UNION ALL
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM ProfessionalReport
        ) ReportRows
        GROUP BY categoryName
        HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0 OR SUM(voidQty) > 0
        ORDER BY totalAmount DESC, totalQty DESC, categoryName ASC
      `);

    console.log(`[REPORT API] type=category filter=${filter} rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] category error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/dish", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = normalizeReportFilter(req.query.filter);
    const date = req.query.date;
    const appDateWhereSql = getReportDateWhereSql(filter, "sh.LastSettlementDate", date);
    const legacyDateWhereSql = getReportDateWhereSql(filter, "InvoiceDate", date);
    console.log(`[REPORT API] type=dish filter=${filter} date=${date || 'today'}`);

    const result = await pool.request().query(`
        WITH AppReport AS (
          SELECT
            ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')) AS dishName,
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
            ISNULL(NULLIF(LTRIM(RTRIM(sid.SubCategoryName)), ''), ISNULL(dg.DishGroupName, 'Unmapped')) AS subCategoryName,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM SettlementHeader sh
          INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
          LEFT JOIN DishMaster d ON sid.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
          WHERE ${appDateWhereSql}
          GROUP BY 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')), 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')), 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.SubCategoryName)), ''), ISNULL(dg.DishGroupName, 'Unmapped'))
        ),
        LegacyReport AS (
          SELECT
            CAST(ISNULL(MAX(CAST(Dishname AS NVARCHAR(255))), 'Unmapped') AS NVARCHAR(255)) AS dishName,
            CAST(ISNULL(MAX(CAST(CategoryName AS NVARCHAR(255))), 'Unmapped') AS NVARCHAR(255)) AS categoryName,
            CAST(ISNULL(MAX(CAST(DishGroupname AS NVARCHAR(255))), 'Unmapped') AS NVARCHAR(255)) AS subCategoryName,
            SUM(CAST(ISNULL(Sold, 0) AS decimal(18, 3))) AS totalQty,
            SUM(CAST(ISNULL(Revenue, ItemSales) AS decimal(18, 2))) AS totalAmount
          FROM vw_Dishsalesreport
          WHERE ${legacyDateWhereSql}
          GROUP BY DishId, CategoryId, DishGroupId
        ),
        ProfessionalReport AS (
          SELECT
            ISNULL(rod.DishName, 'Unknown') AS dishName,
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            ISNULL(dg.DishGroupName, 'Unmapped') AS subCategoryName,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN rod.StatusCode = 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM RestaurantOrderDetail rod
          INNER JOIN RestaurantOrder ro ON rod.OrderId = ro.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${appDateWhereSql.replace(/sh\.OrderDate|sh\.LastSettlementDate/g, 'ro.OrderDateTime')}
            AND ISNULL(ro.StatusCode, 0) = 3
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.BillNo = ro.OrderNumber
            )
          GROUP BY 
            ISNULL(rod.DishName, 'Unknown'), 
            ISNULL(cm.CategoryName, 'Unmapped'), 
            ISNULL(dg.DishGroupName, 'Unmapped')
        )
        SELECT dishName, categoryName, subCategoryName, SUM(totalQty) AS totalQty, SUM(voidQty) AS voidQty, SUM(totalAmount) AS totalAmount
        FROM (
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM AppReport
          UNION ALL
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(0 AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM LegacyReport
          UNION ALL
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM ProfessionalReport
        ) ReportRows
        GROUP BY dishName, categoryName, subCategoryName
        HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0 OR SUM(voidQty) > 0
        ORDER BY totalAmount DESC, totalQty DESC, dishName ASC
      `);

    console.log(`[REPORT API] type=dish filter=${filter} rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] dish error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Day End Summary
router.get("/day-end-summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().split("T")[0];
    
    // Default to today if no dates provided
    const start = startDate || today;
    const end = endDate || today;
    
    console.log(`[DAY-END DEBUG] Fetching summary from ${start} to ${end}`);
    
    const pool = await poolPromise;

    // 0. Organization Info
    const orgRes = await pool.request().query(`
      SELECT TOP 1
        Name,
        Address1_Line1,
        Address1_Line2,
        Address1_City,
        Address1_PostalCode,
        Address1_Telephone1
      FROM Organization
    `);
    const orgInfo = orgRes.recordset[0] || {};

    // A. Paymode Detail (Aggregate all settlements in range)
    const paymodeRes = await pool.request()
      .input("start", sql.VarChar, start)
      .input("end", sql.VarChar, end)
      .query(`
        SELECT 
          Paymode,
          SUM(Amount) as Amount,
          SUM(Count) as Count
        FROM (
          SELECT 
            UPPER(ISNULL(
              (SELECT TOP 1 LTRIM(RTRIM(pm.Description)) 
               FROM Paymode pm 
               WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(sd.Paymode)) 
                  OR LTRIM(RTRIM(pm.Description)) = LTRIM(RTRIM(sd.Paymode))
                  OR CAST(pm.Position AS NVARCHAR(10)) = LTRIM(RTRIM(sd.Paymode))
              ), 
              CASE 
                WHEN LTRIM(RTRIM(sd.Paymode)) = '2' THEN 'NETS'
                WHEN LTRIM(RTRIM(sd.Paymode)) = '3' THEN 'PAYNOW'
                WHEN LTRIM(RTRIM(sd.Paymode)) = '4' THEN 'UPI / GPAY'
                ELSE ISNULL(sd.Paymode, 'CASH')
              END
            )) as Paymode,
            ISNULL(sd.SysAmount, 0) as Amount,
            ISNULL(sd.ReceiptCount, 0) as Count
          FROM SettlementHeader sh
          INNER JOIN SettlementDetail sd ON sh.SettlementID = sd.SettlementId
          WHERE CAST(sh.LastSettlementDate AS DATE) >= @start
            AND CAST(sh.LastSettlementDate AS DATE) <= @end
        ) RawData
        GROUP BY Paymode
      `);

    const paymodes = paymodeRes.recordset;
    console.log(`[DAY-END DEBUG] Found ${paymodes.length} paymode records`);
    console.log(`[DAY-END DEBUG] Paymodes:`, JSON.stringify(paymodes));

    // B. Detailed Sales Analysis & Void Detail
    const analysisRes = await pool.request()
      .input("start", sql.VarChar, start)
      .input("end", sql.VarChar, end)
      .query(`
        SELECT 
          SUM(ISNULL(SubTotal, 0)) as BaseSales,
          SUM(ISNULL(SysAmount, 0)) as TotalSales,
          SUM(ISNULL(TotalTax, 0)) as TotalTax,
          SUM(ISNULL(DiscountAmount, 0)) as TotalDiscount,
          SUM(ISNULL(ServiceCharge, 0)) as TotalServiceCharge,
          SUM(ISNULL(RoundedBy, 0)) as TotalRoundOff,
          COUNT(SettlementID) as TotalBills,
          SUM(ISNULL(VoidItemQty, 0)) as VoidQty,
          SUM(ISNULL(VoidItemAmount, 0)) as VoidAmount,
          SUM(CASE WHEN IsCancelled = 1 THEN 1 ELSE 0 END) as CancelledCount,
          SUM(CASE WHEN IsCancelled = 1 THEN ISNULL(VoidItemAmount, 0) ELSE 0 END) as CancelledAmount,
          MAX(TerminalCode) as TerminalCode,
          MAX(RefNo) as RefNo
        FROM SettlementHeader
        WHERE CAST(LastSettlementDate AS DATE) >= @start
          AND CAST(LastSettlementDate AS DATE) <= @end
      `);
 
    const analysis = analysisRes.recordset[0] || { 
      BaseSales: 0, TotalSales: 0, TotalTax: 0, TotalDiscount: 0, TotalServiceCharge: 0, 
      TotalRoundOff: 0, TotalBills: 0, VoidQty: 0, VoidAmount: 0
    };

    const totalSales = analysis.TotalSales || 0;
    const detailTotal = paymodes.reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);
    const diff = totalSales - detailTotal;
    console.log(`[DAY-END DEBUG] Analysis:`, JSON.stringify(analysis));
    console.log(`[DAY-END DEBUG] totalSales: ${totalSales}, detailTotal: ${detailTotal}, diff: ${diff}`);

    // If there's a real discrepancy, surface it explicitly as "Unknown / Unrecorded"
    // and log the offending SettlementHeader rows for deeper inspection.
    if (Math.abs(diff) > 0.05) {
      const unrecordedRes = await pool.request()
        .input("start", sql.VarChar, start)
        .input("end", sql.VarChar, end)
        .query(`
          SELECT TOP 50
            sh.SettlementID,
            sh.LastSettlementDate,
            sh.SysAmount,
            sh.TotalTax,
            sh.SubTotal,
            sh.DiscountAmount,
            sh.ServiceCharge,
            sh.RoundedBy
          FROM SettlementHeader sh 
          WHERE CAST(sh.LastSettlementDate AS DATE) >= @start 
            AND CAST(sh.LastSettlementDate AS DATE) <= @end 
            AND NOT EXISTS (SELECT 1 FROM SettlementDetail sd WHERE sd.SettlementId = sh.SettlementID)
          ORDER BY sh.LastSettlementDate DESC
        `);

      const unrecordedCount = unrecordedRes.recordset.length;
      if (unrecordedCount > 0) {
        console.warn(
          "[DAY-END SUMMARY] Detected settlements without SettlementDetail rows.",
          {
            start,
            end,
            totalSales,
            detailTotal,
            diff,
            unrecordedCount,
            sampleSettlementIds: unrecordedRes.recordset
              .slice(0, 10)
              .map((r) => r.SettlementID),
          }
        );

        paymodes.push({
          Paymode: "Unknown / Unrecorded",
          Amount: diff,
          Count: unrecordedCount,
        });
      } else {
        console.warn(
          "[DAY-END SUMMARY] Total/Paymode mismatch with no header rows missing details.",
          { start, end, totalSales, detailTotal, diff }
        );
      }
    }

    // Fetch Credit Customer Payments (ReferenceType = 'MEMBER')
    const creditPaymentsRes = await pool.request()
      .input("start", sql.VarChar, start)
      .input("end", sql.VarChar, end)
      .query(`
        SELECT 
          'CREDIT PAYMENT (' + UPPER(ISNULL(pm.Description, 'CASH')) + ')' as Paymode,
          SUM(ptd.Amount) as Amount,
          COUNT(ptd.PaymentTransactionId) as Count
        FROM PaymentTransactionDetails ptd
        INNER JOIN Paymode pm ON pm.Position = ptd.PayModeId
        WHERE ptd.ReferenceType = 'MEMBER'
          AND CAST(ptd.CreatedDate AS DATE) >= @start
          AND CAST(ptd.CreatedDate AS DATE) <= @end
        GROUP BY pm.Description
      `);

    const creditPayments = creditPaymentsRes.recordset || [];
    creditPayments.forEach(p => {
      p.ReceiptCount = p.Count;
    });

    paymodes.push(...creditPayments);

    const cashTotal = paymodes.filter(p => p.Paymode === 'CASH' || p.Paymode === 'CREDIT PAYMENT (CASH)').reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);
    const otherTotal = paymodes.filter(p => p.Paymode !== 'CASH' && p.Paymode !== 'CREDIT PAYMENT (CASH)').reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);

    const billCount = Number(analysis.TotalBills) || 0;
    console.log(`[DAY-END DEBUG] billCount: ${billCount}`);
    
    // C. Settlement Paymode Breakdown
    console.log(`[DAY-END DEBUG] Fetching settlement breakdown...`);
    const settlementRes = await pool.request()
      .input("start", sql.VarChar, start)
      .input("end", sql.VarChar, end)
      .query(`
        SELECT 
          ISNULL((SELECT TOP 1 LTRIM(RTRIM(Description)) FROM Paymode pm WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(sd.Paymode))), sd.Paymode) as Paymode,
          SUM(ISNULL(sd.SysAmount, 0)) as SysAmount,
          SUM(ISNULL(sd.ManualAmount, 0)) as ManualAmount,
          SUM(ISNULL(sd.SortageOrExces, 0)) as SortageOrExces,
          CAST(SUM(ISNULL(sd.ReceiptCount, 0)) AS INT) as ReceiptCount
        FROM SettlementHeader sh
        INNER JOIN SettlementDetail sd ON sh.SettlementID = sd.SettlementId
        WHERE CAST(sh.LastSettlementDate AS DATE) >= @start
          AND CAST(sh.LastSettlementDate AS DATE) <= @end
        GROUP BY sd.Paymode
        ORDER BY SysAmount DESC
      `);

    // D. Cancelled Orders List
    const cancelledOrdersRes = await pool.request()
      .input("start", sql.VarChar, start)
      .input("end", sql.VarChar, end)
      .query(`
        SELECT 
          sh.BillNo, 
          sh.CancellationReason, 
          sh.CancelledDate, 
          sh.CancelledByUserName,
          sh.SubTotal as OriginalAmount,
          sh.VoidItemQty
        FROM SettlementHeader sh
        WHERE CAST(sh.LastSettlementDate AS DATE) >= @start
          AND CAST(sh.LastSettlementDate AS DATE) <= @end
          AND sh.IsCancelled = 1
        ORDER BY sh.LastSettlementDate DESC
      `);

    const settlementBreakdown = settlementRes.recordset || [];
    creditPayments.forEach(cp => {
      settlementBreakdown.push({
        Paymode: cp.Paymode,
        SysAmount: cp.Amount,
        ManualAmount: cp.Amount,
        SortageOrExces: 0,
        ReceiptCount: cp.Count
      });
    });

    res.json({
      success: true,
      orgInfo,
      terminalCode: analysis.TerminalCode,
      refNo: analysis.RefNo,
      paymodeDetail: paymodes,
      settlementBreakdown: settlementBreakdown,
      cancelledOrders: cancelledOrdersRes.recordset,
      settlementDetail: {
        cashTotal,
        otherTotal
      },
      salesAnalysis: {
        baseSales: analysis.BaseSales || 0,
        totalSales,
        totalTax: analysis.TotalTax || 0,
        totalDiscount: analysis.TotalDiscount || 0,
        totalServiceCharge: analysis.TotalServiceCharge || 0,
        roundOff: analysis.TotalRoundOff || 0,
        netTotal: totalSales, 
        billCount,
        avgPerBill: billCount > 0 ? (totalSales / billCount) : 0
      },
      voidDetail: {
        voidQty: analysis.VoidQty || 0,
        voidAmount: analysis.VoidAmount || 0
      },
      cancelledDetail: {
        count: analysis.CancelledCount || 0,
        amount: analysis.CancelledAmount || 0
      }
    });
  } catch (err) {
    console.error("[DAY-END SUMMARY ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

router.get("/daily/:date", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { date } = req.params;
    const startOfDay = `${date} 00:00:00`;
    const endOfDay = `${date} 23:59:59`;

    const result = await pool.request()
      .input("StartOfDay", sql.DateTime, startOfDay)
      .input("EndOfDay", sql.DateTime, endOfDay).query(`
        WITH NormalizedSales AS (
          SELECT sh.SettlementID, sts.SysAmount, ISNULL(sts.ReceiptCount, 0) AS ReceiptCount,
          ${normalizeReportPayModeSql("sts.PayMode")} AS PayMode
          FROM SettlementHeader sh
          INNER JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
          WHERE sh.LastSettlementDate BETWEEN @StartOfDay AND @EndOfDay
        )
        SELECT COUNT(DISTINCT SettlementID) as TotalTransactions, ISNULL(SUM(SysAmount), 0) as TotalSales,
        ISNULL(SUM(CASE WHEN PayMode = 'CASH' THEN SysAmount ELSE 0 END), 0) as CashSales,
        ISNULL(SUM(CASE WHEN PayMode = 'NETS' THEN SysAmount ELSE 0 END), 0) as NETS_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'PAYNOW' THEN SysAmount ELSE 0 END), 0) as PayNow_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'UPI' THEN SysAmount ELSE 0 END), 0) as UPI_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'CARD' THEN SysAmount ELSE 0 END), 0) as CardSales,
        ISNULL(SUM(CASE WHEN PayMode = 'CREDIT' OR PayMode = 'MEMBER' THEN SysAmount ELSE 0 END), 0) as MemberSales,
        ISNULL(SUM(ReceiptCount), 0) as TotalItems
        FROM NormalizedSales
      `);
    res.json(result.recordset[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/daily-order-count", async (req, res) => {
  try {
    const pool = await poolPromise;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const result = await pool.request()
      .input("Start", sql.DateTime, startOfDay)
      .input("End", sql.DateTime, endOfDay)
      .query(`
        SELECT COUNT(SettlementID) as currentCount 
        FROM SettlementHeader 
        WHERE LastSettlementDate BETWEEN @Start AND @End
      `);
    
    const count = result.recordset[0].currentCount || 0;
    res.json({ nextNumber: count + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= SAVE SALE ================= */
router.post("/save", async (req, res) => {
  try {
    const pool = await poolPromise;
    const {
      totalAmount, paymentMethod, items, subTotal, taxAmount,
      discountAmount, discountType, roundOff, orderId, orderType, tableNo, section, memberId, cashierId, tableId,
      serverId, serverName, isSplit,
      discountId, discountPercentage, discountRemarks, orderDiscountAmount, itemDiscountAmount, payments
    } = req.body;

    const validationError = validateSalePayload({ totalAmount, paymentMethod, items, payments });
    if (validationError) {
      console.warn(`[SAVE SALE] Validation failed: ${validationError}`);
      return res.status(400).json({ error: validationError });
    }    let settlementId;
    let displayOrderId = null;
    let guidOrderId;

    await runInTransaction(async (transaction) => {
      const settlementIdResult = await transaction.request().query(`SELECT NEWID() AS id`);
      settlementId = settlementIdResult.recordset[0].id;
      let billNo = ""; // Will be set to displayOrderId later

      const activeOrg = await getActiveOrganization();
      const businessUnitId = activeOrg.businessUnitId;

      // 🆕 MEMBER / CREDIT VALIDATION
      if (memberId) {
        const payUpper = (paymentMethod || "").toUpperCase().trim();
        if (payUpper === "CREDIT") {
          const creditCheck = await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, memberId)
            .query("SELECT CreditLimit, CurrentBalance, IsActive FROM CreditCustomerMaster WITH (UPDLOCK) WHERE CustomerId = @CustomerId");
          
          if (creditCheck.recordset.length === 0) {
            throw new Error("Credit Customer not found");
          }
          
          const customer = creditCheck.recordset[0];
          if (!customer.IsActive) {
            throw new Error("Credit Customer is inactive");
          }
          
          const currentBalance = parseFloat(customer.CurrentBalance) || 0;
          const creditLimit = parseFloat(customer.CreditLimit) || 0;
          if (currentBalance + parseFloat(totalAmount) > creditLimit) {
            throw new Error("Credit Limit Exceeded");
          }
        } else if (payUpper === "MEMBER") {
          const memberCheck = await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, memberId)
            .query("SELECT CreditLimit, CurrentBalance, IsActive FROM MemberMaster WITH (UPDLOCK) WHERE MemberId = @MemberId");
          
          if (memberCheck.recordset.length === 0) {
            throw new Error("Member not found");
          }
          
          const member = memberCheck.recordset[0];
          if (!member.IsActive) {
            throw new Error("Member is inactive");
          }
          
          const currentBalance = parseFloat(member.CurrentBalance) || 0;
          const creditLimit = parseFloat(member.CreditLimit) || 0;
          if (currentBalance + parseFloat(totalAmount) > creditLimit) {
            throw new Error("Credit Limit Exceeded");
          }
        }
      }

    // 2. Order ID Retrieval
    const now = new Date();
    displayOrderId = null;
    let dailySequence = 0;

    if (tableId) {
        const tableCheck = await transaction.request()
            .input("tid", sql.UniqueIdentifier, String(tableId).replace(/^\{|\}$/g, "").trim())
            .query("SELECT CurrentOrderId FROM TableMaster WITH (UPDLOCK) WHERE TableId = @tid");
        displayOrderId = tableCheck.recordset[0]?.CurrentOrderId;
        
        if (displayOrderId && displayOrderId.includes('-')) {
            dailySequence = parseInt(displayOrderId.split('-')[1]) || 0;
        }
    }

    if (!displayOrderId) {
        // Fallback: Generate a new one if none exists (e.g., takeaway or direct pay)
        const todayStr = new Date().toLocaleDateString('en-CA'); 
        
        let seqResult = await transaction.request()
            .input("RestId", sql.UniqueIdentifier, businessUnitId)
            .input("Today", sql.Date, todayStr)
            .query(`
              UPDATE OrderSequences 
              SET LastNumber = LastNumber + 1 
              OUTPUT INSERTED.LastNumber
              WHERE RestaurantId = @RestId AND SequenceDate = @Today
            `);

        if (seqResult.recordset.length > 0) {
            dailySequence = seqResult.recordset[0].LastNumber;
        } else {
            await transaction.request()
                .input("RestId", sql.UniqueIdentifier, businessUnitId)
                .input("Today", sql.Date, todayStr)
                .query(`
                  INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber)
                  VALUES (@RestId, @Today, 1)
                `);
            dailySequence = 1;
        }
        displayOrderId = `${todayStr.replace(/-/g, '')}-${String(dailySequence).padStart(4, '0')}`;
        console.log(`[SAVE SALE] Generated NEW ID: ${displayOrderId}`);
    } else {
        console.log(`[SAVE SALE] Using EXISTING ID: ${displayOrderId} (Seq: ${dailySequence})`);
    }

    // 2.5 Fetch Voided Items from Professional Detail Tables
    let voidQty = 0;
    let voidAmount = 0;
        const voidRes = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query(`
                SELECT SUM(d.Quantity) as VQty, SUM(d.TotalDetailLineAmount) as VAmt 
                FROM RestaurantOrderDetailCur d
                JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
                WHERE h.OrderNumber = @orderNo AND d.StatusCode = 0
            `);
        voidQty = voidRes.recordset[0]?.VQty || 0;
        voidAmount = voidRes.recordset[0]?.VAmt || 0;
        console.log(`[SAVE SALE] Voids captured from DB: Qty=${voidQty}, Amt=${voidAmount}`);

        // 🚀 SYNC SYIELD: Fetch Master GUID OrderId for Relation Integrity
        const guidRes = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query("SELECT TOP 1 OrderId FROM RestaurantOrderCur WITH (UPDLOCK) WHERE OrderNumber = @orderNo");
        const guidOrderId = guidRes.recordset[0]?.OrderId || settlementId; 
        console.log(`[SAVE SALE] Master Sync -> GUID OrderId: ${guidOrderId} (Source: ${guidRes.recordset[0]?.OrderId ? 'Current' : 'Fallback-Settlement'})`);

    // Split Bill unique bill/invoice suffix generator
    let finalBillNo = displayOrderId;
    let splitIndexValue = null;
    if (isSplit) {
      const splitCountResult = await transaction.request()
        .input("OrderId", sql.UniqueIdentifier, guidOrderId)
        .query("SELECT COUNT(*) as count FROM RestaurantInvoice WHERE OrderId = @OrderId");
      const splitCount = splitCountResult.recordset[0].count + 1;
      finalBillNo = `${displayOrderId}-S${splitCount}`;
      splitIndexValue = splitCount;
    }
    console.log(`[SAVE SALE] Final Bill No: ${finalBillNo} (isSplit: ${isSplit || false}, index: ${splitIndexValue || "none"})`);

    // Merge history count retriever
    const mergeCountResult = await transaction.request()
      .input("OrderId", sql.UniqueIdentifier, guidOrderId)
      .query("SELECT COUNT(*) as count FROM OrderMergeHistory WHERE ParentOrderId = @OrderId");
    const childCount = mergeCountResult.recordset[0].count;
    const mergeCount = childCount > 0 ? childCount + 1 : null;
    console.log(`[SAVE SALE] Merge Count: ${mergeCount || "none"} (child count: ${childCount})`);

    const normalizedPayMode = normalizePayMode(paymentMethod);
    const payModeCode = normalizedPayMode === "CASH" ? 1 : normalizedPayMode === "CARD" ? 2 : 3;

    const headerResult = await transaction.request()
      .input("SettlementID", sql.UniqueIdentifier, settlementId)
      .input("LastSettlementDate", sql.DateTime, now)
      .input("SubTotal", sql.Money, subTotal || 0)
      .input("TotalTax", sql.Money, taxAmount || 0)
      .input("DiscountAmount", sql.Money, orderDiscountAmount || 0)
      .input("DiscountType", sql.NVarChar(50), discountType || "fixed")
      .input("BillNo", sql.NVarChar(50), finalBillNo)
      .input("OrderType", sql.NVarChar(50), orderType || "DINE-IN")
      .input("TableNo", sql.NVarChar(50), tableNo || null)
      .input("Section", sql.NVarChar(100), section || null)
      .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
      .input("CashierID", sql.UniqueIdentifier, toGuidOrNull(cashierId))
      .input("BusinessUnitId", sql.UniqueIdentifier, sanitizeGuid(businessUnitId))
      .input("SysAmount", sql.Money, totalAmount || 0)
      .input("ManualAmount", sql.Money, totalAmount || 0)
      .input("CreatedBy", sql.UniqueIdentifier, sanitizeGuid(cashierId))
      .input("CreatedOn", sql.DateTime, now)
      .input("SER_NAME", sql.NVarChar(255), req.body.serverName || null)
      .input("MobileNo", sql.NVarChar(50), req.body.mobileNo || req.body.MobileNo || null)
      .input("VoidItemQty", sql.Int, voidQty)
      .input("VoidItemAmount", sql.Money, voidAmount)
      .input("RoundedBy", sql.Money, roundOff || 0)
      .input("ServiceCharge", sql.Money, req.body.serviceCharge || 0)
      .input("PayModeCode", sql.Int, payModeCode)
      .input("DailySeq", sql.Int, dailySequence || 0)
      .input("OrderId", sql.UniqueIdentifier, guidOrderId)
      .input("DiscountId", sql.UniqueIdentifier, toGuidOrNull(discountId))
      .input("DiscountPercentage", sql.Decimal(18, 2), discountPercentage || null)
      .input("DiscountRemarks", sql.NVarChar(1000), discountRemarks || null)
      .input("TotalDiscountAmount", sql.Decimal(18, 2), discountAmount || 0)
      .input("TotalLineItemDiscountAmount", sql.Decimal(18, 2), itemDiscountAmount || 0)
      .input("MergeCount", sql.Numeric, mergeCount)
      .input("SplitCount", sql.Numeric, splitIndexValue)
      .query(`
        -- 1. Insert into SettlementHeader
        INSERT INTO SettlementHeader (
          SettlementID, LastSettlementDate, LastDayEndDate, SubTotal, TotalTax, DiscountAmount, DiscountType, 
          BillNo, OrderType, TableNo, Section, MemberId, CashierID, BusinessUnitId, 
          SysAmount, ManualAmount, CreatedBy, CreatedOn, SER_NAME, MobileNo, 
          VoidItemQty, VoidItemAmount, RoundedBy, ServiceCharge
        ) VALUES (
          @SettlementID, GETDATE(), GETDATE(), @SubTotal, @TotalTax, @DiscountAmount, @DiscountType, 
          @BillNo, @OrderType, @TableNo, @Section, @MemberId, @CashierID, @BusinessUnitId, 
          @SysAmount, @ManualAmount, @CreatedBy, GETDATE(), @SER_NAME, @MobileNo, 
          @VoidItemQty, @VoidItemAmount, @RoundedBy, @ServiceCharge
        );

        -- 2. Insert into RestaurantInvoice (Perfect Sync)
        INSERT INTO RestaurantInvoice (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, DiscountId, DiscountPercentage, DiscountRemarks, TotalDiscountAmount,
          TotalLineItemDiscountAmount, MergeCount, SplitCount
        ) VALUES (
          @BusinessUnitId, @SettlementID, @OrderId, @BillNo, GETDATE(), GETDATE(),
          @SubTotal, @TotalTax, @DiscountAmount, @SysAmount, 5,
          @CreatedBy, GETDATE(), CAST(GETDATE() AS DATE), @ServiceCharge, @RoundedBy, @SubTotal,
          @PayModeCode, @DiscountId, @DiscountPercentage, @DiscountRemarks, @TotalDiscountAmount,
          @TotalLineItemDiscountAmount, @MergeCount, @SplitCount
        );

        -- 2b. Insert into RestaurantInvoiceCur (Mirror for Backoffice Sync)
        INSERT INTO RestaurantInvoiceCur (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, DiscountId, DiscountPercentage, DiscountRemarks, TotalDiscountAmount,
          TotalLineItemDiscountAmount, MergeCount, SplitCount
        ) VALUES (
          @BusinessUnitId, @SettlementID, @OrderId, @BillNo, GETDATE(), GETDATE(),
          @SubTotal, @TotalTax, @DiscountAmount, @SysAmount, 5,
          @CreatedBy, GETDATE(), CAST(GETDATE() AS DATE), @ServiceCharge, @RoundedBy, @SubTotal,
          @PayModeCode, @DiscountId, @DiscountPercentage, @DiscountRemarks, @TotalDiscountAmount,
          @TotalLineItemDiscountAmount, @MergeCount, @SplitCount
        );
      `);

    // 3. Insert SettlementTotalSales
    const receiptCount = Array.isArray(items) ? items.filter(i => i.status !== "VOIDED").reduce((sum, item) => sum + (Number(item.qty) || 0), 0) : 0;

      console.log(`[SAVE SALE] Step 3: Inserting Settlement Tables (ID: ${settlementId})...`);
      
      if (payments && Array.isArray(payments) && payments.length > 0) {
        if (Number(discountAmount) > 0) {
          const discReq = transaction.request()
            .input("SettlementID", sql.UniqueIdentifier, settlementId)
            .input("DiscountID", sql.UniqueIdentifier, DEFAULT_GUID)
            .input("DiscountDesc", sql.VarChar(255), String(discountType || "Fixed") + " Discount")
            .input("DiscAmount", sql.Money, discountAmount);
          await discReq.query(`
            INSERT INTO SettlementDiscountDetail (SettlementId, DiscountId, Description, SysAmount, ManualAmount, SortageOrExces)
            VALUES (@SettlementID, @DiscountID, @DiscountDesc, @DiscAmount, @DiscAmount, 0);
          `);
        }
      } else {
        let settlementSql = `
          INSERT INTO SettlementTotalSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount)
          VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount);

          INSERT INTO [dbo].[SettlementDetail] (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected)
          VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount, 0);

          INSERT INTO SettlementTranDetail (SettlementID, PayMode, CashIn, CashOut)
          VALUES (@SettlementID, @PayMode, @SysAmount, 0);
        `;

        if (normalizedPayMode === 'CREDIT') {
          settlementSql += `
            INSERT INTO SettlementCreditSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff)
            VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff);
          `;
        }

        if (Number(discountAmount) > 0) {
          settlementSql += `
            INSERT INTO SettlementDiscountDetail (SettlementId, DiscountId, Description, SysAmount, ManualAmount, SortageOrExces)
            VALUES (@SettlementID, @DiscountID, @DiscountDesc, @DiscAmount, @DiscAmount, 0);
          `;
        }

        const settlementReq = transaction.request()
          .input("SettlementID", sql.UniqueIdentifier, settlementId)
          .input("PayMode", sql.VarChar(50), normalizedPayMode)
          .input("SysAmount", sql.Money, totalAmount || 0)
          .input("ManualAmount", sql.Money, totalAmount || 0)
          .input("AmountDiff", sql.Money, 0)
          .input("ReceiptCount", sql.Numeric(18, 0), receiptCount);

        if (Number(discountAmount) > 0) {
          settlementReq.input("DiscountID", sql.UniqueIdentifier, DEFAULT_GUID)
            .input("DiscountDesc", sql.VarChar(255), String(discountType || "Fixed") + " Discount")
            .input("DiscAmount", sql.Money, discountAmount);
        }

        await settlementReq.query(settlementSql);
        console.log(`[SAVE SALE] Settlement tables updated successfully.`);
      }

      if (items && Array.isArray(items)) {
        for (const item of items) {
          console.log(`[SAVE SALE] Step 4: Item [${item.dish_name || item.name}]...`);
          const dishId = toGuidOrNull(item.dishId || item.id);
          const dishMeta = await transaction.request()
            .input("DishId", sql.UniqueIdentifier, dishId)
            .input("DishName", sql.NVarChar(255), item.dish_name || item.name || "")
            .query(`
              SELECT TOP 1 d.DishId, d.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName
              FROM DishMaster d
              LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
              LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
              WHERE (@DishId IS NOT NULL AND d.DishId = @DishId)
                 OR (@DishId IS NULL AND LTRIM(RTRIM(LOWER(d.Name))) = LTRIM(RTRIM(LOWER(@DishName))))
            `);
          const meta = dishMeta.recordset[0] || {};
          await transaction.request()
            .input("SettlementID", sql.UniqueIdentifier, settlementId)
            .input("DishId", sql.UniqueIdentifier, toGuidOrNull(meta.DishId || dishId))
            .input("DishGroupId", sql.UniqueIdentifier, toGuidOrNull(meta.DishGroupId))
            .input("SubCategoryId", sql.UniqueIdentifier, toGuidOrNull(meta.DishGroupId))
            .input("CategoryId", sql.UniqueIdentifier, toGuidOrNull(meta.CategoryId))
            .input("DishName", sql.NVarChar(255), item.dish_name || item.name || "Unknown")
            .input("CategoryName", sql.NVarChar(255), meta.CategoryName || item.categoryName || "Unmapped")
            .input("SubCategoryName", sql.NVarChar(255), meta.DishGroupName || "Unmapped")
            .input("Qty", sql.Int, item.qty || 1)
            .input("Price", sql.Decimal(18, 2), item.price || 0)
            .input("ItemDiscountAmount", sql.Decimal(18, 2), Number(item.discountAmount) || null)
            .input("ItemDiscountType", sql.NVarChar(50), item.discountType || (Number(item.discountAmount) > 0 ? "percentage" : null))
            .input("Status", sql.NVarChar(50), item.status || "NORMAL")
            .input("Spicy", sql.NVarChar(50), item.spicy || "")
            .input("Salt", sql.NVarChar(50), item.salt || "")
            .input("Oil", sql.NVarChar(50), item.oil || "")
            .input("Sugar", sql.NVarChar(50), item.sugar || "")
            .input("OrderDateTime", sql.DateTime, new Date())
            .input("OrderDetailId", sql.UniqueIdentifier, toGuidOrNull(item.lineItemId))
            .query(`
              INSERT INTO SettlementItemDetail (SettlementID, DishId, DishGroupId, SubCategoryId, CategoryId, DishName, Qty, Price, OrderDateTime, CategoryName, SubCategoryName, DiscountAmount, DiscountType, Status, Spicy, Salt, Oil, Sugar, OrderDetailId)
              VALUES (@SettlementID, @DishId, @DishGroupId, @SubCategoryId, @CategoryId, @DishName, @Qty, @Price, @OrderDateTime, @CategoryName, @SubCategoryName, @ItemDiscountAmount, @ItemDiscountType, @Status, @Spicy, @Salt, @Oil, @Sugar, @OrderDetailId)
            `);
        }
      }

      // 4.5 Capture and Insert VOIDED items for reporting
      if (displayOrderId) {
        try {
          const dbVoids = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query(`
              SELECT d.OrderDetailId, d.DishId, d.DishName, d.Quantity, d.PricePerUnit, dish.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName
              FROM RestaurantOrderDetailCur d
              JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
              LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
              LEFT JOIN DishGroupMaster dg ON dish.DishGroupId = dg.DishGroupId
              LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
              WHERE h.OrderNumber = @orderNo AND d.StatusCode = 0
            `);
          
          for (const v of dbVoids.recordset) {
            await transaction.request()
              .input("sid", sql.UniqueIdentifier, settlementId)
              .input("dishId", sql.UniqueIdentifier, v.DishId)
              .input("dishName", sql.NVarChar(255), v.DishName)
              .input("qty", sql.Int, v.Quantity)
              .input("price", sql.Decimal(18, 2), v.PricePerUnit)
              .input("catId", sql.UniqueIdentifier, v.CategoryId)
              .input("catName", sql.NVarChar(255), v.CategoryName)
              .input("groupName", sql.NVarChar(255), v.DishGroupName)
              .input("OrderDetailId", sql.UniqueIdentifier, toGuidOrNull(v.OrderDetailId))
              .query(`
                INSERT INTO SettlementItemDetail (
                  SettlementID, DishId, DishName, Qty, Price, Status, OrderDateTime,
                  CategoryId, CategoryName, SubCategoryName, OrderDetailId
                ) VALUES (
                  @sid, @dishId, @dishName, @qty, @price, 'VOIDED', GETDATE(),
                  @catId, @catName, @groupName, @OrderDetailId
                )
              `);
          }
          console.log(`[SAVE SALE] Captured ${dbVoids.recordset.length} voided items for reporting.`);
        } catch (voidErr) {
          console.error("⚠️ [SAVE SALE] Void capture failed:", voidErr.message);
        }
      }

      if (payments && Array.isArray(payments) && payments.length > 0) {
        console.log(`[SAVE SALE] Processing Split Payments for Bill ${settlementId}...`);
        try {
          await processSplitPayments({
            referenceType: "BILL",
            referenceId: settlementId,
            payments,
            transaction,
            businessUnitId: sanitizeGuid(businessUnitId),
            cashierId: sanitizeGuid(cashierId),
            orderId: guidOrderId,
            now,
            receiptCount
          });

          // Update member balance if credit was used
          if (memberId) {
            const pmRequest = new sql.Request(transaction);
            const pmRes = await pmRequest.query("SELECT Position, PayMode FROM [dbo].[Paymode] WHERE Active = 1");
            const activePMs = pmRes.recordset;

            let memberPaidAmt = 0;
            let creditPaidAmt = 0;
            for (const p of payments) {
              const pmInfo = activePMs.find(x => 
                x.Position === Number(p.payModeId) || 
                String(x.PayMode).trim().toUpperCase() === String(p.payModeId || p.payMode || "").trim().toUpperCase()
              );
              if (pmInfo) {
                const modeUpper = pmInfo.PayMode.toUpperCase().trim();
                if (modeUpper === "MEMBER") {
                  memberPaidAmt += parseFloat(p.amount) || 0;
                } else if (modeUpper === "CREDIT") {
                  creditPaidAmt += parseFloat(p.amount) || 0;
                }
              }
            }

            if (memberPaidAmt > 0) {
              await transaction.request()
                .input("MemberId", memberId)
                .input("Amount", memberPaidAmt)
                .query(`UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @Amount WHERE MemberId = @MemberId`);
              console.log(`[SAVE SALE] Updated member balance in MemberMaster: ${memberPaidAmt}`);
            }

            if (creditPaidAmt > 0) {
              await transaction.request()
                .input("CustomerId", memberId)
                .input("Amount", creditPaidAmt)
                .query(`UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance + @Amount WHERE CustomerId = @CustomerId`);
              
              await transaction.request()
                .input("MemberId", memberId)
                .input("SettlementId", settlementId)
                .input("BillNo", finalBillNo)
                .input("Amount", creditPaidAmt)
                .input("CreatedBy", toGuidOrNull(cashierId))
                .query(`
                  INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy)
                  VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @Amount, 0, @Amount, 'OPEN', 'Split credit purchase', @CreatedBy)
                `);
              console.log(`[SAVE SALE] Updated credit customer balance and wrote split credit ledger debit: ${creditPaidAmt}`);
            }
          }
        } catch (payErr) {
          console.error(`[SAVE SALE ERROR] processSplitPayments Failed for Order ${guidOrderId}:`, payErr.message);
          throw payErr;
        }
      } else {
        console.log(`[SAVE SALE] Step 5: Inserting Payment Data (PayMode: ${normalizedPayMode})...`);
        console.log(`[TRACE] [${Date.now()}] [SETTLEMENT_SYNC] Order: ${displayOrderId} | Settlement: ${settlementId} | Amount: ${totalAmount} | Mode: ${normalizedPayMode}`);

        const paymodeRow = await transaction.request()
          .input("PayModeCode", sql.VarChar(50), normalizedPayMode)
          .query(`SELECT TOP 1 ISNULL(Position, 1) AS Position FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(PayMode)) = @PayModeCode`);
        const paymodePosition = paymodeRow.recordset.length > 0 ? paymodeRow.recordset[0].Position : 1;

        try {
          const payResult = await transaction.request()
            .input("PaymentId", sql.UniqueIdentifier, settlementId)
            .input("RestaurantBillId", sql.UniqueIdentifier, settlementId)
            .input("OrderId", sql.UniqueIdentifier, guidOrderId)
            .input("BilledFor", sql.Int, 1)
            .input("PaymentCollectedOn", sql.DateTime, new Date())
            .input("PaymentType", sql.Int, 1)
            .input("Paymode", sql.Int, paymodePosition)
            .input("Amount", sql.Decimal(18, 2), totalAmount || 0)
            .input("ReferenceNumber", sql.VarChar(100), null)
            .input("Remarks", sql.VarChar(500), paymentMethod || "")
            .input("BusinessUnitId", sql.UniqueIdentifier, sanitizeGuid(businessUnitId))
            .input("CreatedBy", sql.UniqueIdentifier, sanitizeGuid(cashierId))
            .input("CreatedOn", sql.DateTime, new Date())
            .input("ModifiedBy", sql.UniqueIdentifier, sanitizeGuid(cashierId))
            .input("ModifiedOn", sql.DateTime, new Date())
            .query(`
              -- 🛡️ ATOMIC SYNC: Populating both tables in one go for report integrity
              
              -- 1. Current Table (for POS views)
              INSERT INTO [dbo].[PaymentDetailCur] (PaymentId, RestaurantBillId, BilledFor, PaymentCollectedOn, PaymentType, Paymode, Amount, ReferenceNumber, Remarks, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn)
              VALUES (@PaymentId, @RestaurantBillId, @BilledFor, @PaymentCollectedOn, @PaymentType, @Paymode, @Amount, @ReferenceNumber, @Remarks, @BusinessUnitId, @CreatedBy, @CreatedOn, @ModifiedBy, @ModifiedOn);

              -- 2. Master Table (CRITICAL for Backoffice Reports: vw_PaymentDetail)
              INSERT INTO [dbo].[PaymentDetail] (
                PaymentId, RestaurantBillId, SettlementId, InvoiceId, OrderId, BilledFor, PaymentCollectedOn, 
                PaymentType, Paymode, Amount, ReferenceNumber, Remarks, BusinessUnitId, 
                CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, isSettlement
              ) VALUES (
                @PaymentId, @RestaurantBillId, @RestaurantBillId, @RestaurantBillId, @OrderId, @BilledFor, @PaymentCollectedOn, 
                @PaymentType, @Paymode, @Amount, @ReferenceNumber, @Remarks, @BusinessUnitId, 
                @CreatedBy, @CreatedOn, @ModifiedBy, @ModifiedOn, 1
              );
            `);
          console.log(`[SAVE SALE] PaymentDetail Sync Success. Rows affected: ${payResult.rowsAffected.join(', ')}`);
        } catch (payErr) {
          console.error(`[SAVE SALE ERROR] PaymentDetail Insert Failed for Order ${guidOrderId}:`, payErr.message);
          throw payErr; // Throw to trigger transaction rollback
        }

        if (memberId) {
          const payUpper = (paymentMethod || "").toUpperCase().trim();
          if (payUpper === "CREDIT") {
            await transaction.request()
              .input("CustomerId", memberId)
              .input("Amount", totalAmount || 0)
              .query(`UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance + @Amount WHERE CustomerId = @CustomerId`);

            await transaction.request()
              .input("MemberId", memberId)
              .input("SettlementId", settlementId)
              .input("BillNo", finalBillNo)
              .input("Amount", totalAmount || 0)
              .input("CreatedBy", toGuidOrNull(cashierId))
              .query(`
                INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy)
                VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @Amount, 0, @Amount, 'OPEN', 'Credit purchase', @CreatedBy)
              `);
            console.log(`[SAVE SALE] Updated credit customer balance and wrote single credit ledger debit: ${totalAmount}`);
          } else if (payUpper === "MEMBER") {
            await transaction.request()
              .input("MemberId", memberId)
              .input("Amount", totalAmount || 0)
              .query(`UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @Amount WHERE MemberId = @MemberId`);
            console.log(`[SAVE SALE] Updated member balance in MemberMaster: ${totalAmount}`);
          }
        }
      }

      // ================= SPLIT BILL QUANTITY SUBTRACTION =================
      let hasRemaining = false;
      let remainingTotal = 0;

      if (isSplit && Array.isArray(items)) {
        console.log(`[SAVE SALE] Processing Split Bill subtraction for order ${displayOrderId}...`);
        for (const item of items) {
          const detailId = toGuidOrNull(item.lineItemId);
          if (detailId) {
            const qtyPaid = Number(item.qty) || 0;
            console.log(`[SAVE SALE] Split subtract: Item ${item.name} (${detailId}) PaidQty=${qtyPaid}`);
            
            // Concurrency Check: Ensure sufficient quantity (prevents double-tap issues)
            const qtyCheck = await transaction.request()
              .input("detailId", sql.UniqueIdentifier, detailId)
              .query("SELECT Quantity FROM RestaurantOrderDetailCur WITH (UPDLOCK) WHERE OrderDetailId = @detailId");
              
            if (qtyCheck.recordset.length === 0 || qtyCheck.recordset[0].Quantity < qtyPaid) {
               throw new Error(`Insufficient quantity available for split item ${item.name}. Transaction aborted.`);
            }

            // Subtract quantity from detail record
            await transaction.request()
              .input("detailId", sql.UniqueIdentifier, detailId)
              .input("qtyPaid", sql.Decimal(18, 2), qtyPaid)
              .query(`
                UPDATE RestaurantOrderDetailCur
                SET Quantity = Quantity - @qtyPaid,
                    ActualAmount = (Quantity - @qtyPaid) * PricePerUnit,
                    TotalDetailLineAmount = (Quantity - @qtyPaid) * PricePerUnit,
                    BaseAmount = (Quantity - @qtyPaid) * PricePerUnit
                WHERE OrderDetailId = @detailId
              `);

            // If quantity <= 0, delete modifiers and item
            await transaction.request()
              .input("detailId", sql.UniqueIdentifier, detailId)
              .query(`
                DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId = @detailId AND @detailId IN (
                  SELECT OrderDetailId FROM RestaurantOrderDetailCur WHERE OrderDetailId = @detailId AND Quantity <= 0
                );
                DELETE FROM RestaurantOrderDetailCur WHERE OrderDetailId = @detailId AND Quantity <= 0;
              `);
          }
        }

        // Check if there are any active items left in this order
        const remainingItems = await transaction.request()
          .input("guidOrderId", sql.UniqueIdentifier, guidOrderId)
          .query(`SELECT COUNT(*) as count FROM RestaurantOrderDetailCur WHERE OrderId = @guidOrderId AND StatusCode <> 0`);
        hasRemaining = remainingItems.recordset[0].count > 0;

        if (hasRemaining) {
          // Calculate remaining total
          const combinedTotalRes = await transaction.request()
            .input("guidOrderId", sql.UniqueIdentifier, guidOrderId)
            .query(`SELECT SUM(TotalDetailLineAmount) as Total FROM RestaurantOrderDetailCur WHERE OrderId = @guidOrderId AND StatusCode <> 0`);
          remainingTotal = combinedTotalRes.recordset[0].Total || 0;
        }
      }

      // 🚀 PROFESSIONAL ARCHIVE: Move from Cur to History (Only run if not split, or if split has no remaining items)
      if (displayOrderId && (!isSplit || !hasRemaining)) {
        try {
          await transaction.request()
            .input("orderNo", sql.NVarChar(50), displayOrderId)
            .input("totalAmt", sql.Decimal(18, 2), totalAmount)
            .input("subTotal", sql.Decimal(18, 2), subTotal || 0)
            .input("DiscountId", sql.UniqueIdentifier, toGuidOrNull(discountId))
            .input("DiscountPercentage", sql.Decimal(18, 2), discountPercentage || null)
            .input("DiscountRemarks", sql.NVarChar(1000), discountRemarks || null)
            .input("TotalDiscountAmount", sql.Decimal(18, 2), discountAmount || 0)
            .input("TotalLineItemDiscountAmount", sql.Decimal(18, 2), itemDiscountAmount || 0)
            .input("DiscountAmount", sql.Money, orderDiscountAmount || 0)
            .input("RoundedBy", sql.Money, roundOff || 0)
            .input("isTakeaway", sql.Bit, (orderType === "TAKEAWAY" || !tableId || tableId === "undefined" || tableId === "null" || String(tableId).startsWith("TAKEAWAY")) ? 1 : 0)
            .input("ServiceCharge", sql.Decimal(18, 2), req.body.serviceCharge || 0)
            .query(`
              DECLARE @Section INT = 4;
              DECLARE @PriorityCode INT = NULL;
              
              SELECT TOP 1 @Section = ISNULL(t.DiningSection, 4)
              FROM RestaurantOrderCur r
              LEFT JOIN TableMaster t ON r.Tableno = t.TableNumber
              WHERE r.OrderNumber = @orderNo;

              IF @Section = 1 SET @PriorityCode = 1
              ELSE IF @Section = 2 SET @PriorityCode = 2
              ELSE IF @Section = 3 SET @PriorityCode = 3
              ELSE IF @Section = 4 SET @PriorityCode = 4

              -- Ensure parent order has the correct final TotalAmount, RoundedBy, and Discounts in Cur before moving
              UPDATE RestaurantOrderCur 
              SET TotalAmount = @totalAmt,
                  TotalLineItemAmount = @subTotal,
                  TotalLineItemDiscountAmount = @TotalLineItemDiscountAmount,
                  DiscountAmount = @DiscountAmount,
                  DiscountPercentage = @DiscountPercentage,
                  TotalDiscountAmount = @TotalDiscountAmount,
                  RoundedBy = @RoundedBy,
                  DiscountId = @DiscountId,
                  DiscountRemarks = @DiscountRemarks,
                  IsTakeAway = @isTakeaway,
                  ServiceCharge = @ServiceCharge,
                  isGuestMeal = ISNULL((SELECT TOP 1 isGuestMeal FROM [dbo].[Discount] WHERE DiscountId = @DiscountId), 0)
              WHERE OrderNumber = @orderNo;

              -- Move Header (History) - For Parent Order
              IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'TotalAmount')
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge
                 )
                 SELECT 
                   OrderId, OrderNumber, OrderDateTime, Tableno, 3, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, 1, ISNULL(PriorityCode, @PriorityCode),
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, GETDATE(), ServiceCharge
                 FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
              END
              ELSE
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode, TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge
                 )
                 SELECT 
                   OrderId, OrderNumber, OrderDateTime, Tableno, 3, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, 1, ISNULL(PriorityCode, @PriorityCode), TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, GETDATE(), ServiceCharge
                 FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
              END

              -- Move Header (History) - For Child Merged Orders (so they aren't considered 'missing' bills)
              IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'TotalAmount')
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge
                 )
                 SELECT 
                   r.OrderId, r.OrderNumber, r.OrderDateTime, r.Tableno, 3, r.CreatedBy, r.CreatedOn, r.MobileNo, r.BusinessUnitId, 1, ISNULL(r.PriorityCode, @PriorityCode),
                   r.TotalLineItemAmount, r.TotalLineItemDiscountAmount, r.DiscountAmount, r.DiscountPercentage, r.TotalDiscountAmount, r.RoundedBy, r.isGuestMeal, r.DiscountId, r.DiscountRemarks, r.IsTakeAway, GETDATE(), r.ServiceCharge
                 FROM RestaurantOrderCur r
                 INNER JOIN OrderMergeHistory omh ON r.OrderId = omh.ChildOrderId
                 WHERE omh.ParentOrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                   AND NOT EXISTS (SELECT 1 FROM RestaurantOrder ro WHERE ro.OrderId = r.OrderId);
              END
              ELSE
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode, TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge
                 )
                 SELECT 
                   r.OrderId, r.OrderNumber, r.OrderDateTime, r.Tableno, 3, r.CreatedBy, r.CreatedOn, r.MobileNo, r.BusinessUnitId, 1, ISNULL(r.PriorityCode, @PriorityCode), 0,
                   r.TotalLineItemAmount, r.TotalLineItemDiscountAmount, r.DiscountAmount, r.DiscountPercentage, r.TotalDiscountAmount, r.RoundedBy, r.isGuestMeal, r.DiscountId, r.DiscountRemarks, r.IsTakeAway, GETDATE(), r.ServiceCharge
                 FROM RestaurantOrderCur r
                 INNER JOIN OrderMergeHistory omh ON r.OrderId = omh.ChildOrderId
                 WHERE omh.ParentOrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                   AND NOT EXISTS (SELECT 1 FROM RestaurantOrder ro WHERE ro.OrderId = r.OrderId);
              END

              -- Move Details (History) with safety for Discount columns
              -- NOTE: isTakeAway comes from the ORDER HEADER (RestaurantOrderCur), not the detail row,
              --       because detail rows always store 0 for dine-in. The header was already updated above.
              INSERT INTO RestaurantOrderDetail (
                OrderDetailId, OrderId, DishId, Description, DishName, Quantity, PricePerUnit, 
                ActualAmount, TotalDetailLineAmount, BaseAmount, StatusCode, CreatedBy, CreatedOn, 
                BusinessUnitId, OrderDateTime, Spicy, Salt, Oil, Sugar, Remarks, 
                OrderConfirmQty, VoidReason, DiscountAmount, DiscountType, isTakeAway, ManualDiscountAmount
              )
              SELECT 
                d.OrderDetailId, d.OrderId, d.DishId, d.Description, d.DishName, d.Quantity, d.PricePerUnit, 
                d.ActualAmount, d.TotalDetailLineAmount,
                ISNULL(d.BaseAmount, d.PricePerUnit * d.Quantity),
                d.StatusCode, d.CreatedBy, d.CreatedOn, 
                d.BusinessUnitId, d.OrderDateTime, d.Spicy, d.Salt, d.Oil, d.Sugar, d.Remarks, 
                d.OrderConfirmQty, d.VoidReason, 
                ISNULL(d.DiscountAmount, 0), ISNULL(d.DiscountType, 'fixed'),
                ISNULL(h.IsTakeAway, ISNULL(d.isTakeAway, 0)),
                ISNULL(d.DiscountAmount, 0)
              FROM RestaurantOrderDetailCur d
              INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
              WHERE h.OrderNumber = @orderNo;

              -- Move Modifiers (History)
              INSERT INTO Restaurantmodifierdetail (OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, Description, CreatedBy, CreatedOn)
              SELECT OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, ModifierName, CreatedBy, CreatedOn
              FROM RestaurantmodifierdetailCur WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo);
            `);
          console.log(`[SAVE SALE] Professional Archive complete for ${displayOrderId}`);
        } catch (archiveErr) {
          console.error("⚠️ [SAVE SALE] Professional Archive failed:", archiveErr.message);
        }
      }

      // 4. Cleanup Table & Cart on success
      if (tableId) {
        const cleanTableId = String(tableId).replace(/^\{|\}$/g, "").trim();
        
        if (isSplit && hasRemaining) {
          console.log(`[SAVE SALE] Split bill partial payment. Remaining Total: ${remainingTotal}`);
          // Partially paid: DO NOT clear table status. Just update total.
          await transaction.request()
            .input("tid", sql.NVarChar(128), cleanTableId)
            .input("total", sql.Decimal(18, 2), remainingTotal)
            .query("UPDATE [dbo].[TableMaster] SET TotalAmount = @total WHERE TableId = @tid");

          const io = req.app.get("io");
          if (io) {
            io.emit("table_status_updated", { tableId: cleanTableId.toLowerCase(), status: 1, totalAmount: remainingTotal });
            io.emit("cart_updated", { tableId: cleanTableId.toLowerCase(), orderId: displayOrderId });
          }
        } else {
          // Fully paid or normal sale: complete cleanup
          console.log(`[SAVE SALE] Cleaning up table: ${cleanTableId}`);
          await transaction.request()
            .input("cartId", sql.NVarChar(128), cleanTableId)
            .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");
            
          await transaction.request()
            .input("tid", sql.NVarChar(128), cleanTableId)
            .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL WHERE TableId = @tid");

          const io = req.app.get("io");
          if (io) {
            io.emit("table_status_updated", { tableId: cleanTableId.toLowerCase(), status: 0, totalAmount: 0 });
            io.emit("cart_updated", { tableId: cleanTableId.toLowerCase() });
            io.emit("order_closed", { tableId: cleanTableId.toLowerCase(), tableNo: tableNo, orderId: displayOrderId });
          }

          // 🚀 CLEANUP MERGED SOURCE TABLES AS WELL (Bullet 5)
          try {
            const childTablesRes = await transaction.request()
              .input("orderNo", sql.NVarChar(50), displayOrderId)
              .query(`
                SELECT tm.TableId, tm.TableNumber, tm.DiningSection
                FROM OrderMergeHistory omh
                JOIN TableMaster tm ON omh.ChildTableNo = tm.TableNumber
                WHERE omh.ParentOrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
              `);

            if (childTablesRes.recordset && childTablesRes.recordset.length > 0) {
              const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
              for (const childTable of childTablesRes.recordset) {
                const childTableId = String(childTable.TableId).replace(/^\{|\}$/g, "").trim();
                const childTableNo = childTable.TableNumber;
                const childSection = sectionMap[String(childTable.DiningSection)] || "SECTION_1";

                console.log(`[SAVE SALE] Cleaning up merged source table: ${childTableNo} (${childTableId})`);
                
                await transaction.request()
                  .input("cartId", sql.NVarChar(128), childTableId)
                  .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");

                await transaction.request()
                  .input("tid", sql.NVarChar(128), childTableId)
                  .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL WHERE TableId = @tid");

                if (io) {
                  io.emit("table_status_updated", { 
                    tableId: childTableId.toLowerCase(), 
                    status: 0, 
                    totalAmount: 0,
                    startTime: null,
                    tableNo: childTableNo,
                    section: childSection
                  });
                  io.emit("cart_updated", { tableId: childTableId.toLowerCase() });
                  io.emit("order_closed", { tableId: childTableId.toLowerCase(), tableNo: childTableNo, orderId: displayOrderId });
                }
              }
            }
          } catch (childErr) {
            console.error("⚠️ [SAVE SALE] Merged tables cleanup failed:", childErr.message);
          }

          // 🚀 GLOBAL KDS SYNC: Mark order as closed in professional tables
          await transaction.request()
            .input("orderNo", sql.NVarChar(50), displayOrderId)
            .query("UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE() WHERE OrderNumber = @orderNo");
        }
      }

      // 5. Track in servermaster (Waiter History)
      if (serverId) {
        try {
          await transaction.request()
            .input("SER_ID", sql.Int, serverId)
            .input("SER_NAME", sql.NVarChar(255), serverName)
            .input("TableNo", sql.NVarChar(50), tableNo || null)
            .input("OrderId", sql.NVarChar(50), displayOrderId)
            .input("Section", sql.NVarChar(100), section || null)
            .input("CreatedBy", sql.UniqueIdentifier, sanitizeGuid(cashierId))
            .query(`
              INSERT INTO servermaster (SER_ID, SER_NAME, TableNo, OrderId, Section, CreatedBy, CreatedDate, ModifiedBy, ModifiedDate)
              VALUES (@SER_ID, @SER_NAME, @TableNo, @OrderId, @Section, @CreatedBy, GETDATE(), @CreatedBy, GETDATE())
            `);
        } catch (serverErr) {
          console.error("⚠️ [SAVE SALE] servermaster insert failed:", serverErr.message);
        }
      }

    }, { name: "SaveSale", timeoutMs: 60000 });

    // 🚀 POST-SAVE VALIDATION: Deep integrity check for Backoffice compatibility
    if (guidOrderId) {
      setImmediate(async () => {
        try {
          const checkPool = await poolPromise;
          const check = await checkPool.request()
            .input("oid", sql.UniqueIdentifier, guidOrderId)
            .input("sid", sql.UniqueIdentifier, settlementId)
            .query(`
              SELECT 
                (SELECT COUNT(*) FROM PaymentDetail WHERE RestaurantBillId = @sid) as PaymentMasterCount,
                (SELECT COUNT(*) FROM RestaurantInvoice WHERE RestaurantBillId = @sid AND OrderId = @oid) as InvoiceMasterMatch,
                (SELECT COUNT(*) FROM RestaurantOrder WHERE OrderId = @oid) as OrderMasterCount,
                (SELECT BillNumber FROM RestaurantInvoice WHERE RestaurantBillId = @sid) as FinalBillNo
            `);
          const stats = check.recordset[0];
          const isHealthy = stats.PaymentMasterCount > 0 && stats.InvoiceMasterMatch > 0 && stats.OrderMasterCount > 0;
          console.log(`[INTEGRITY ${isHealthy ? 'OK' : 'FAIL'}] Order: ${displayOrderId} | MasterOrder: ${stats.OrderMasterCount} | Invoice: ${stats.InvoiceMasterMatch} | Payments: ${stats.PaymentMasterCount} | Bill: ${stats.FinalBillNo}`);
        } catch (vErr) {
          console.error("[INTEGRITY ERROR] Verification failed:", vErr.message);
        }
      });
    }
    
    res.json({ success: true, settlementId, billNo: displayOrderId, orderId: displayOrderId });
  } catch (err) {
    console.error("SAVE SALE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ================= VALIDATION ================= */
router.get("/orders/check/:orderId", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("OrderId", req.params.orderId)
      .query("SELECT SettlementID FROM SettlementHeader WHERE OrderId = @OrderId AND IsCancelled = 0");
    res.json({ exists: result.recordset.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/orders/validate-cancel", async (req, res) => {
    try {
      const { settlementId } = req.body;
      const pool = await poolPromise;
      
      const result = await pool.request()
        .input("Id", settlementId)
        .query("SELECT IsCancelled FROM SettlementHeader WHERE SettlementID = @Id");
      
      if (result.recordset.length === 0) return res.status(404).json({ valid: false, message: "Order not found" });
      if (result.recordset[0].IsCancelled) return res.status(400).json({ valid: false, message: "Order is already cancelled" });
      
      res.json({ valid: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

router.get("/payment-history", async (req, res) => {
    try {
      const pool = await poolPromise;
      const limit = parseInt(req.query.limit) || 50;
      const result = await pool.request().input("Limit", sql.Int, limit).query(`
        SELECT TOP (@Limit) CAST(pdc.PaymentId AS VARCHAR(50)) as paymentId,
        CONVERT(VARCHAR(23), pdc.PaymentCollectedOn, 126) as paymentCollectedOn,
        ISNULL(pdc.Amount, 0) as amount, ISNULL(pm.Description, '') as payModeDescription
        FROM [dbo].[PaymentDetailCur] pdc
        LEFT JOIN [dbo].[Paymode] pm ON pm.Position = pdc.Paymode
        ORDER BY pdc.PaymentCollectedOn DESC
      `);
      res.json(result.recordset || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

router.get("/payment-methods", async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT PayMode as payMode, Description as description, Position FROM [dbo].[Paymode] WHERE Active = 1 ORDER BY Position ASC
      `);
      res.json(result.recordset || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

router.get("/payment-detail/:payMode", async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input("PayMode", req.params.payMode)
        .query("SELECT * FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(PayMode)) = @PayMode AND Active = 1");
      res.json(result.recordset[0] || null);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

/**
 * Generate comprehensive consolidated sales report PDF
 * Supports daily, weekly, monthly, yearly filters
 */
router.get("/consolidated-report/pdf", async (req, res) => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      return res.status(503).json({ error: 'Database connection unavailable' });
    }

    const filter = normalizeReportFilter(req.query.filter || 'daily');
    const date = req.query.date;
    const dateWhereClause = getReportDateWhereSql(filter, "sh.LastSettlementDate", date);

    // Aggregate all settlement data
    const aggregateResult = await pool.request().query(`
      SELECT
        COUNT(DISTINCT sh.SettlementID) as totalOrders,
        SUM(CAST(ISNULL(sid.Qty, 0) AS DECIMAL(18,2))) as totalItems,
        SUM(CAST(ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) AS DECIMAL(18,2))) as netSales,
        SUM(CAST(ISNULL(sh.ServiceCharge, 0) AS DECIMAL(18,2))) as serviceCharge,
        SUM(CAST(ISNULL(sts.GSTAmount, 0) AS DECIMAL(18,2))) as taxCollected,
        SUM(CAST(ISNULL(sh.RoundedBy, 0) AS DECIMAL(18,2))) as roundedBy,
        SUM(CAST(ISNULL(sts.SysAmount, 0) AS DECIMAL(18,2))) as totalSales,
        SUM(CAST(ISNULL(sh.VoidItemQty, 0) AS INT)) as voidQty,
        SUM(CAST(ISNULL(sh.VoidItemAmount, 0) AS DECIMAL(18,2))) as voidAmount,
        ISNULL(SUM(CAST(ISNULL(sts.DiscountAmount, 0) AS DECIMAL(18,2))), 0) as totalDiscount
      FROM SettlementHeader sh
      LEFT JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      WHERE ${dateWhereClause}
    `);

    const aggregateData = aggregateResult.recordset[0] || {};

    // Get payment breakdown
    const paymentResult = await pool.request().query(`
      SELECT
        ${normalizeReportPayModeSql("sts.PayMode")} as PayMode,
        SUM(CAST(ISNULL(sts.SysAmount, 0) AS DECIMAL(18,2))) as Amount
      FROM SettlementHeader sh
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      WHERE ${dateWhereClause}
      GROUP BY ${normalizeReportPayModeSql("sts.PayMode")}
    `);

    const paymentBreakdown = {};
    if (paymentResult.recordset && paymentResult.recordset.length > 0) {
      paymentResult.recordset.forEach(row => {
        const payMode = String(row.PayMode || 'CASH').trim().toUpperCase();
        paymentBreakdown[payMode] = Number(row.Amount || 0);
      });
    }

    // Calculate total revenue
    const totalRevenue = 
      Number(aggregateData.netSales || 0) + 
      Number(aggregateData.serviceCharge || 0) + 
      Number(aggregateData.taxCollected || 0) + 
      Number(aggregateData.roundedBy || 0);

    // Format period string
    let periodStr = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

    if (filter === 'daily') {
      periodStr = todayStr;
    } else if (filter === 'weekly') {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartStr = weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      periodStr = `${weekStartStr} to ${todayStr}`;
    } else if (filter === 'monthly') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStartStr = monthStart.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      periodStr = `${monthStartStr} to ${todayStr}`;
    } else if (filter === 'yearly') {
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const yearStartStr = yearStart.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      periodStr = `${yearStartStr} to ${todayStr}`;
    }

    // Prepare report data for PDF generation
    const reportData = {
      companyName: 'AL-HAZIMA RESTAURANT PTE LTD',
      companyAddress: 'No 6 Chiming Glen Rasta Road, SINGAPORE 589729',
      companyPhone: '+65 6840000',
      period: periodStr,
      netSales: Number(aggregateData.netSales || 0),
      serviceCharge: Number(aggregateData.serviceCharge || 0),
      taxCollected: Number(aggregateData.taxCollected || 0),
      roundedBy: Number(aggregateData.roundedBy || 0),
      totalRevenue: totalRevenue,
      totalSales: Number(aggregateData.totalSales || 0),
      totalOrders: Number(aggregateData.totalOrders || 0),
      totalItems: Number(aggregateData.totalItems || 0),
      voidQty: Number(aggregateData.voidQty || 0),
      voidAmount: Number(aggregateData.voidAmount || 0),
      totalDiscount: Number(aggregateData.totalDiscount || 0),
      paymentBreakdown: paymentBreakdown,
      currencySymbol: '$'
    };

    // Use the new PDF generator
    const { generateSalesReportPdf, createPdfBinary } = require('../utils/pdfReportGenerator');
    const docDef = generateSalesReportPdf(reportData);
    const pdfBuffer = await createPdfBinary(docDef);

    const filename = `Consolidated_Sales_Report_${filter}_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[SALES/consolidated-report] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate report PDF', details: err.message });
  }
});

/* ================= REPORTING ENDPOINTS ================= */

// 1. Member Payment Collection By Payment Mode
router.get("/reports/member-collection-by-mode", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT pm.Description as PayMode, SUM(ptd.Amount) as TotalCollected, COUNT(*) as TransactionCount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY pm.Description
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Daily Member Collection
router.get("/reports/daily-member-collection", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT CAST(ptd.CreatedDate AS DATE) as CollectionDate, pm.Description as PayMode, SUM(ptd.Amount) as TotalAmount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY CAST(ptd.CreatedDate AS DATE), pm.Description
      ORDER BY CollectionDate DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Member Collection Summary
router.get("/reports/member-collection-summary", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT m.Name as MemberName, m.Phone, SUM(ptd.Amount) as TotalPaid, MAX(ptd.CreatedDate) as LastPaymentDate
      FROM PaymentTransactionDetails ptd
      JOIN MemberMaster m ON m.MemberId = ptd.ReferenceId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY m.Name, m.Phone
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Combined Collection Summary (Bills + Members)
router.get("/reports/combined-collection-summary", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT ptd.ReferenceType, pm.Description as PayMode, SUM(ptd.Amount) as TotalAmount, COUNT(*) as TransactionCount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      GROUP BY ptd.ReferenceType, pm.Description
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
