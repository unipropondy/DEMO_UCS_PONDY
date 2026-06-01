const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { processSplitPayments } = require("../services/payment.service");

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
    await pool.request()
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, phone)
      .input("Email", sql.NVarChar, email)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .input("CreatedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        INSERT INTO MemberMaster (Name, Phone, Email, Address, IsActive, CreditLimit, CurrentBalance, Balance, CreatedBy)
        VALUES (@Name, @Phone, @Email, @Address, @IsActive, @CreditLimit, @CurrentBalance, @Balance, @CreatedBy)
      `);
    res.json({ success: true });
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
  let transaction;
  try {
    const pool = await poolPromise;
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ error: "Missing memberId" });

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const request = new sql.Request(transaction);
    request.input("Id", sql.UniqueIdentifier, memberId);

    await request.query("IF OBJECT_ID('MemberTimeLog', 'U') IS NOT NULL DELETE FROM MemberTimeLog WHERE MemberId = @Id");
    await request.query("IF COL_LENGTH('SettlementHeader', 'MemberId') IS NOT NULL UPDATE SettlementHeader SET MemberId = NULL WHERE MemberId = @Id;");
    await request.query("DELETE FROM MemberMaster WHERE MemberId = @Id");

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBERS DELETE ERROR]", err);
    if (transaction) await transaction.rollback();
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

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
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
    const memberPaymentId = payIdRes.recordset[0].id;

    // 3. Process split payments using unified service
    await processSplitPayments({
      referenceType: "MEMBER",
      referenceId: memberId,
      payments,
      transaction,
      cashierId: userId ? String(userId).trim() : null
    });

    // 4. Update member balance (subtract paid amount to clear/reduce credit balance)
    await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @Amount WHERE MemberId = @MemberId");

    await transaction.commit();
    res.json({ success: true, memberPaymentId });
  } catch (err) {
    console.error("[MEMBER PAYMENT ERROR]", err);
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
