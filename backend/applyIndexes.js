const path = require("path");
const { poolPromise } = require("c:\\Users\\UNIPRO\\Desktop\\UCS_PONDY\\backend\\config\\db");

const indexes = [
  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderDetailCur_StatusCode' AND object_id = OBJECT_ID('RestaurantOrderDetailCur'))
   CREATE INDEX [IX_RestaurantOrderDetailCur_StatusCode] ON [RestaurantOrderDetailCur] ([StatusCode])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderDetailCur_OrderNumber_StatusCode' AND object_id = OBJECT_ID('RestaurantOrderDetailCur'))
   CREATE INDEX [IX_RestaurantOrderDetailCur_OrderNumber_StatusCode] ON [RestaurantOrderDetailCur] ([OrderNumber],[StatusCode])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderDetailCur_OrderDateTime' AND object_id = OBJECT_ID('RestaurantOrderDetailCur'))
   CREATE INDEX [IX_RestaurantOrderDetailCur_OrderDateTime] ON [RestaurantOrderDetailCur] ([OrderDateTime]) INCLUDE ([Quantity], [TotalDetailLineAmount], [BusinessUnitId], [CreatedBy])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PaymentDetailCur_PaymentCollectedOn' AND object_id = OBJECT_ID('PaymentDetailCur'))
   CREATE INDEX [IX_PaymentDetailCur_PaymentCollectedOn] ON [PaymentDetailCur] ([PaymentCollectedOn]) INCLUDE ([Amount], [Remarks], [TerminalCode], [isSettlement], [isDayEnd])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PaymentDetailCur_RestaurantBillId' AND object_id = OBJECT_ID('PaymentDetailCur'))
   CREATE INDEX [IX_PaymentDetailCur_RestaurantBillId] ON [PaymentDetailCur] ([RestaurantBillId]) INCLUDE ([Paymode])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PaymentDetailCur_TerminalCode_isSettlement' AND object_id = OBJECT_ID('PaymentDetailCur'))
   CREATE INDEX [IX_PaymentDetailCur_TerminalCode_isSettlement] ON [PaymentDetailCur] ([TerminalCode], [isSettlement]) INCLUDE ([Paymode], [Amount])`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_RestaurantOrderDetailCur_DishId' AND object_id = OBJECT_ID('RestaurantOrderDetailCur'))
   CREATE INDEX [IX_RestaurantOrderDetailCur_DishId] ON [RestaurantOrderDetailCur] ([DishId]) INCLUDE ([TotalDetailLineAmount], [BusinessUnitId], [CreatedBy])`
];

async function main() {
  const pool = await poolPromise;
  if (!pool) {
    console.error("No pool promise resolved");
    process.exit(1);
  }
  
  console.log("⚙️ Applying database optimizations...");
  
  for (let i = 0; i < indexes.length; i++) {
    try {
      console.log(`Executing query ${i+1}/${indexes.length}...`);
      await pool.request().query(indexes[i]);
      console.log(`✅ Index applied successfully.`);
    } catch (err) {
      console.error(`❌ Failed to apply index ${i+1}:`, err.message);
    }
  }

  console.log("🎉 Database index optimization complete!");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
