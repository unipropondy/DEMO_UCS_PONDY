const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");

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

module.exports = router;
