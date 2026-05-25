// components/SunmiPrinterService.ts - PERFECT DESIGN MATCHING YOUR PREVIEW ✅

import { Platform } from "react-native";
import { API_URL } from "../constants/Config";

// ✅ Guarded imports for native module to prevent crashes on non-Android platforms
let SunmiModule: any = null;
if (Platform.OS === "android") {
  try {
    SunmiModule = require("sunmi-printer-expo");
  } catch (e) {
    console.log("Sunmi module load failed:", e);
  }
}

class SunmiPrinterService {
  static async init(): Promise<boolean> {
    if (Platform.OS !== "android") {
      console.log("Not Android - cannot use Sunmi printer");
      return false;
    }

    try {
      if (!SunmiModule) return false;
      await SunmiModule.initPrinter();
      console.log("✅ Sunmi printer initialized");
      return true;
    } catch (error) {
      console.log("❌ Printer init failed:", error);
      return false;
    }
  }

  // Convert any image URL to Base64
  private static async urlToBase64(url: string): Promise<string> {
    console.log("🔄 Converting URL to Base64:", url);
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        let base64 = reader.result as string;
        if (base64.includes(",")) {
          base64 = base64.split(",")[1];
        }
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Print logos (thermal printers can't do side-by-side, so print one after another)
  private static async printLogos(companySettings: any): Promise<void> {
    const hasCompanyLogo =
      companySettings.showCompanyLogo && companySettings.companyLogo;
    const hasHalalLogo =
      companySettings.showHalalLogo && companySettings.halalLogo;

    // Print company logo
    if (hasCompanyLogo) {
      try {
        let logoUrl = companySettings.companyLogo;
        if (logoUrl && !logoUrl.startsWith("http")) {
          // Use API_URL as primary, fallback to production if needed
          logoUrl = logoUrl.startsWith("/")
            ? `${API_URL}${logoUrl}`
            : `${API_URL}/${logoUrl}`;
        }
        const base64Image = await this.urlToBase64(logoUrl);
        await SunmiModule.printImageBase64(base64Image);
        await SunmiModule.lineWrap(1);
        console.log("✅ Company logo printed");
      } catch (e) {
        console.log("❌ Company logo failed:", e);
        // Secondary fallback to production URL if API_URL fails
        try {
          let prodUrl = companySettings.companyLogo;
          if (prodUrl && !prodUrl.startsWith("http")) {
            prodUrl = prodUrl.startsWith("/")
              ? `${API_URL}${prodUrl}`
              : `${API_URL}/${prodUrl}`;
            const base64Image = await this.urlToBase64(prodUrl);
            await SunmiModule.printImageBase64(base64Image);
            await SunmiModule.lineWrap(1);
          }
        } catch (e2) {}
      }
    }

    // Print halal logo
    if (hasHalalLogo) {
      try {
        let halalUrl = companySettings.halalLogo;
        if (halalUrl && !halalUrl.startsWith("http")) {
          halalUrl = halalUrl.startsWith("/")
            ? `${API_URL}${halalUrl}`
            : `${API_URL}/${halalUrl}`;
        }
        const base64Image = await this.urlToBase64(halalUrl);
        await SunmiModule.printImageBase64(base64Image);
        await SunmiModule.lineWrap(1);
        console.log("✅ Halal logo printed");
      } catch (e) {
        console.log("❌ Halal logo failed:", e);
        try {
          let prodUrl = companySettings.halalLogo;
          if (prodUrl && !prodUrl.startsWith("http")) {
            prodUrl = prodUrl.startsWith("/")
              ? `${API_URL}${prodUrl}`
              : `${API_URL}/${prodUrl}`;
            const base64Image = await this.urlToBase64(prodUrl);
            await SunmiModule.printImageBase64(base64Image);
            await SunmiModule.lineWrap(1);
          }
        } catch (e2) {}
      }
    }
  }

  // Center text (full width 32 chars)
  private static async center(text: string): Promise<void> {
    const maxWidth = 32;
    let displayText = text;
    if (displayText.length > maxWidth) {
      displayText = displayText.substring(0, maxWidth - 3) + "...";
    }
    const padding = Math.max(
      0,
      Math.floor((maxWidth - displayText.length) / 2),
    );
    const centeredText = " ".repeat(padding) + displayText;
    await SunmiModule.printText(centeredText);
  }

  // Left aligned
  private static async left(text: string): Promise<void> {
    await SunmiModule.printText(text);
  }

  // Divider line (full width 32 chars)
  private static async divider(char: string = "-"): Promise<void> {
    await SunmiModule.printText(char.repeat(32));
  }

  // Double divider
  private static async doubleDivider(char: string = "="): Promise<void> {
    await SunmiModule.printText(char.repeat(32));
  }

  // Two columns (for totals)
  private static async twoCols(left: string, right: string): Promise<void> {
    const leftWidth = 20;
    let line = left.substring(0, leftWidth).padEnd(leftWidth, " ");
    line += right.substring(0, 12).padStart(12, " ");
    await SunmiModule.printText(line);
  }

  // Four columns for items (ITEM, QTY, PRICE, TOTAL)
  private static async itemRow(
    name: string,
    qty: string,
    price: string,
    total: string,
  ): Promise<void> {
    const nameWidth = 14;
    const qtyWidth = 4;
    const priceWidth = 6;
    const totalWidth = 8;

    let line = name.substring(0, nameWidth).padEnd(nameWidth, " ");
    line += qty.substring(0, qtyWidth).padStart(qtyWidth, " ");
    line += price.substring(0, priceWidth).padStart(priceWidth, " ");
    line += total.substring(0, totalWidth).padStart(totalWidth, " ");
    await SunmiModule.printText(line);
  }

  // Item header
  private static async itemHeader(): Promise<void> {
    let line = "ITEM".padEnd(14, " ");
    line += "QTY".padStart(4, " ");
    line += "PRICE".padStart(6, " ");
    line += "TOTAL".padStart(8, " ");
    await SunmiModule.printText(line);
  }

  static async printReceipt(
    saleData: any,
    companySettings: any,
  ): Promise<boolean> {
    try {
      if (!SunmiModule) {
        const initialized = await this.init();
        if (!initialized) return false;
      }

      const symbol = companySettings.currencySymbol || "$";

      // ============ HEADER SECTION ============
      await this.doubleDivider("=");
      await SunmiModule.lineWrap(1);

      // Print logos
      await this.printLogos(companySettings);

      // Company Name - Large and Bold
      await this.center(companySettings.name || "YOUR STORE");
      await SunmiModule.lineWrap(1);

      // Address
      if (companySettings.address) {
        const addressLines = companySettings.address.split("\n");
        for (const line of addressLines) {
          if (line.trim()) {
            await this.center(line.trim());
          }
        }
      }

      // Phone
      if (companySettings.phone) {
        await this.center(`📞 ${companySettings.phone}`);
      }

      // Email
      if (companySettings.email) {
        await this.center(`📧 ${companySettings.email}`);
      }

      // GST Number
      if (companySettings.gstNo) {
        await this.center(`GST: ${companySettings.gstNo}`);
      }

      await this.doubleDivider("=");
      await SunmiModule.lineWrap(1);

      // ============ BILL DETAILS ============
      const now = new Date();
      const dateStr = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")}/${now.getFullYear()}`;
      const timeStr = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      await this.left(`INVOICE NO: ${saleData.invoiceNumber || saleData.id}`);
      if (saleData.tableNo) {
        await this.left(`TABLE NO: ${saleData.tableNo}`);
      }
      await this.left(`DATE: ${dateStr} ${timeStr}`);
      await this.left(
        `WAITER: ${saleData.waiterName || saleData.cashier || companySettings.cashierName || "Staff"}`,
      );
      await this.divider("-");

      // ============ ITEMS SECTION ============
      await this.itemHeader();
      await this.divider("-");

      // Items loop
      const printItems = (saleData.items || []).filter(
        (i: any) => i.status !== "VOIDED",
      );
      for (const item of printItems) {
        const itemName = (
          item.name ||
          item.DishName ||
          item.ProductName ||
          ""
        ).substring(0, 14);
        const qtyNum =
          parseInt(String(item.qty || item.quantity || item.Quantity || 1)) ||
          1;
        const qty = qtyNum.toString();

        const priceNum =
          parseFloat(String(item.price || item.Price || item.Cost || 0)) || 0;
        const price = `${symbol}${priceNum.toFixed(2)}`;

        const totalNum = priceNum * qtyNum;
        const total = `${symbol}${totalNum.toFixed(2)}`;

        await this.itemRow(itemName, qty, price, total);

        // Print full name if truncated
        if ((item.name || "").length > 14) {
          await this.left(`   ${item.name}`);
        }

        // ✅ Print Modifiers (Addons)
        if (item.modifiers && item.modifiers.length > 0) {
          for (const mod of item.modifiers) {
            await this.left(`    + ${mod.ModifierName || mod.name}`);
          }
        }

        // ✅ Print Item Discount
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        if (discAmt > 0) {
          const discType = item.discountType || "percentage";
          const discStr =
            discType === "percentage"
              ? `-${discAmt}%`
              : `-${symbol}${discAmt.toFixed(2)}`;
          await this.left(`    Discount: ${discStr}`);
        }
      }

      await this.divider("-");

      // ============ SUBTOTAL & DISCOUNT ============
      // Calculate item discounts and gross total
      let grossTotal = 0;
      let totalItemDiscount = 0;
      (saleData.items || []).forEach((item: any) => {
        if (item.status === "VOIDED") return;
        const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
        const baseTotal = (item.price || 0) * qtyNum;
        let itemDiscount = 0;
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        const discType = item.discountType || "percentage";
        if (discAmt > 0) {
          if (discType === "percentage") {
            itemDiscount = baseTotal * (discAmt / 100);
          } else {
            itemDiscount = discAmt * qtyNum;
          }
        }
        grossTotal += baseTotal;
        totalItemDiscount += itemDiscount;
      });

      const orderDiscount =
        parseFloat(String(saleData.discountAmount || 0)) || 0;
      const hasAnyDiscount = totalItemDiscount > 0 || orderDiscount > 0;
      let currentSubtotal = grossTotal;

      await this.twoCols("Sub Total:", `${symbol}${grossTotal.toFixed(2)}`);

      if (totalItemDiscount > 0) {
        await this.twoCols(
          "Item Discounts:",
          `-${symbol}${totalItemDiscount.toFixed(2)}`,
        );
        currentSubtotal -= totalItemDiscount;
      }

      if (orderDiscount > 0) {
        const discLabel =
          saleData.discountType === "percentage"
            ? `Discount (${saleData.discountValue}%):`
            : "Discount:";
        await this.twoCols(discLabel, `-${symbol}${orderDiscount.toFixed(2)}`);
        currentSubtotal -= orderDiscount;
      }

      if (hasAnyDiscount) {
        await this.divider("-");
        const netLabel =
          companySettings.gstPercentage > 0
            ? "Net Amt (bef GST):"
            : "Net Amount:";
        await this.twoCols(netLabel, `${symbol}${currentSubtotal.toFixed(2)}`);
      }
      await this.divider("-");

      // ============ GST ============
      let finalTotal =
        saleData.total || saleData.totalAmount || currentSubtotal;
      if (companySettings.gstPercentage > 0) {
        const gstAmount =
          currentSubtotal *
          (companySettings.gstPercentage /
            (100 + companySettings.gstPercentage));
        const beforeGst = currentSubtotal - gstAmount;
        if (!hasAnyDiscount) {
          await this.twoCols(
            "Sub Total (bef GST):",
            `${symbol}${beforeGst.toFixed(2)}`,
          );
        }
        await this.twoCols(
          `GST (${companySettings.gstPercentage}%):`,
          `${symbol}${gstAmount.toFixed(2)}`,
        );
        await this.divider("-");
      }

      // ============ ROUND OFF ============
      if (saleData.roundOff && saleData.roundOff !== 0) {
        const roLabel = saleData.roundOff > 0 ? "+Round Off:" : "Round Off:";
        await this.twoCols(roLabel, `${symbol}${saleData.roundOff.toFixed(2)}`);
        await this.divider("-");
      }

      // ============ GRAND TOTAL ============
      await this.twoCols("GRAND TOTAL:", `${symbol}${finalTotal.toFixed(2)}`);
      await this.doubleDivider("=");

      // ============ PAYMENT ============
      await this.twoCols("PAYMENT:", saleData.paymentMethod || "Cash");

      if (saleData.cashPaid && saleData.cashPaid > 0) {
        await this.twoCols("PAID:", `${symbol}${saleData.cashPaid.toFixed(2)}`);
        if (saleData.change && saleData.change > 0) {
          await this.twoCols(
            "CHANGE:",
            `${symbol}${saleData.change.toFixed(2)}`,
          );
        }
      }

      await SunmiModule.lineWrap(1);

      // ============ FOOTER ============
      await this.center("THANK YOU! COME AGAIN!");
      await SunmiModule.lineWrap(1);
      await this.center("SMART-POS BY UNIPROSG");

      if (companySettings.gstPercentage > 0) {
        await this.center(
          `* Prices include ${companySettings.gstPercentage}% GST`,
        );
      }

      await SunmiModule.lineWrap(3);
      await SunmiModule.cutPaper();

      return true;
    } catch (error) {
      console.log("❌ Print error:", error);
      return false;
    }
  }

  static async printKOT(
    data: any,
    type: "NEW" | "ADDITIONAL" | "REPRINT" = "NEW",
  ): Promise<boolean> {
    try {
      if (!SunmiModule) {
        const initialized = await this.init();
        if (!initialized) return false;
      }

      const title =
        type === "REPRINT"
          ? "REPRINT"
          : type === "ADDITIONAL"
            ? "ADDITIONAL"
            : "NEW ORDER";
      const items = data.items || [];
      const tableNo = data.tableNo || "N/A";
      const orderNo = data.orderNo || data.orderId || "N/A";
      const waiter = data.waiterName || "Staff";
      const now = new Date();
      const timestamp = `${now.getDate().toString().padStart(2, "0")}/${(now.getMonth() + 1).toString().padStart(2, "0")} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      const setSize = async (size: number) => {
        try {
          if (SunmiModule.setFontSize) await SunmiModule.setFontSize(size);
          else if (SunmiModule.setTextSize) await SunmiModule.setTextSize(size);
          else if (SunmiModule.updateFontSize)
            await SunmiModule.updateFontSize(size);
        } catch (e) {
          console.log("Font size not supported");
        }
      };

      // ============ HEADER (Large & Bold) ============
      await setSize(36);
      await this.left(title);
      await SunmiModule.lineWrap(1);

      await setSize(24);
      await this.left(timestamp);
      await SunmiModule.lineWrap(1);

      // ============ TABLE INFO (EXTREMELY LARGE) ============
      await this.doubleDivider("=");
      await setSize(48);
      await this.left(`TABLE: ${tableNo}`);
      await SunmiModule.lineWrap(1);

      await setSize(24);
      await this.left(`Order: #${orderNo}`);
      await this.left(`Waiter: ${waiter}`);
      await this.doubleDivider("=");

      // ============ ITEMS ============
      await SunmiModule.lineWrap(1);
      for (const item of items) {
        // Quantity (Big)
        await setSize(48);
        await this.left(`[${item.qty || item.quantity || 1}] `);

        // Item Name (Large)
        await setSize(36);
        await this.left(`${item.name}`);
        await SunmiModule.lineWrap(1);

        const isTw = !!(
          item.isTakeaway ||
          item.IsTakeaway ||
          item.isTakeAway ||
          item.IsTakeAway
        );
        if (isTw) {
          await setSize(28);
          await this.left(`  - Takeaway`);
          await SunmiModule.lineWrap(1);
        }

        // Modifiers (Normal)
        if (item.modifiers && item.modifiers.length > 0) {
          await setSize(24);
          for (const mod of item.modifiers) {
            await this.left(`  + ${mod.ModifierName || mod.name}`);
            await SunmiModule.lineWrap(1);
          }
        }

        const noteText =
          item.note || item.notes || item.Remarks || item.remarks;
        if (noteText) {
          await setSize(28);
          await this.left(`  * NOTE: ${noteText}`);
          await SunmiModule.lineWrap(1);
        }

        await this.divider("-");
      }

      // Reset font size at the end
      await setSize(24);

      await SunmiModule.lineWrap(3);
      await SunmiModule.cutPaper();
      return true;
    } catch (err) {
      console.log("❌ Sunmi KOT Error:", err);
      return false;
    }
  }
}

export default SunmiPrinterService;
