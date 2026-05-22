const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");

// 🔹 GET Settings
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT TOP 1 * FROM AppSettings");
    res.json(result.recordset[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 UPDATE Settings
router.post("/update", async (req, res) => {
  try {
    const { upiId, shopName, qrCodeUrl, enableKOT, enableKDS, enableCheckoutBill, enableCheckoutFlow, enableDirectProcessToPay } = req.body;
    const pool = await poolPromise;

    // Use an UPSERT logic (Update if exists, Insert if not)
    await pool.request()
      .input("UPI", sql.NVarChar, upiId || null)
      .input("Shop", sql.NVarChar, shopName || "My Restaurant")
      .input("QR", sql.NVarChar, qrCodeUrl || null)
      .input("EnableKOT", sql.Bit, enableKOT !== undefined ? enableKOT : 1)
      .input("EnableKDS", sql.Bit, enableKDS !== undefined ? enableKDS : 1)
      .input("EnableCheckoutBill", sql.Bit, enableCheckoutBill !== undefined ? enableCheckoutBill : 1)
      .input("EnableCheckoutFlow", sql.Bit, enableCheckoutFlow !== undefined ? enableCheckoutFlow : 1)
      .input("EnableDirectProcessToPay", sql.Bit, enableDirectProcessToPay !== undefined ? enableDirectProcessToPay : 0)
      .query(`
        IF EXISTS (SELECT 1 FROM AppSettings)
        BEGIN
          UPDATE AppSettings
          SET 
            UPI_ID = @UPI,
            ShopName = @Shop,
            PayNow_QR_Url = @QR,
            EnableKOT = @EnableKOT,
            EnableKDS = @EnableKDS,
            EnableCheckoutBill = @EnableCheckoutBill,
            EnableCheckoutFlow = @EnableCheckoutFlow,
            EnableDirectProcessToPay = @EnableDirectProcessToPay,
            UpdatedOn = GETDATE()
        END
        ELSE
        BEGIN
          INSERT INTO AppSettings (UPI_ID, ShopName, PayNow_QR_Url, EnableKOT, EnableKDS, EnableCheckoutBill, EnableCheckoutFlow, EnableDirectProcessToPay, UpdatedOn)
          VALUES (@UPI, @Shop, @QR, @EnableKOT, @EnableKDS, @EnableCheckoutBill, @EnableCheckoutFlow, @EnableDirectProcessToPay, GETDATE())
        END
      `);

    res.json({ success: true, message: "Settings updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET Kitchen Printers
router.get("/kitchen-printers", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT KitchenTypeValue, KitchenTypeName, PrinterPath FROM PrintMaster WHERE IsActive = 1");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 UPDATE Kitchen Printers
router.post("/kitchen-printers/update", async (req, res) => {
  try {
    const { printers } = req.body; // Array of { id: KitchenTypeValue, ip: PrinterPath }
    const pool = await poolPromise;

    for (const printer of printers) {
      await pool.request()
        .input("id", sql.Int, printer.id)
        .input("ip", sql.NVarChar, printer.ip)
        .query("UPDATE PrintMaster SET PrinterPath = @ip WHERE KitchenTypeValue = @id");
    }

    res.json({ success: true, message: "Kitchen printers updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 ADD Kitchen Printer
router.post("/kitchen-printers/add", async (req, res) => {
  try {
    const { name, ip } = req.body;
    const pool = await poolPromise;
    
    await pool.request()
      .input("name", sql.NVarChar, name)
      .input("ip", sql.NVarChar, ip)
      .query(`
        DECLARE @nextVal INT = (SELECT ISNULL(MAX(KitchenTypeValue), 0) + 1 FROM PrintMaster);
        INSERT INTO PrintMaster (
          PrinterId, PrinterName, PrinterPath, PrinterIP, 
          PrinterType, PrintSection, KitchenTypeName, 
          KitchenTypeValue, IsActive, PrintCopy
        )
        VALUES (
          NEWID(), @name, @ip, @ip, 
          2, 1, @name, 
          @nextVal, 1, 1
        )
      `);

    res.json({ success: true, message: "Kitchen printer added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 DELETE Kitchen Printer (Soft Delete)
router.post("/kitchen-printers/delete", async (req, res) => {
  try {
    const { id } = req.body; // KitchenTypeValue
    const pool = await poolPromise;
    
    await pool.request()
      .input("id", sql.Int, id)
      .query("UPDATE PrintMaster SET IsActive = 0 WHERE KitchenTypeValue = @id");

    res.json({ success: true, message: "Kitchen printer deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
