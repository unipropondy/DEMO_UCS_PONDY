const { poolPromise } = require("c:\\Users\\UNIPRO\\Desktop\\UCS_PONDY\\backend\\config\\db");

async function main() {
  const pool = await poolPromise;
  
  const query = `
    SELECT 
      ptd.PaymentTransactionId,
      ptd.ReferenceType,
      ptd.PayModeId,
      ptd.Amount,
      ptd.CreatedDate,
      CAST(ptd.CreatedDate AS DATE) as CreatedDateDate,
      pm.Description as PaymodeDescription
    FROM PaymentTransactionDetails ptd
    LEFT JOIN Paymode pm ON pm.Position = ptd.PayModeId
    WHERE ptd.ReferenceType = 'MEMBER'
  `;
  
  const res = await pool.request().query(query);
  console.table(res.recordset);
  
  const reportQuery = `
    SELECT 
      'CREDIT PAYMENT (' + UPPER(ISNULL(pm.Description, 'CASH')) + ')' as Paymode,
      SUM(ptd.Amount) as Amount,
      COUNT(ptd.PaymentTransactionId) as Count
    FROM PaymentTransactionDetails ptd
    INNER JOIN Paymode pm ON pm.Position = ptd.PayModeId
    WHERE ptd.ReferenceType = 'MEMBER'
      AND CAST(ptd.CreatedDate AS DATE) >= '2026-06-03'
      AND CAST(ptd.CreatedDate AS DATE) <= '2026-06-03'
    GROUP BY pm.Description
  `;
  const reportRes = await pool.request().query(reportQuery);
  console.table(reportRes.recordset);
  
  process.exit(0);
}

main().catch(console.error);
