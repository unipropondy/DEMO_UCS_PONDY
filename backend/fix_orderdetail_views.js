const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

async function fix() {
  const pool = await sql.connect(dbConfig);
  const t = pool.transaction();
  await t.begin();

  try {
    console.log("=== FIX 1: Alter vw_RestaurantOrderDetailCur to explicitly expose discount + isTakeAway ===");
    // The view uses OD.* but because of the complex JOIN ordering, 
    // DiscountAmount and DiscountType get hidden. We ALTER the view to use explicit columns.
    await t.request().query(`
      ALTER VIEW [dbo].[vw_RestaurantOrderDetailCur]
      AS
      SELECT
        OD.OrderDetailId, OD.OrderId, OD.DishId, OD.Description, OD.Quantity, OD.PricePerUnit,
        OD.BaseAmount, OD.ManualDiscountAmount, OD.TotalDetailLineAmount, OD.AssociatedDishId,
        OD.OrderDateTime, OD.StatusCode, OD.BusinessUnitId, OD.CreatedBy, OD.CreatedOn,
        OD.ModifiedBy, OD.ModifiedOn, OD.SeqNo, OD.isTakeAway, OD.DishName, OD.ActualAmount,
        OD.Tax, OD.ServiceCharge, OD.PFlag, OD.ModifierDescription, OD.Remarks, OD.ExFlag,
        OD.IsODFOC, OD.IsODItemDiscount, OD.isstandardMenu, OD.Pcs, OD.isProcesse,
        OD.isReady, OD.isDelivered, OD.Spicy, OD.Salt, OD.Oil, OD.Sugar,
        OD.OrderConfirmQty, OD.VoidReason,
        OD.DiscountAmount, OD.DiscountType,
        OD.ModifiersJSON, OD.OrderNumber,
        ORG.BusinessUnitCode,
        UM.FullName,
        Dish.Name AS Name,
        Dish.DishCode AS DishCode,
        ISNULL(Dish.ShortName, '') AS ShortName,
        DK.KitchenTypeCode AS KitchenType,
        Dish.SubkitchenType AS SubKitchenType,
        Dish.DishGroupId AS DishGroupId,
        Dish.iskitchenPrint AS IsKitchenPrint,
        Dish.isStockDish AS isStockDish,
        Dish.isDiscountAllowed AS DiscountAllowed,
        Dish.isFOC,
        Dish.UnitCost,
        DishGroup.DishGroupCode,
        DishGroup.DishGroupName AS DishGroupName,
        DishGroup.SortCode AS DishGroupSort,
        DK.KitchenTypeName AS KitchenTypeName,
        PM3.PickListValue AS SubKitchenTypeName,
        PM1.PickListValue AS StatusCodeName,
        Dish.NameInOtherLanguage
      FROM dbo.DishGroupMaster DishGroup
      RIGHT OUTER JOIN dbo.RestaurantOrderDetailCur OD
        INNER JOIN dbo.DishMaster Dish ON OD.DishId = Dish.DishId
        LEFT OUTER JOIN dbo.DishKitchenType DK ON OD.DishId = DK.DishId
        LEFT OUTER JOIN dbo.PickListMaster PM1 ON OD.StatusCode = PM1.PickListNumber
          AND PM1.TableName = 'RestaurantOrderDetail' AND PM1.FieldName = 'StatusCode'
        LEFT OUTER JOIN dbo.PickListMaster PM3 ON Dish.SubkitchenType = PM3.PickListNumber
          AND PM3.TableName = 'DishMaster' AND PM3.FieldName = 'SubKitchenType'
        LEFT OUTER JOIN dbo.PickListMaster PM2 ON Dish.KitchenType = PM2.PickListNumber
          AND PM2.TableName = 'DishMaster' AND PM2.FieldName = 'KitchenType'
      ON DishGroup.DishGroupId = Dish.DishGroupId
      INNER JOIN Organization ORG ON ORG.businessUnitId = OD.BusinessUnitId
      INNER JOIN UserMaster UM ON UM.UserId = OD.CreatedBy;
    `);
    console.log("✅ vw_RestaurantOrderDetailCur altered");

    console.log("\n=== FIX 2: Alter vw_RestaurantOrderDetail to explicitly expose discount + isTakeAway ===");
    await t.request().query(`
      ALTER VIEW [dbo].[vw_RestaurantOrderDetail]
      AS
      SELECT
        OD.OrderDetailId, OD.OrderId, OD.DishId, OD.Description, OD.Quantity, OD.PricePerUnit,
        OD.BaseAmount, OD.ManualDiscountAmount, OD.TotalDetailLineAmount, OD.AssociatedDishId,
        OD.OrderDateTime, OD.StatusCode, OD.BusinessUnitId, OD.CreatedBy, OD.CreatedOn,
        OD.ModifiedBy, OD.ModifiedOn, OD.SeqNo, OD.isTakeAway, OD.DishName, OD.ActualAmount,
        OD.Tax, OD.ServiceCharge, OD.PFlag, OD.ModifierDescription, OD.Remarks, OD.ExFlag,
        OD.IsODFOC, OD.IsODItemDiscount, OD.isstandardMenu, OD.Pcs, OD.isProcesse,
        OD.isReady, OD.isDelivered, OD.Spicy, OD.Salt, OD.Oil, OD.Sugar,
        OD.OrderConfirmQty, OD.VoidReason,
        OD.DiscountAmount, OD.DiscountType,
        ORG.BusinessUnitCode,
        UM.FullName,
        Dish.Name AS Name,
        Dish.DishCode AS DishCode,
        ISNULL(Dish.ShortName, '') AS ShortName,
        DK.KitchenTypeCode AS KitchenType,
        Dish.SubkitchenType AS SubKitchenType,
        Dish.DishGroupId AS DishGroupId,
        Dish.iskitchenPrint AS IsKitchenPrint,
        Dish.isStockDish AS isStockDish,
        Dish.isDiscountAllowed AS DiscountAllowed,
        Dish.isFOC,
        Dish.UnitCost,
        DishGroup.DishGroupCode,
        DishGroup.DishGroupName AS DishGroupName,
        DishGroup.SortCode AS DishGroupSort,
        DK.KitchenTypeName AS KitchenTypeName,
        PM3.PickListValue AS SubKitchenTypeName,
        PM1.PickListValue AS StatusCodeName,
        Dish.NameInOtherLanguage
      FROM dbo.DishGroupMaster DishGroup
      RIGHT OUTER JOIN dbo.RestaurantOrderDetail OD
        INNER JOIN dbo.DishMaster Dish ON OD.DishId = Dish.DishId
        LEFT OUTER JOIN dbo.DishKitchenType DK ON OD.DishId = DK.DishId
        LEFT OUTER JOIN dbo.PickListMaster PM1 ON OD.StatusCode = PM1.PickListNumber
          AND PM1.TableName = 'RestaurantOrderDetail' AND PM1.FieldName = 'StatusCode'
        LEFT OUTER JOIN dbo.PickListMaster PM3 ON Dish.SubkitchenType = PM3.PickListNumber
          AND PM3.TableName = 'DishMaster' AND PM3.FieldName = 'SubKitchenType'
        LEFT OUTER JOIN dbo.PickListMaster PM2 ON Dish.KitchenType = PM2.PickListNumber
          AND PM2.TableName = 'DishMaster' AND PM2.FieldName = 'KitchenType'
      ON DishGroup.DishGroupId = Dish.DishGroupId
      INNER JOIN Organization ORG ON ORG.businessUnitId = OD.BusinessUnitId
      INNER JOIN UserMaster UM ON UM.UserId = OD.CreatedBy;
    `);
    console.log("✅ vw_RestaurantOrderDetail altered");

    console.log("\n=== FIX 3: Backfill RestaurantOrderDetailCur - DiscountType NULL where DiscountAmount=0 ===");
    const bfCur = await t.request().query(`
      UPDATE RestaurantOrderDetailCur
      SET DiscountType = 'fixed'
      WHERE DiscountType IS NULL AND (DiscountAmount IS NULL OR DiscountAmount = 0)
    `);
    console.log(`✅ RestaurantOrderDetailCur DiscountType backfilled: ${bfCur.rowsAffected[0]} rows`);

    console.log("\n=== FIX 4: Backfill RestaurantOrderDetailCur - DiscountAmount NULL => 0 ===");
    const bfCurAmt = await t.request().query(`
      UPDATE RestaurantOrderDetailCur
      SET DiscountAmount = 0
      WHERE DiscountAmount IS NULL
    `);
    console.log(`✅ RestaurantOrderDetailCur DiscountAmount backfilled: ${bfCurAmt.rowsAffected[0]} rows`);

    console.log("\n=== FIX 5: Backfill RestaurantOrderDetailCur - BaseAmount = PricePerUnit * Quantity ===");
    const bfBase = await t.request().query(`
      UPDATE RestaurantOrderDetailCur
      SET BaseAmount = PricePerUnit * Quantity
      WHERE BaseAmount IS NULL
    `);
    console.log(`✅ RestaurantOrderDetailCur BaseAmount backfilled: ${bfBase.rowsAffected[0]} rows`);

    console.log("\n=== FIX 6: Backfill RestaurantOrderDetail - DiscountType NULL where DiscountAmount=0 ===");
    const bfHist = await t.request().query(`
      UPDATE RestaurantOrderDetail
      SET DiscountType = 'fixed'
      WHERE DiscountType IS NULL AND (DiscountAmount IS NULL OR DiscountAmount = 0)
    `);
    console.log(`✅ RestaurantOrderDetail DiscountType backfilled: ${bfHist.rowsAffected[0]} rows`);

    console.log("\n=== FIX 7: Backfill RestaurantOrderDetail - DiscountAmount NULL => 0 ===");
    const bfHistAmt = await t.request().query(`
      UPDATE RestaurantOrderDetail
      SET DiscountAmount = 0
      WHERE DiscountAmount IS NULL
    `);
    console.log(`✅ RestaurantOrderDetail DiscountAmount backfilled: ${bfHistAmt.rowsAffected[0]} rows`);

    console.log("\n=== FIX 8: Backfill RestaurantOrderDetail - BaseAmount = PricePerUnit * Quantity ===");
    const bfBaseHist = await t.request().query(`
      UPDATE RestaurantOrderDetail
      SET BaseAmount = PricePerUnit * Quantity
      WHERE BaseAmount IS NULL
    `);
    console.log(`✅ RestaurantOrderDetail BaseAmount backfilled: ${bfBaseHist.rowsAffected[0]} rows`);

    console.log("\n=== FIX 9: Backfill isTakeAway from header for Cur table ===");
    const bfTw = await t.request().query(`
      UPDATE d
      SET d.isTakeAway = ISNULL(h.IsTakeAway, 0)
      FROM RestaurantOrderDetailCur d
      INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
      WHERE d.isTakeAway = 0 AND h.IsTakeAway = 1
    `);
    console.log(`✅ RestaurantOrderDetailCur isTakeAway backfilled: ${bfTw.rowsAffected[0]} rows`);

    await t.commit();
    console.log("\n✅ All fixes committed!");

    // Verify views now expose DiscountAmount/DiscountType
    console.log("\n=== VERIFICATION ===");
    const v1 = await pool.request().query(`SELECT TOP 3 OrderDetailId, DishName, DishCode, DiscountAmount, DiscountType, isTakeAway, BaseAmount FROM vw_RestaurantOrderDetailCur ORDER BY CreatedOn DESC`);
    console.log("vw_RestaurantOrderDetailCur:");
    console.table(v1.recordset);

    const v2 = await pool.request().query(`SELECT TOP 3 OrderDetailId, DishName, DishCode, DiscountAmount, DiscountType, isTakeAway, BaseAmount FROM vw_RestaurantOrderDetail ORDER BY CreatedOn DESC`);
    console.log("vw_RestaurantOrderDetail:");
    console.table(v2.recordset);

  } catch(err) {
    await t.rollback();
    console.error("❌ Error - rolled back:", err.message);
    throw err;
  }

  await pool.close();
}

fix().catch(console.error);
