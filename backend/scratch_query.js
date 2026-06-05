const { poolPromise } = require("./config/db");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Connected to database successfully.\n");

    const todayStr = "2026-06-05";

    // 1. Fetch TOP 200 records like /sales/all does
    const query = `
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
          sts.PayMode as PayMode,
          sh.SysAmount as SysAmount,
          sh.ManualAmount as ManualAmount,
          sh.SubTotal as SubTotal,
          ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
          sh.DiscountType as DiscountType,
          ISNULL(sh.ServiceCharge, 0) as ServiceCharge,
          ISNULL(sh.TotalTax, 0) as TotalTax,
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
          CASE WHEN mm.MemberId IS NOT NULL THEN 'Member Payment Collected' ELSE 'Credit Payment Collected' END AS OrderId,
          'LEDGER' AS OrderType,
          'LEDGER' AS TableNo,
          COALESCE(mm.Name, m.Name, 'Customer') AS Section,
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
          0 AS TotalTax,
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
        LEFT JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId
        LEFT JOIN MemberMaster mm ON cct.MemberId = mm.MemberId
        WHERE cct.TransactionType = 'PAYMENT'
      ) CombinedSales
      ORDER BY SettlementDate DESC
    `;

    const res = await pool.request().query(query);
    const sales = res.recordset;
    console.log(`Fetched ${sales.length} rows.`);

    // 2. Apply YEARLY filter on these 200 rows in JavaScript (matching sales-report.tsx)
    const selectedDate = todayStr;
    const parts = selectedDate.split("-");
    const start = new Date(Number(parts[0]), 0, 1, 0, 0, 0, 0);
    const nextYear = new Date(Number(parts[0]) + 1, 0, 1, 0, 0, 0, 0);
    const end = new Date(nextYear.getTime() - 1);

    const dateScopedSales = sales.filter((s) => {
      if (!s.SettlementDate) return false;
      const saleDate = new Date(s.SettlementDate);
      return saleDate >= start && saleDate <= end;
    });

    console.log(`YEARLY filtered sales count out of TOP 200: ${dateScopedSales.length}`);

    // 3. Compute filteredMetrics from dateScopedSales in JavaScript
    const filteredMetrics = dateScopedSales.reduce(
      (acc, s) => {
        if (s.IsCancelled) {
          acc.CancelledCount += 1;
          acc.CancelledAmount += s.VoidAmount || 0;
          return acc;
        }

        if (s.OrderType === 'LEDGER') {
          if (s.OrderId === 'Credit Payment Collected') {
            acc.CreditPaymentsCollected += s.SysAmount || 0;
          } else {
            acc.MemberPaymentsCollected += s.SysAmount || 0;
          }
          return acc;
        }

        acc.TotalSales += s.SysAmount || 0;
        acc.TotalTransactions += 1;
        acc.TotalItems += (s.ReceiptCount || 0);
        acc.TotalVoids += s.VoidQty || 0;
        acc.TotalVoidAmount += s.VoidAmount || 0;

        return acc;
      },
      {
        TotalSales: 0,
        TotalTransactions: 0,
        TotalItems: 0,
        TotalVoids: 0,
        TotalVoidAmount: 0,
        CancelledCount: 0,
        CancelledAmount: 0,
        MemberPaymentsCollected: 0,
        CreditPaymentsCollected: 0,
      }
    );

    console.log("Computed metrics from TOP 200 subset:");
    console.log(filteredMetrics);
    console.log(`Total Orders (TotalTransactions + CancelledCount): ${filteredMetrics.TotalTransactions + filteredMetrics.CancelledCount}`);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();
