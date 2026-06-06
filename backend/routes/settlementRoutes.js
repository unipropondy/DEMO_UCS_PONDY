const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

// ============================================
// 1️⃣ CHECK IF DAY IS SETTLED
// ============================================
router.get('/check', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    console.log('📡 Check settlement:', { outletId, date });
    
    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT Id, Status FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);
    
    res.json({ 
      success: true, 
      settled: result.recordset.length > 0 && result.recordset[0]?.Status === 'COMPLETED',
      settlementId: result.recordset[0]?.Id || null
    });
  } catch (err) {
    console.error('Check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 2️⃣ GET OPENING CASH
// ============================================
router.get('/opening-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT OpeningCashJSON, OpeningCashTotal FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);
    
    if (result.recordset.length === 0) {
      return res.json({ success: true, data: null });
    }
    
    if (!result.recordset[0]?.OpeningCashJSON) {
      return res.json({ success: true, data: { total: result.recordset[0].OpeningCashTotal || 0 } });
    }
    
    const data = JSON.parse(result.recordset[0].OpeningCashJSON);
    res.json({ 
      success: true, 
      data: { 
        notes: data.notes || {}, 
        coins: data.coins || {}, 
        total: result.recordset[0].OpeningCashTotal || 0
      } 
    });
  } catch (err) {
    console.error('Get opening cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 3️⃣ SAVE OPENING CASH
// ============================================
router.post('/opening-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, notes, coins, total, cashierName } = req.body;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    const openingCashJSON = JSON.stringify({ notes, coins });
    const pool = getPool();
    
    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('openingCashJSON', sql.NVarChar, openingCashJSON)
      .input('openingCashTotal', sql.Decimal(10,2), total || 0)
      .input('cashierName', sql.NVarChar, cashierName || '')
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET OpeningCashJSON = @openingCashJSON, OpeningCashTotal = @openingCashTotal, CashierName = @cashierName, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (OutletId, SettlementDate, CashierName, OpeningCashJSON, OpeningCashTotal, CreatedAt)
          VALUES (@outletId, @settlementDate, @cashierName, @openingCashJSON, @openingCashTotal, GETDATE());
      `);
    
    res.json({ success: true, message: 'Opening cash saved' });
  } catch (err) {
    console.error('Save opening cash error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// 7️⃣ GET PHYSICAL CASH
// ============================================
router.get('/physical-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT PhysicalCashJSON, PhysicalCashTotal FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);
    
    if (result.recordset.length === 0 || !result.recordset[0]?.PhysicalCashJSON) {
      return res.json({ success: true, data: null });
    }
    
    const data = JSON.parse(result.recordset[0].PhysicalCashJSON);
    res.json({ 
      success: true, 
      data: { 
        notes: data.notes || {}, 
        coins: data.coins || {}, 
        total: result.recordset[0].PhysicalCashTotal || 0
      } 
    });
  } catch (err) {
    console.error('Get physical cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 8️⃣ SAVE PHYSICAL CASH
// ============================================
router.post('/physical-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, notes, coins, total } = req.body;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    const physicalCashJSON = JSON.stringify({ notes, coins });
    const pool = getPool();
    
    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('physicalCashJSON', sql.NVarChar, physicalCashJSON)
      .input('physicalCashTotal', sql.Decimal(10,2), total || 0)
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET PhysicalCashJSON = @physicalCashJSON, PhysicalCashTotal = @physicalCashTotal, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (OutletId, SettlementDate, PhysicalCashJSON, PhysicalCashTotal, CreatedAt)
          VALUES (@outletId, @settlementDate, @physicalCashJSON, @physicalCashTotal, GETDATE());
      `);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Save physical cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 9️⃣ FINALIZE SETTLEMENT
// ============================================
router.post('/finalize', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, cashierName, totalSales, totalDiscount, voidAmount, netSales,
            cashReceived, openingCash, manualCashOutTotal, expectedClosing, physicalCash,
            variance, varianceStatus, cashAmount, cardAmount, upiAmount, paynowAmount, valueCardAmount } = req.body;
    
    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }
    
    const paymentBreakdownJSON = JSON.stringify({ 
      cash: cashAmount || 0, card: cardAmount || 0, upi: upiAmount || 0, 
      paynow: paynowAmount || 0, valuecard: valueCardAmount || 0 
    });
    
    const pool = getPool();
    
    // Check if already settled
    const checkResult = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .query(`SELECT Id FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate AND Status = 'COMPLETED'`);
    
    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ error: 'Day already settled' });
    }
    
    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('cashierName', sql.NVarChar, cashierName || '')
      .input('totalSales', sql.Decimal(10,2), totalSales || 0)
      .input('totalDiscount', sql.Decimal(10,2), totalDiscount || 0)
      .input('voidAmount', sql.Decimal(10,2), voidAmount || 0)
      .input('netSales', sql.Decimal(10,2), netSales || 0)
      .input('cashReceived', sql.Decimal(10,2), cashReceived || 0)
      .input('expectedClosing', sql.Decimal(10,2), expectedClosing || 0)
      .input('cashVariance', sql.Decimal(10,2), variance || 0)
      .input('varianceStatus', sql.NVarChar, varianceStatus || 'BALANCED')
      .input('paymentBreakdownJSON', sql.NVarChar, paymentBreakdownJSON)
      .input('status', sql.NVarChar, 'COMPLETED')
      .input('settledBy', sql.NVarChar, req.user.userId || req.user.id || '')
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET 
            TotalSales = @totalSales,
            TotalDiscount = @totalDiscount,
            VoidAmount = @voidAmount,
            NetSales = @netSales,
            CashReceived = @cashReceived,
            ExpectedClosingCash = @expectedClosing,
            CashVariance = @cashVariance,
            VarianceStatus = @varianceStatus,
            PaymentBreakdownJSON = @paymentBreakdownJSON,
            Status = @status,
            SettledBy = @settledBy,
            SettledAt = GETDATE(),
            UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (
            OutletId, SettlementDate, CashierName, TotalSales, TotalDiscount, 
            VoidAmount, NetSales, CashReceived, ExpectedClosingCash, CashVariance, 
            VarianceStatus, PaymentBreakdownJSON, Status, SettledBy, SettledAt, 
            CreatedAt, UpdatedAt
          )
          VALUES (
            @outletId, @settlementDate, @cashierName, @totalSales, @totalDiscount, 
            @voidAmount, @netSales, @cashReceived, @expectedClosing, @cashVariance, 
            @varianceStatus, @paymentBreakdownJSON, @status, @settledBy, GETDATE(), 
            GETDATE(), GETDATE()
          );
      `);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error finalizing:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 10️⃣ GET DENOMINATIONS
// ============================================
router.get('/denominations', authenticateToken, async (req, res) => {
  try {
    const type = req.query.type === 'CLOSE' ? 'CLOSE' : 'OPEN';
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT CurrencyValue, NoteCount 
      FROM OpeningCashDenomination 
      WHERE CAST(CreatedOn as DATE) = CAST(GETDATE() as DATE)
      AND Type = '${type}'
    `);
    
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error getting denominations:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 11️⃣ SAVE DENOMINATIONS
// ============================================
router.post('/save-denominations', authenticateToken, async (req, res) => {
  try {
    const { denominations, type } = req.body;
    const recordType = type === 'CLOSE' ? 'CLOSE' : 'OPEN';
    
    if (!denominations || !Array.isArray(denominations)) {
      return res.status(400).json({ error: 'Invalid denominations data' });
    }
    
    const pool = getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      const request = new sql.Request(transaction);
      const createdBy = req.user?.userName || req.user?.username || 'Admin';
      
      // Delete existing records for today to allow "update"
      await request.query(`
        DELETE FROM OpeningCashDenomination 
        WHERE CAST(CreatedOn as DATE) = CAST(GETDATE() as DATE)
        AND Type = '${recordType}'
      `);
      
      // Loop through and insert each denomination that has a count > 0
      for (const item of denominations) {
        if (item.count > 0) {
          await request.query(`
            INSERT INTO OpeningCashDenomination (CurrencyValue, NoteCount, Type, CreatedBy, CreatedOn)
            VALUES (${item.value}, ${item.count}, '${recordType}', '${createdBy.replace(/'/g, "''")}', GETDATE())
          `);
        }
      }
      
      await transaction.commit();
      res.json({ success: true, message: 'Denominations saved successfully' });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Error saving denominations:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 12️⃣ CASH OUT CRUD OPERATIONS
// ============================================

// GET Cash Out entries for a specific terminal (or ALL) for today
router.get('/cash-out/:terminal', authenticateToken, async (req, res) => {
  try {
    const { terminal } = req.params;
    const { fromDate, toDate } = req.query;
    const pool = getPool();
    const request = pool.request();
    
    let dateFilter = "CAST(CashOutDate as DATE) = CAST(GETDATE() as DATE)";
    if (fromDate && toDate) {
      request.input("fromDate", sql.Date, new Date(fromDate));
      request.input("toDate", sql.Date, new Date(toDate));
      dateFilter = "CAST(CashOutDate as DATE) BETWEEN @fromDate AND @toDate";
    }

    let query = `
      SELECT CashOutId, CashOutNo, CashOutDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn 
      FROM CashOutEntry 
      WHERE ${dateFilter}
    `;

    if (terminal !== 'ALL') {
      query += ` AND TerminalCode = @TerminalCode`;
      request.input('TerminalCode', sql.VarChar, terminal);
    }

    query += ` ORDER BY CreatedOn DESC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cash out entries:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST new Cash Out entry
router.post('/cash-out', authenticateToken, async (req, res) => {
  try {
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const createdBy = req.user?.userName || req.user?.username || 'Admin';
    const pool = getPool();
    
    // Generate simple auto-incrementing/timestamp-based CashOutNo
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(1000 + Math.random() * 9000);
    const cashOutNo = `CO-${dateStr}-${randId}`;

    const result = await pool.request()
      .input('CashOutNo', sql.VarChar, cashOutNo)
      .input('Amount', sql.Decimal(18,2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', sql.VarChar, referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .input('CreatedBy', sql.VarChar, createdBy)
      .query(`
        INSERT INTO CashOutEntry (CashOutNo, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn)
        OUTPUT inserted.*
        VALUES (@CashOutNo, @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, GETDATE())
      `);

    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error creating cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update Cash Out entry
router.put('/cash-out/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('CashOutId', sql.UniqueIdentifier, id)
      .input('Amount', sql.Decimal(18,2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', sql.VarChar, referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .query(`
        UPDATE CashOutEntry
        SET Amount = @Amount, Reason = @Reason, Remarks = @Remarks, PaymentMode = @PaymentMode, 
            ReferenceNo = @ReferenceNo, TerminalCode = @TerminalCode
        OUTPUT inserted.*
        WHERE CashOutId = @CashOutId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cash out entry not found' });
    }

    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error updating cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE Cash Out entry
router.delete('/cash-out/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const result = await pool.request()
      .input('CashOutId', sql.UniqueIdentifier, id)
      .query(`
        DELETE FROM CashOutEntry
        WHERE CashOutId = @CashOutId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Cash out entry not found' });
    }

    res.json({ success: true, message: 'Cash out entry deleted successfully' });
  } catch (err) {
    console.error('Error deleting cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
