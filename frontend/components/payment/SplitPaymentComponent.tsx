import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Fonts } from "../../constants/Fonts";
import { Theme } from "../../constants/theme";

export type SplitPaymentRow = {
  id: string;
  payModeId: number;
  payMode: string;
  amount: string;
  referenceNo: string;
};

type PaymentMethodType = {
  payMode: string;
  description: string;
  position: number;
};

interface SplitPaymentComponentProps {
  targetTotal: number;
  paymentMethods: PaymentMethodType[];
  onComplete: (payments: Array<{ payModeId: number; amount: number; referenceNo?: string }>) => void;
  onCancel: () => void;
  processing: boolean;
  memberFlow?: boolean;
  currencySymbol?: string;
}

export default function SplitPaymentComponent({
  targetTotal,
  paymentMethods,
  onComplete,
  onCancel,
  processing,
  memberFlow = false,
  currencySymbol = "$",
}: SplitPaymentComponentProps) {
  const [rows, setRows] = useState<SplitPaymentRow[]>([]);

  // Filter payment methods: for member collections, we shouldn't allow paying with MEMBER credit
  const availableMethods = useMemo(() => {
    if (memberFlow) {
      return paymentMethods.filter(
        (m) => m.payMode.toUpperCase().trim() !== "MEMBER" && m.payMode.toUpperCase().trim() !== "CREDIT"
      );
    }
    return paymentMethods;
  }, [paymentMethods, memberFlow]);

  // Initial row with full targetTotal
  useEffect(() => {
    if (availableMethods.length > 0 && rows.length === 0) {
      setRows([
        {
          id: Math.random().toString(36).substring(7),
          payModeId: availableMethods[0].position,
          payMode: availableMethods[0].payMode,
          amount: targetTotal.toFixed(2),
          referenceNo: "",
        },
      ]);
    }
  }, [availableMethods, targetTotal]);

  // Sum of all payment rows
  const totalPaid = useMemo(() => {
    return rows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
  }, [rows]);

  // Remaining balance
  const remainingBalance = useMemo(() => {
    return Math.max(0, targetTotal - totalPaid);
  }, [targetTotal, totalPaid]);

  // Check if payments match total
  const isValid = useMemo(() => {
    const sumDiff = Math.abs(totalPaid - targetTotal);
    if (sumDiff > 0.01) return false;
    
    // Ensure no empty or negative amounts
    for (const r of rows) {
      const amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0) return false;
      if (!r.payMode) return false;
    }
    return true;
  }, [rows, totalPaid, targetTotal]);

  const handleAddRow = () => {
    if (availableMethods.length === 0) return;
    setRows([
      ...rows,
      {
        id: Math.random().toString(36).substring(7),
        payModeId: availableMethods[0].position,
        payMode: availableMethods[0].payMode,
        amount: remainingBalance > 0 ? remainingBalance.toFixed(2) : "0.00",
        referenceNo: "",
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id));
  };

  const handleUpdateRow = (id: string, updates: Partial<SplitPaymentRow>) => {
    setRows(
      rows.map((r) => {
        if (r.id === id) {
          const updated = { ...r, ...updates };
          if (updates.payMode !== undefined) {
            const method = availableMethods.find((m) => m.payMode === updates.payMode);
            if (method) {
              updated.payModeId = method.position;
            }
          }
          return updated;
        }
        return r;
      })
    );
  };

  const handlePay = () => {
    if (!isValid) return;
    const finalPayments = rows.map((r) => ({
      payModeId: r.payModeId,
      amount: parseFloat(r.amount) || 0,
      referenceNo: r.referenceNo || undefined,
    }));
    onComplete(finalPayments);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>
        {memberFlow ? "Collect Member Credit Payment" : "Split Payment Splitter"}
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {rows.map((row, idx) => (
          <View key={row.id} style={styles.rowContainer}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowLabel}>Method #{idx + 1}</Text>
              {rows.length > 1 && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleRemoveRow(row.id)}
                  style={styles.removeBtn}
                >
                  <Ionicons name="trash-outline" size={16} color={Theme.danger} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inputsRow}>
              {/* Payment Mode Selector */}
              <View style={styles.pickerContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeChips}>
                  {availableMethods.map((m) => {
                    const isSelected = row.payMode === m.payMode;
                    return (
                      <TouchableOpacity
                        key={m.payMode}
                        activeOpacity={0.8}
                        onPress={() => handleUpdateRow(row.id, { payMode: m.payMode })}
                        style={[
                          styles.modeChip,
                          isSelected && styles.modeChipSelected,
                        ]}
                      >
                        <Text style={[styles.modeChipText, isSelected && styles.modeChipTextSelected]}>
                          {m.description.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Amount Input */}
              <View style={styles.amountInputWrapper}>
                <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                <TextInput
                  style={styles.amountInput}
                  keyboardType="numeric"
                  value={row.amount}
                  onChangeText={(val) => handleUpdateRow(row.id, { amount: val })}
                  placeholder="0.00"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>
            </View>

            {/* Optional Reference Number for non-cash payments */}
            {row.payMode.toUpperCase().trim() !== "CASH" && row.payMode.toUpperCase().trim() !== "CAS" && (
              <TextInput
                style={styles.refInput}
                placeholder="Reference / Transaction Number (Optional)"
                placeholderTextColor={Theme.textMuted}
                value={row.referenceNo}
                onChangeText={(val) => handleUpdateRow(row.id, { referenceNo: val })}
              />
            )}
          </View>
        ))}

        {/* Add Payment Method Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleAddRow}
          style={styles.addMethodBtn}
        >
          <Ionicons name="add-circle-outline" size={20} color={Theme.primary} />
          <Text style={styles.addMethodBtnText}>Add Payment Method</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bill & Payment Status Board */}
      <View style={styles.summaryBoard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Bill</Text>
          <Text style={styles.summaryValue}>{currencySymbol}{targetTotal.toFixed(2)}</Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Paid</Text>
          <Text style={[styles.summaryValue, { color: Theme.success }]}>
            {currencySymbol}{totalPaid.toFixed(2)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Remaining Balance</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: remainingBalance > 0 ? Theme.danger : Theme.success, fontFamily: Fonts.black },
            ]}
          >
            {currencySymbol}{remainingBalance.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onCancel}
          style={styles.cancelBtn}
          disabled={processing}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePay}
          style={[styles.payBtn, !isValid && styles.payBtnDisabled]}
          disabled={!isValid || processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.payBtnText}>
              {memberFlow ? "Submit Payment" : "Complete Payment"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 16,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 20,
  },
  rowContainer: {
    backgroundColor: Theme.bgInput + "40",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  rowLabel: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    letterSpacing: 0.5,
  },
  removeBtn: {
    padding: 4,
  },
  inputsRow: {
    gap: 12,
  },
  pickerContainer: {
    height: 42,
  },
  modeChips: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  modeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Theme.bgInput,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modeChipSelected: {
    backgroundColor: Theme.primary + "15",
    borderColor: Theme.primary,
  },
  modeChipText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  modeChipTextSelected: {
    color: Theme.primary,
    fontFamily: Fonts.black,
  },
  amountInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgInput,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 16,
    height: 56,
  },
  currencyPrefix: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginRight: 6,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  refInput: {
    marginTop: 12,
    height: 48,
    backgroundColor: Theme.bgInput,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  addMethodBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.primary,
    borderStyle: "dashed",
    marginTop: 8,
  },
  addMethodBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  summaryBoard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 8,
    marginTop: 16,
    marginBottom: 16,
    ...Theme.shadowSm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  summaryValue: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    backgroundColor: Theme.bgInput,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  payBtn: {
    flex: 2,
    height: 56,
    borderRadius: 14,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  payBtnDisabled: {
    backgroundColor: Theme.border,
    opacity: 0.6,
  },
  payBtnText: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: "#fff",
  },
});
