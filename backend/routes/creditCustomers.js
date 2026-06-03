const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { runInTransaction } = require("../utils/transactionHelper");
const { processSplitPayments } = require("../services/payment.service");

const toGuidOrNull = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT CustomerId AS MemberId, Name, Phone, Email, Address, IsActive, Balance, CreditLimit, CurrentBalance, CreatedOn FROM CreditCustomerMaster ORDER BY Name");
    res.json(result.recordset);
  } catch (err) {
    console.error("[CREDIT CUSTOMERS GET ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/add", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId } = req.body;
    const result = await pool.request()
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, phone)
      .input("Email", sql.NVarChar, email || null)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .input("CreatedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        DECLARE @newId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO CreditCustomerMaster (CustomerId, Name, Phone, Email, Address, IsActive, CreditLimit, CurrentBalance, Balance)
        VALUES (@newId, @Name, @Phone, @Email, @Address, @IsActive, @CreditLimit, @CurrentBalance, @Balance);
        SELECT @newId AS CustomerId;
      `);
    
    const customerId = result.recordset[0].CustomerId;
    res.json({
      success: true,
      member: {
        MemberId: customerId,
        Name: name,
        Phone: phone,
        CreditLimit: parseFloat(creditLimit) || 0,
        CurrentBalance: parseFloat(currentBalance) || 0,
        IsActive: isActive !== undefined ? isActive : 1
      }
    });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS ADD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/update", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId } = req.body;
    await pool.request()
      .input("Id", sql.UniqueIdentifier, memberId)
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, phone)
      .input("Email", sql.NVarChar, email)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .query(`
        UPDATE CreditCustomerMaster SET 
          Name = @Name, Phone = @Phone, Email = @Email, Address = @Address, IsActive = @IsActive,
          CreditLimit = @CreditLimit, CurrentBalance = @CurrentBalance, Balance = @Balance
        WHERE CustomerId = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS UPDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ error: "Missing customer ID (memberId)" });

    await pool.request()
      .input("Id", sql.UniqueIdentifier, memberId)
      .query("DELETE FROM CreditCustomerMaster WHERE CustomerId = @Id");

    res.json({ success: true });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS DELETE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("query", sql.NVarChar, `%${query || ""}%`)
      .query(`
        SELECT CustomerId AS MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM CreditCustomerMaster 
        WHERE (Name LIKE @query OR Phone LIKE @query)
        ORDER BY Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[CREDIT CUSTOMERS SEARCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/validate/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const { amount } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT CustomerId AS MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM CreditCustomerMaster 
        WHERE CustomerId = @CustomerId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Credit customer not found" });
    }
    
    const customer = result.recordset[0];
    if (!customer.IsActive) {
      return res.status(400).json({ success: false, error: "Credit account is inactive" });
    }
    
    const billAmount = parseFloat(amount) || 0;
    const currentBalance = parseFloat(customer.CurrentBalance) || 0;
    const creditLimit = parseFloat(customer.CreditLimit) || 0;
    const remainingCredit = creditLimit - currentBalance;
    
    if (currentBalance + billAmount > creditLimit) {
      return res.status(400).json({ 
        success: false, 
        error: "Credit Limit Exceeded",
        member: {
          ...customer,
          RemainingCredit: remainingCredit
        }
      });
    }
    
    res.json({
      success: true,
      member: {
        ...customer,
        RemainingCredit: remainingCredit
      }
    });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS VALIDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/pay", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, amount, payments, userId } = req.body;

  if (!memberId) {
    return res.status(400).json({ error: "memberId (CustomerId) is required" });
  }

  const numericAmt = parseFloat(amount);
  if (isNaN(numericAmt) || numericAmt <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }

  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    return res.status(400).json({ error: "payments array is required and cannot be empty" });
  }

  // Validation
  let sum = 0;
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const amt = parseFloat(p.amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: `Payment row ${i + 1} has an invalid or negative amount.` });
    }
    if (!p.payModeId && !p.payMode) {
      return res.status(400).json({ error: `Payment row ${i + 1} is missing payment mode.` });
    }
    sum += amt;
  }

  const diff = Math.abs(sum - numericAmt);
  if (diff > 0.01) {
    return res.status(400).json({ error: `Sum of payments (${sum.toFixed(2)}) must equal total amount (${numericAmt.toFixed(2)})` });
  }

  await runInTransaction(async (transaction) => {
    // 1. Verify customer exists and is active
    const customerCheck = await transaction.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .query("SELECT CreditLimit, CurrentBalance, IsActive FROM CreditCustomerMaster WITH (UPDLOCK) WHERE CustomerId = @CustomerId");
    
    if (customerCheck.recordset.length === 0) {
      throw new Error("Credit customer not found");
    }
    
    const customer = customerCheck.recordset[0];
    if (!customer.IsActive) {
      throw new Error("Credit customer is inactive");
    }

    // 2. Process split payments using unified service
    await processSplitPayments({
      referenceType: "MEMBER", // Generic referenceType
      referenceId: memberId,
      payments,
      transaction,
      cashierId: userId ? String(userId).trim() : null
    });

    // 3. Write allocation credit rows to CustomerCreditTransactions
    let remainingPayment = numericAmt;
    const payModeName = (payments && payments.length > 0) ? (payments[0].payMode || 'CASH') : 'CASH';
    const referenceNo = (payments && payments.length > 0) ? (payments[0].referenceNo || '') : '';
    const mainRemarks = req.body.remarks || `Credit payment collection (${payModeName})`;

    // Write the primary PAYMENT transaction record
    await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .input("PaymentMethod", sql.NVarChar(50), payModeName)
      .input("ReferenceNo", sql.NVarChar(100), referenceNo)
      .input("Remarks", sql.NVarChar(500), mainRemarks)
      .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(userId))
      .query(`
        INSERT INTO CustomerCreditTransactions (MemberId, TransactionType, BillAmount, PaidAmount, OutstandingAmount, PaymentMethod, ReferenceNo, Status, Remarks, CreatedBy)
        VALUES (@MemberId, 'PAYMENT', 0, @Amount, -@Amount, @PaymentMethod, @ReferenceNo, 'CLOSED', @Remarks, @CreatedBy)
      `);
    
    if (req.body.allocations && Array.isArray(req.body.allocations) && req.body.allocations.length > 0) {
      // Manual Allocation
      for (const alloc of req.body.allocations) {
        const allocAmt = parseFloat(alloc.amount);
        if (isNaN(allocAmt) || allocAmt <= 0) continue;
        
        await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, memberId)
          .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(alloc.settlementId))
          .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
          .query(`
            UPDATE CustomerCreditTransactions
            SET 
              PaidAmount = PaidAmount + @AllocAmt,
              OutstandingAmount = OutstandingAmount - @AllocAmt,
              Status = CASE WHEN (OutstandingAmount - @AllocAmt) <= 0.01 THEN 'CLOSED' ELSE 'PARTIAL' END,
              UpdatedDate = GETDATE()
            WHERE MemberId = @MemberId 
              AND SettlementId = @SettlementId 
              AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
              AND Status IN ('OPEN', 'PARTIAL')
          `);
      }
    } else {
      // Auto Allocation (FIFO)
      const outstandingRes = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query(`
          SELECT 
            TransactionId,
            SettlementId,
            BillNo,
            OutstandingAmount
          FROM CustomerCreditTransactions
          WHERE MemberId = @MemberId
            AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
            AND Status IN ('OPEN', 'PARTIAL')
          ORDER BY CreatedDate ASC
        `);
      
      const outstandingBills = outstandingRes.recordset;
      
      for (const bill of outstandingBills) {
        if (remainingPayment <= 0.005) break;
        
        const billDue = parseFloat(bill.OutstandingAmount) || 0;
        const allocAmt = Math.min(remainingPayment, billDue);
        
        await transaction.request()
          .input("TransactionId", sql.UniqueIdentifier, bill.TransactionId)
          .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
          .query(`
            UPDATE CustomerCreditTransactions
            SET 
              PaidAmount = PaidAmount + @AllocAmt,
              OutstandingAmount = OutstandingAmount - @AllocAmt,
              Status = CASE WHEN (OutstandingAmount - @AllocAmt) <= 0.01 THEN 'CLOSED' ELSE 'PARTIAL' END,
              UpdatedDate = GETDATE()
            WHERE TransactionId = @TransactionId
          `);
          
        remainingPayment -= allocAmt;
      }
    }

    // 4. Update customer balance (subtract paid amount)
    await transaction.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .query("UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance - @Amount WHERE CustomerId = @CustomerId");
  }, { name: "CreditCustomerPayment", timeoutMs: 60000 });

  res.json({ success: true });
} catch (err) {
  console.error("[CREDIT CUSTOMER PAYMENT ERROR]", err);
  res.status(500).json({ error: err.message });
}
});

/* ================= OUTSTANDING BILLS ================= */
router.get("/outstanding/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          SettlementId,
          BillNo,
          BillAmount AS GrossAmount,
          PaidAmount,
          OutstandingAmount,
          CONVERT(VARCHAR, CreatedDate, 126) + '+08:00' AS InvoiceDate
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
          AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          AND Status IN ('OPEN', 'PARTIAL')
        ORDER BY CreatedDate ASC
      `);
    res.json({ success: true, outstandingBills: result.recordset });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS OUTSTANDING BILLS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= STATEMENT / HISTORY ================= */
router.get("/statement/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          TransactionId,
          SettlementId,
          BillNo,
          TransactionType,
          CASE WHEN TransactionType = 'CREDIT_SALE' THEN BillAmount WHEN TransactionType = 'PAYMENT' THEN PaidAmount ELSE ISNULL(NULLIF(BillAmount, 0), PaidAmount) END AS Amount,
          BillAmount,
          PaidAmount,
          OutstandingAmount,
          PaymentMethod,
          ReferenceNo,
          Remarks,
          CONVERT(VARCHAR, CreatedDate, 126) + '+08:00' AS CreatedDate,
          CreatedBy
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
        ORDER BY CreatedDate ASC
      `);
    
    let runningBalance = 0;
    const transactions = result.recordset.map(t => {
      const netEffect = parseFloat(t.BillAmount || 0) - parseFloat(t.PaidAmount || 0);
      runningBalance += netEffect;
      return {
        ...t,
        Amount: parseFloat(t.Amount || 0),
        runningBalance: parseFloat(runningBalance.toFixed(2))
      };
    });
    
    res.json({ success: true, transactions });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS STATEMENT ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= RECEIVABLES DASHBOARD ================= */
router.get("/receivables/dashboard", async (req, res) => {
  try {
    const pool = await poolPromise;
    
    // Total Outstanding & Overdue (defined as bills older than 30 days)
    const statsRes = await pool.request().query(`
      SELECT 
        ISNULL(SUM(tx.OutstandingAmount), 0) AS TotalOutstanding,
        ISNULL(SUM(
          CASE 
            WHEN tx.CreatedDate < DATEADD(day, -30, GETDATE()) THEN tx.OutstandingAmount 
            ELSE 0 
          END
        ), 0) AS TotalOverdue
      FROM CustomerCreditTransactions tx
      INNER JOIN CreditCustomerMaster m ON tx.MemberId = m.CustomerId
      WHERE tx.TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT') 
        AND tx.Status IN ('OPEN', 'PARTIAL')
        AND m.IsActive = 1
    `);
    
    // Total Customers with Credit
    const custCountRes = await pool.request().query(`
      SELECT COUNT(*) AS CreditCustomerCount 
      FROM CreditCustomerMaster 
      WHERE CurrentBalance > 0.01 AND IsActive = 1
    `);
    
    // Collections Today & This Month
    const collRes = await pool.request().query(`
      SELECT 
        ISNULL(SUM(CASE WHEN CreatedDate >= CAST(GETDATE() AS DATE) THEN PaidAmount ELSE 0 END), 0) AS CollectionsToday,
        ISNULL(SUM(CASE WHEN CreatedDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0) THEN PaidAmount ELSE 0 END), 0) AS CollectionsThisMonth
      FROM CustomerCreditTransactions
      WHERE TransactionType = 'PAYMENT'
    `);
    
    res.json({
      success: true,
      stats: {
        totalOutstanding: statsRes.recordset[0].TotalOutstanding,
        totalOverdue: Math.max(0, statsRes.recordset[0].TotalOverdue),
        totalCustomersWithCredit: custCountRes.recordset[0].CreditCustomerCount,
        collectionsToday: collRes.recordset[0].CollectionsToday,
        collectionsThisMonth: collRes.recordset[0].CollectionsThisMonth
      }
    });
  } catch (err) {
    console.error("[CREDIT RECEIVABLES DASHBOARD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= AGING REPORT ================= */
router.get("/receivables/aging", async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const query = `
      WITH BillBalances AS (
        SELECT 
          MemberId,
          BillNo,
          CreatedDate AS BillDate,
          DATEDIFF(day, CreatedDate, GETDATE()) AS AgeDays,
          OutstandingAmount AS NetOutstanding
        FROM CustomerCreditTransactions
        WHERE TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          AND Status IN ('OPEN', 'PARTIAL')
      )
      SELECT 
        m.CustomerId AS MemberId,
        m.Name,
        m.Phone,
        ISNULL(SUM(b.NetOutstanding), 0) AS OutstandingBalance,
        ISNULL(SUM(CASE WHEN b.AgeDays <= 30 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket0to30,
        ISNULL(SUM(CASE WHEN b.AgeDays > 30 AND b.AgeDays <= 60 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket31to60,
        ISNULL(SUM(CASE WHEN b.AgeDays > 60 AND b.AgeDays <= 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket61to90,
        ISNULL(SUM(CASE WHEN b.AgeDays > 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket90Plus
      FROM CreditCustomerMaster m
      LEFT JOIN BillBalances b ON m.CustomerId = b.MemberId
      WHERE m.IsActive = 1
      GROUP BY m.CustomerId, m.Name, m.Phone
      ORDER BY m.Name
    `;
    
    const result = await pool.request().query(query);
    const customers = result.recordset || [];
    
    const summary = customers.reduce((acc, c) => {
      acc.totalOutstanding += parseFloat(c.OutstandingBalance);
      acc.aging0to30 += parseFloat(c.Bucket0to30);
      acc.aging31to60 += parseFloat(c.Bucket31to60);
      acc.aging61to90 += parseFloat(c.Bucket61to90);
      acc.aging90plus += parseFloat(c.Bucket90Plus);
      return acc;
    }, {
      totalOutstanding: 0,
      aging0to30: 0,
      aging31to60: 0,
      aging61to90: 0,
      aging90plus: 0
    });
    
    res.json({
      success: true,
      summary,
      customers
    });
  } catch (err) {
    console.error("[CREDIT RECEIVABLES AGING ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
