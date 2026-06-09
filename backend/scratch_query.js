const { poolPromise } = require("./config/db");

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Connected to database successfully.\n");

    const query = `
      SELECT 
        cct.TransactionId AS SettlementID,
        DATEADD(MINUTE, -468, cct.CreatedDate) AS SettlementDate,
        CASE WHEN mm.MemberId IS NOT NULL THEN 'Member Payment Collected' ELSE 'Credit Payment Collected' END AS OrderId,
        'LEDGER' AS OrderType,
        cct.PaidAmount as SysAmount,
        mm.Name as MemberName,
        m.Name as CustomerName
      FROM CustomerCreditTransactions cct
      LEFT JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId
      LEFT JOIN MemberMaster mm ON cct.MemberId = mm.MemberId
      WHERE cct.TransactionType = 'PAYMENT' 
        AND cct.CreatedDate >= '2026-06-05 00:00:00' 
        AND cct.CreatedDate <= '2026-06-05 23:59:59'
      ORDER BY cct.CreatedDate DESC
    `;

    const res = await pool.request().query(query);
    console.log("June 5 Payments:", JSON.stringify(res.recordset, null, 2));

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();










