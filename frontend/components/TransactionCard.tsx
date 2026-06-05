import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";

interface TransactionCardProps {
  item: any;
  onPress: (item: any) => void;
  formatOrderId: (order: any) => string;
  formatCurrency: (amount: number) => string;
}

const TransactionCard = React.memo(
  ({ item, onPress, formatOrderId, formatCurrency }: TransactionCardProps) => {
    const { width: SCREEN_W } = useWindowDimensions();
    const settlementDate = new Date(item.SettlementDate);

    const modeUpper = String(item.PayMode || "").toUpperCase();
    const isUpi = modeUpper.includes("UPI") || modeUpper.includes("GPAY");
    const isPayNow = modeUpper.includes("PAYNOW");
    const isNets = modeUpper.includes("NETS");

    return (
      <TouchableOpacity
        onPress={() => onPress(item)}
        style={[
          styles.transactionCard,
          (item.DiscountAmount > 0 || (item.TotalDiscountAmount && item.TotalDiscountAmount > 0) || (item.TotalLineItemDiscountAmount && item.TotalLineItemDiscountAmount > 0)) && {
            borderColor: Theme.success,
            borderWidth: 1.2,
            backgroundColor: Theme.successBg,
          },
          (item.VoidAmount > 0 || item.IsCancelled) && {
            borderColor: Theme.danger,
            borderWidth: 1.2,
            backgroundColor: Theme.dangerBg,
          },
        ]}
      >
        <View style={styles.txIconWrap}>
          <Ionicons
            name={
              item.PayMode === "CASH"
                ? "cash-outline"
                : item.PayMode === "MEMBER"
                ? "person-outline"
                : item.PayMode === "CREDIT"
                ? "pricetag-outline"
                : isUpi
                ? "flash-outline"
                : isPayNow
                ? "qr-code-outline"
                : isNets
                ? "grid-outline"
                : "card-outline"
            }
            size={16}
            color={
              item.PayMode === "CASH"
                ? "#22c55e"
                : item.PayMode === "MEMBER"
                ? "#ec4899"
                : item.PayMode === "CREDIT"
                ? "#e11d48"
                : isUpi
                ? "#a855f7"
                : isPayNow
                ? "#f97316"
                : isNets
                ? "#3b82f6"
                : "#818cf8"
            }
          />
        </View>
        <View style={styles.txOrderInfo}>
          <Text style={styles.txTitle} numberOfLines={1}>
            {item.OrderType === "LEDGER" 
              ? `Member Payment Collected: ${item.Section || 'Member'}`
              : (SCREEN_W < 450 ? `#${formatOrderId(item).split("-").pop()}` : `Order #${formatOrderId(item)}`)}
          </Text>
          <Text style={styles.txSmall} numberOfLines={1}>
            {item.OrderType === "LEDGER"
              ? `${
                  item.PayMode === "CASH"
                    ? "💵"
                    : item.PayMode === "MEMBER"
                    ? "👤"
                    : item.PayMode === "CREDIT"
                    ? "🏷️"
                    : isUpi
                    ? "⚡"
                    : isPayNow
                    ? "📱"
                    : isNets
                    ? "🔳"
                    : "💳"
                } Member Account Settlement`
              : `${item.OrderType === "TAKEAWAY" ? "🛍️ Takeaway" : `🪑 Table ${item.TableNo || "N/A"}`} • ${
                  item.PayMode === "CASH"
                    ? "Cash"
                    : item.PayMode === "MEMBER"
                    ? "Member"
                    : item.PayMode === "CREDIT"
                    ? "Credit"
                    : isUpi
                    ? "UPI"
                    : isPayNow
                    ? "PayNow"
                    : isNets
                    ? "NETS"
                    : item.PayMode || "Other"
                }`}
            {item.SER_NAME && item.OrderType !== "LEDGER" ? ` • ${item.SER_NAME}` : ""}
          </Text>
          {(item.isMerged || item.isSplit) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {item.isMerged && (
                <View style={styles.mergedBadge}>
                  <Ionicons name="git-merge-outline" size={9} color="#ea580c" />
                  <Text style={styles.mergedBadgeText}>Merged</Text>
                </View>
              )}
              {item.isSplit && (
                <View style={styles.splitBadge}>
                  <Ionicons name="cut-outline" size={9} color="#2563eb" />
                  <Text style={styles.splitBadgeText}>Split: {item.splitNo || 'Yes'}</Text>
                </View>
              )}
            </View>
          )}
        </View>
        <View style={styles.txRightInfo}>
          <Text style={[styles.txAmount, item.IsCancelled && { color: Theme.danger, textDecorationLine: 'line-through' }]}>
            {formatCurrency(item.SysAmount || 0)}
          </Text>
          <Text style={styles.txDatetime}>
            {settlementDate.toLocaleDateString([], { day: 'numeric', month: 'short' })} • {settlementDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <View style={styles.paidIndicator}>
           <Ionicons name="checkmark-circle" size={16} color={Theme.success} />
        </View>
      </TouchableOpacity>
    );
  },
);

const styles = StyleSheet.create({
  transactionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgCard,
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  txIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  txOrderInfo: { flex: 1, marginRight: 8 },
  txTitle: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
  },
  txSmall: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    marginTop: 2,
  },
  txDatetime: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    marginTop: 2,
  },
  txRightInfo: { alignItems: "flex-end", marginRight: 10 },
  txAmount: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  paidIndicator: {
    justifyContent: "center",
    alignItems: "center",
  },
  voidTag: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Theme.danger + "30",
  },
  voidTagText: {
    color: Theme.danger,
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  paidBadgeSmall: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Theme.success + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  cancelledBadge: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.danger + "30",
    alignItems: 'center',
  },
  cancelledBadgeText: {
    color: Theme.danger,
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  cancelledReason: {
    color: Theme.danger,
    fontSize: 10,
    fontFamily: Fonts.bold,
    marginTop: 2,
    fontStyle: 'italic',
  },
  mergedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  mergedBadgeText: {
    color: '#ea580c',
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  splitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  splitBadgeText: {
    color: '#2563eb',
    fontSize: 9,
    fontFamily: Fonts.black,
  },
});

export default TransactionCard;
