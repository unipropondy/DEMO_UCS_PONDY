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
    const result = await pool.request().query("SELECT * FROM MemberMaster ORDER BY Name");
    res.json(result.recordset);
  } catch (err) {
    console.error("[MEMBERS GET ERROR]", err);
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
        INSERT INTO MemberMaster (MemberId, Name, Phone, Email, Address, IsActive, CreditLimit, CurrentBalance, Balance, CreatedBy)
        VALUES (@newId, @Name, @Phone, @Email, @Address, @IsActive, @CreditLimit, @CurrentBalance, @Balance, @CreatedBy);
        SELECT @newId AS MemberId;
      `);
    
    const memberId = result.recordset[0].MemberId;
    res.json({
      success: true,
      member: {
        MemberId: memberId,
        Name: name,
        Phone: phone,
        CreditLimit: parseFloat(creditLimit) || 0,
        CurrentBalance: parseFloat(currentBalance) || 0,
        IsActive: isActive !== undefined ? isActive : 1
      }
    });
  } catch (err) {
    console.error("[MEMBERS ADD ERROR]", err);
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
      .input("ModifiedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        UPDATE MemberMaster SET 
          Name = @Name, Phone = @Phone, Email = @Email, Address = @Address, IsActive = @IsActive,
          CreditLimit = @CreditLimit, CurrentBalance = @CurrentBalance, Balance = @Balance,
          ModifiedBy = @ModifiedBy, ModifiedDate = GETDATE()
        WHERE MemberId = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBERS UPDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ error: "Missing memberId" });

    await runInTransaction(async (transaction) => {
      const request = new sql.Request(transaction);
      request.input("Id", sql.UniqueIdentifier, memberId);

      await request.query("IF OBJECT_ID('MemberTimeLog', 'U') IS NOT NULL DELETE FROM MemberTimeLog WHERE MemberId = @Id");
      await request.query("IF COL_LENGTH('SettlementHeader', 'MemberId') IS NOT NULL UPDATE SettlementHeader SET MemberId = NULL WHERE MemberId = @Id;");
      await request.query("DELETE FROM MemberMaster WHERE MemberId = @Id");
    }, { name: "DeleteMember" });

    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBERS DELETE ERROR]", err);
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
        SELECT MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM MemberMaster 
        WHERE (Name LIKE @query OR Phone LIKE @query)
        ORDER BY Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[MEMBERS SEARCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/validate/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const { amount } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM MemberMaster 
        WHERE MemberId = @MemberId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Member not found" });
    }
    
    const member = result.recordset[0];
    if (!member.IsActive) {
      return res.status(400).json({ success: false, error: "Member is inactive" });
    }
    
    const billAmount = parseFloat(amount) || 0;
    const currentBalance = parseFloat(member.CurrentBalance) || 0;
    const creditLimit = parseFloat(member.CreditLimit) || 0;
    const remainingCredit = creditLimit - currentBalance;
    
    if (currentBalance + billAmount > creditLimit) {
      return res.status(400).json({ 
        success: false, 
        error: "Credit Limit Exceeded",
        member: {
          ...member,
          RemainingCredit: remainingCredit
        }
      });
    }
    
    res.json({
      success: true,
      member: {
        ...member,
        RemainingCredit: remainingCredit
      }
    });
  } catch (err) {
    console.error("[MEMBERS VALIDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/usage/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;

    // 1. Summary
    const summaryRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          ISNULL(SUM(SysAmount), 0) as TotalSpent, 
          COUNT(*) as TotalOrders 
        FROM SettlementHeader 
        WHERE MemberId = @MemberId 
          AND LastSettlementDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0) 
          AND IsCancelled = 0
      `);

    // 2. Items Consumed
    const itemsRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          sid.DishName, 
          SUM(sid.Qty) as TotalQty, 
          SUM(sid.Price * sid.Qty) as TotalAmount 
        FROM SettlementHeader sh 
        INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID 
        WHERE sh.MemberId = @MemberId 
          AND sh.LastSettlementDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0) 
          AND sh.IsCancelled = 0 
        GROUP BY sid.DishName 
        ORDER BY TotalQty DESC
      `);

    // 3. Transactions
    const txsRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          SettlementID, 
          BillNo, 
          LastSettlementDate, 
          SysAmount 
        FROM SettlementHeader 
        WHERE MemberId = @MemberId 
          AND LastSettlementDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0) 
          AND IsCancelled = 0 
        ORDER BY LastSettlementDate DESC
      `);

    res.json({
      success: true,
      summary: summaryRes.recordset[0] || { TotalSpent: 0, TotalOrders: 0 },
      items: itemsRes.recordset || [],
      transactions: txsRes.recordset || []
    });
  } catch (err) {
    console.error("[MEMBERS USAGE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/pay", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, amount, payments, userId } = req.body;

  if (!memberId) {
    return res.status(400).json({ error: "memberId is required" });
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

  let memberPaymentId;

  await runInTransaction(async (transaction) => {
    // 1. Verify member exists and is active
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

    // 2. Generate a new MemberPaymentId
    const payIdRes = await transaction.request().query("SELECT NEWID() as id");
    memberPaymentId = payIdRes.recordset[0].id;

    // 3. Process split payments using unified service
    await processSplitPayments({
      referenceType: "MEMBER",
      referenceId: memberId,
      payments,
      transaction,
      cashierId: userId ? String(userId).trim() : null
    });

    // 3.5. Write allocation credit rows to CustomerCreditTransactions
    let remainingPayment = numericAmt;
    const payModeName = (payments && payments.length > 0) ? (payments[0].payMode || 'CASH') : 'CASH';
    const referenceNo = (payments && payments.length > 0) ? (payments[0].referenceNo || '') : '';
    const mainRemarks = req.body.remarks || `Credit payment collection (${payModeName})`;

    // 1. Write the primary PAYMENT transaction record
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
      // --- MANUAL ALLOCATION ---
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
      // --- AUTO ALLOCATION (FIFO) ---
      // Fetch outstanding bills ordered by date
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

    // 4. Update member balance (subtract paid amount to clear/reduce credit balance)
    await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @Amount WHERE MemberId = @MemberId");
  }, { name: "MemberPayment", timeoutMs: 60000 });

  res.json({ success: true, memberPaymentId });
  } catch (err) {
    console.error("[MEMBER PAYMENT ERROR]", err);
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
          CreatedDate AS InvoiceDate
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
          AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          AND Status IN ('OPEN', 'PARTIAL')
        ORDER BY InvoiceDate ASC
      `);
    res.json({ success: true, outstandingBills: result.recordset });
  } catch (err) {
    console.error("[MEMBERS OUTSTANDING BILLS ERROR]", err);
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
          CreatedDate,
          CreatedBy
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
        ORDER BY CreatedDate ASC
      `);
    
    // Calculate running balance dynamically based on net column impacts (BillAmount - PaidAmount)
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
    console.error("[MEMBERS STATEMENT ERROR]", err);
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
        ISNULL(SUM(OutstandingAmount), 0) AS TotalOutstanding,
        ISNULL(SUM(
          CASE 
            WHEN CreatedDate < DATEADD(day, -30, GETDATE()) THEN OutstandingAmount 
            ELSE 0 
          END
        ), 0) AS TotalOverdue
      FROM CustomerCreditTransactions
      WHERE TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT') AND Status IN ('OPEN', 'PARTIAL')
    `);
    
    // Total Customers with Credit
    const custCountRes = await pool.request().query(`
      SELECT COUNT(*) AS CreditCustomerCount 
      FROM MemberMaster 
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
    console.error("[RECEIVABLES DASHBOARD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= AGING REPORT ================= */
router.get("/receivables/aging", async (req, res) => {
  try {
    const pool = await poolPromise;
    
    // Group transactions by bill date and classify outstanding
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
        m.MemberId,
        m.Name,
        m.Phone,
        ISNULL(SUM(b.NetOutstanding), 0) AS OutstandingBalance,
        ISNULL(SUM(CASE WHEN b.AgeDays <= 30 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket0to30,
        ISNULL(SUM(CASE WHEN b.AgeDays > 30 AND b.AgeDays <= 60 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket31to60,
        ISNULL(SUM(CASE WHEN b.AgeDays > 60 AND b.AgeDays <= 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket61to90,
        ISNULL(SUM(CASE WHEN b.AgeDays > 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket90Plus
      FROM MemberMaster m
      INNER JOIN BillBalances b ON m.MemberId = b.MemberId
      WHERE m.IsActive = 1
      GROUP BY m.MemberId, m.Name, m.Phone
      ORDER BY m.Name
    `;
    
    const result = await pool.request().query(query);
    const customers = result.recordset || [];
    
    // Calculate total summary per bucket
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
    console.error("[RECEIVABLES AGING ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
