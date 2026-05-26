import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  Image,
  Alert,
  Modal,
} from "react-native";
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from "react-native-safe-area-context";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useToast } from "../components/Toast";
import { API_URL } from "@/constants/Config";

import {
  findActiveOrder,
  useActiveOrdersStore,
} from "../stores/activeOrdersStore";
import {
  clearCart,
  useCartStore,
} from "../stores/cartStore";
import { CustomerDisplaySync } from "../utils/CustomerDisplaySync";
import { useTableStatusStore } from "../stores/tableStatusStore";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { usePaymentSettingsStore } from "../stores/paymentSettingsStore";
import { useAuthStore } from "../stores/authStore";
import { useOrderContextStore } from "../stores/orderContextStore";
import UPIPaymentModal from "../components/payment/UPIPaymentModal";

const EMPTY_ARRAY: any[] = [];
import PayNowPaymentModal from "../components/payment/PayNowPaymentModal";

const formatSection = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY") return "Takeaway";
  return sec.replace("_", "-").replace("SECTION", "Section");
};

type PaymentMethod = {
  payMode: string;
  description: string;
  icon: string;
  commission: number;
  serviceCharge: number;
  isEntertainment: boolean;
  isVoucher: boolean;
  position: number;
};

const PAYMODE_ICON_MAP: Record<string, string> = {
  CAS:        "money-bill-wave",
  CASH:       "money-bill-wave",
  NETS:       "exchange-alt",
  AMEX:       "cc-amex",
  MASTER:     "cc-mastercard",
  VISA:       "cc-visa",
  PAYNOW:     "qrcode",
  GRAB:       "mobile-alt",
  FOODPANDA:  "mobile-alt",
  DINERS:     "credit-card",
  CHQ:        "university",
  LEDGER:     "book",
  VOUCHER:    "ticket-alt",
  DEAL:       "ticket-alt",
  UPI:        "mobile-alt",
  GPAY:       "google-pay",
};

function getPaymodeIcon(payMode: string): string {
  const key = payMode.toUpperCase().replace(/[^A-Z]/g, "");
  if (PAYMODE_ICON_MAP[key]) return PAYMODE_ICON_MAP[key];
  for (const [k, v] of Object.entries(PAYMODE_ICON_MAP)) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return "credit-card";
}

const isCashMethod = (payMode: string) => /^(CAS|CASH)$/i.test(payMode.trim());

export default function PaymentScreen() {
  const pathname = usePathname();
  const isFocused = useIsFocused() && pathname === "/payment";
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;
  const closeActiveOrder = useActiveOrdersStore((s) => s.closeActiveOrder);
  const clearTable = useTableStatusStore((s) => s.clearTable);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { showToast } = useToast();
  const { width, height } = useWindowDimensions();

  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= 500;
  const isMobile = !isTablet;
  const showOrderPanel = (isTablet && (isLandscape || width >= 1024)) || (isMobile && isLandscape);

  const context = useOrderContextStore((s) => s.currentOrder);
  const hasHydrated = useActiveOrdersStore((s) => s._hasHydrated);
  const activeOrder = context ? findActiveOrder(context) : undefined;

  const currentContextId = useCartStore((s: any) => s.currentContextId);
  const cart = useCartStore((s: any) => (currentContextId ? s.carts[currentContextId] : undefined) || EMPTY_ARRAY);
  
  const currentTableOrderId = useCartStore((s: any) => context?.tableId ? s.tableOrderIds[context.tableId] : undefined);
  const displayOrderId = currentTableOrderId || activeOrder?.orderId;

  const discount = useCartStore((s: any) => (s.currentContextId ? s.discounts[s.currentContextId] : null));

  const [method, setMethod] = useState("CAS");
  const [cashInput, setCashInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [time, setTime] = useState(new Date());

  const { useLocalSearchParams } = require("expo-router");
  const localParams = useLocalSearchParams();
  const splitItems = useMemo(() => {
    if (!localParams.splitItems) return null;
    try { return JSON.parse(localParams.splitItems as string); } catch { return null; }
  }, [localParams.splitItems]);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<PaymentMethod | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isUPIVisible, setIsUPIVisible] = useState(false);
  const [isPayNowVisible, setIsPayNowVisible] = useState(false);
  const settingsStore = useCompanySettingsStore((state) => state.settings);
  const currencySymbol = settingsStore.currencySymbol || "$";
  const gstRate = (settingsStore.gstPercentage || 0) / 100;
  const [roundOff, setRoundOff] = useState(0);
  const [roundType, setRoundType] = useState<"whole" | "five" | "ten" | "custom" | null>(null);
  const [isAdjustmentModalVisible, setIsAdjustmentModalVisible] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [isTestModalVisible, setIsTestModalVisible] = useState(false);

  const finalItems = useMemo(() => {
    return splitItems || cart;
  }, [splitItems, cart]);

  useEffect(() => {
    const init = async () => {
      await usePaymentSettingsStore.getState().fetchSettings();
      await fetchPaymentMethods();
      if (context?.tableId) {
        try {
          const res = await fetch(`${API_URL}/api/tables/${context.tableId}`);
          const data = await res.json();
          if (data.success && data.table?.CurrentOrderId) {
             useCartStore.getState().setTableOrderId(context.tableId, data.table.CurrentOrderId);
          }
        } catch (err) {
          console.error("Failed to sync official Order ID:", err);
        }
      }
    };
    init();
  }, []);

  // 🖥️ CUSTOMER DISPLAY REAL-TIME SYNC
  useEffect(() => {
    if (!isFocused) {
      if (pathname === "/payment_success") {
        return;
      }
      CustomerDisplaySync.syncIdle();
      return;
    }

    if (context && finalItems.length > 0) {
      CustomerDisplaySync.syncCart({
        orderContext: context,
        cart: finalItems,
        discountInfo: discount,
        gstPercentage: settingsStore.gstPercentage || 0,
        roundOff: roundOff,
        active: true,
        orderId: displayOrderId,
        paymentMethod: method
      });
    } else {
      CustomerDisplaySync.syncIdle();
    }
    return () => {
      if (pathnameRef.current !== "/payment_success") {
        CustomerDisplaySync.syncIdle();
      }
    };
  }, [isFocused, pathname, context, finalItems, discount, settingsStore.gstPercentage, roundOff, displayOrderId, method]);

  const fetchPaymentMethods = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sales/payment-methods`);
      const data: any[] = await res.json();
      const mapped: PaymentMethod[] = data.map((d) => ({
        payMode: d.payMode || "",
        description: d.description || d.payMode || "",
        icon: getPaymodeIcon(d.payMode || ""),
        commission: parseFloat(d.Commission) || 0,
        serviceCharge: parseFloat(d.ServiceCharge) || 0,
        isEntertainment: d.isEntertainment === 1 || d.isEntertainment === true,
        isVoucher: d.isVoucher === 1 || d.isVoucher === true,
        position: d.Position || 0,
      }));

      const seen = new Set<string>();
      const deduped = mapped.filter((m) => {
        const key = isCashMethod(m.payMode) ? "__CASH__" : m.payMode.toUpperCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const { settings } = usePaymentSettingsStore.getState();
      const hasUPI = settings.upiId && settings.upiId.trim().length > 0;
      const hasPayNow = settings.payNowQrUrl && settings.payNowQrUrl.trim().length > 0;

      const filtered = deduped.filter(m => {
        const mUpper = m.payMode.toUpperCase().trim();
        const isUPI = mUpper.includes("UPI") || mUpper.includes("GPAY") || mUpper.includes("PHONE") || mUpper.includes("PAYTM");
        const isPayNow = mUpper.includes("PAYNOW") || mUpper.includes("QR") || mUpper.includes("PAY-NOW");
        if (isUPI && !hasUPI) return false;
        if (isPayNow && !hasPayNow) return false;
        return true;
      });

      setPaymentMethods(filtered);
      if (filtered.length > 0) {
        setMethod(filtered[0].payMode);
        fetchPaymentDetail(filtered[0].payMode, filtered[0]);
      }
    } catch {
      setPaymentMethods([{ payMode: "CAS", description: "CASH", icon: "money-bill-wave", commission: 0, serviceCharge: 0, isEntertainment: false, isVoucher: false, position: 1 }]);
    } finally {
      setLoadingMethods(false);
    }
  };

  const fetchPaymentDetail = async (payMode: string, fallback?: PaymentMethod) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_URL}/api/sales/payment-detail/${encodeURIComponent(payMode)}`);
      const d = await res.json();
      setSelectedDetail({
        payMode: d.payMode || payMode,
        description: d.description || payMode,
        icon: getPaymodeIcon(d.payMode || payMode),
        commission: parseFloat(d.commission) || 0,
        serviceCharge: parseFloat(d.serviceCharge) || 0,
        isEntertainment: d.isEntertainment === 1 || d.isEntertainment === true,
        isVoucher: d.isVoucher === 1 || d.isVoucher === true,
        position: d.position || 0,
      });
    } catch {
      setSelectedDetail(fallback || null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSelectMethod = (m: PaymentMethod) => {
    setMethod(m.payMode);
    if (!isCashMethod(m.payMode)) {
      setRoundOff(0);
      setRoundType(null);
    }
    fetchPaymentDetail(m.payMode, m);
  };

  const { subtotal, grossTotal: payGrossTotal, totalItemDiscount: payItemDiscount } = useMemo(() => {
    const nonVoided = finalItems.filter((i: any) => i.status !== "VOIDED");
    return nonVoided.reduce((acc: any, item: any) => {
      const baseTotal = (item.price || 0) * (item.qty || 0);
      let itemDiscount = 0;
      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
      const discType = item.discountType || 'percentage';
      if (discAmt > 0) {
        if (discType === 'percentage') {
          itemDiscount = baseTotal * (discAmt / 100);
        } else {
          itemDiscount = discAmt * (item.qty || 0);
        }
      }
      return {
        grossTotal: acc.grossTotal + baseTotal,
        totalItemDiscount: acc.totalItemDiscount + itemDiscount,
        subtotal: acc.subtotal + (baseTotal - itemDiscount),
      };
    }, { grossTotal: 0, totalItemDiscount: 0, subtotal: 0 });
  }, [finalItems]);

  const discountAmount = useMemo(() => {
    if (!discount?.applied) return 0;
    if (discount.type === "percentage") return (subtotal * discount.value) / 100;
    return splitItems ? 0 : discount.value;
  }, [discount, subtotal, splitItems]);

  const tax = subtotal * gstRate;
  const baseTotal = subtotal - discountAmount + tax;

  useEffect(() => {
    if (!isCashMethod(method)) {
      setRoundOff(0);
      setRoundType(null);
      return;
    }
    if (roundType === "whole") setRoundOff(Math.round(baseTotal) - baseTotal);
    else if (roundType === "five") setRoundOff(Math.round(baseTotal * 20) / 20 - baseTotal);
    else if (roundType === "ten") setRoundOff(Math.round(baseTotal * 10) / 10 - baseTotal);
  }, [baseTotal, roundType, method]);

  const total = Math.max(0, baseTotal + roundOff);
  const paidNum = isCashMethod(method) ? (parseFloat(cashInput) || 0) : total;
  const change = Math.max(0, paidNum - total);
  const quickCash = [20, 50, 100, 200, 500, 1000];

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const confirmPayment = async () => {
    if (processing) return;
    if (total > 0 && isCashMethod(method) && (paidNum < total && Math.abs(paidNum - total) > 0.01)) {
      showToast({ type: "warning", message: "Insufficient Payment", subtitle: `Please enter at least ${currencySymbol}${total.toFixed(2)}` });
      return;
    }
    const { settings } = usePaymentSettingsStore.getState();
    const mUpper = method.trim().toUpperCase();
    if (mUpper.includes("UPI") && settings.upiId) { setIsUPIVisible(true); return; }
    if (mUpper.includes("PAYNOW") && settings.payNowQrUrl) { setIsPayNowVisible(true); return; }
    executeFinalPayment();
  };

  const executeFinalPayment = async (m?: string) => {
    setProcessing(true);
    const saleData = {
      orderId: displayOrderId || activeOrder?.orderId,
      orderType: context?.orderType === "DINE_IN" ? "DINE-IN" : context?.orderType || "DINE-IN",
      tableNo: context?.orderType === "TAKEAWAY" ? context?.takeawayNo : context?.tableNo,
      section: context?.section,
      items: finalItems.map((item: any) => ({ lineItemId: item.lineItemId, dishId: item.id, name: item.name, qty: item.qty, price: item.price, status: item.status, discountAmount: item.discountAmount ?? item.discount ?? null, discountType: item.discountType ?? null })),
      subTotal: subtotal,
      taxAmount: tax,
      discountAmount: discountAmount + payItemDiscount,
      discountType: discount?.type || "fixed",
      totalAmount: total,
      paymentMethod: method.trim(),
      roundOff: roundOff,
      cashierId: user?.userId,
      tableId: context?.tableId,
      serverId: context?.serverId,
      serverName: context?.serverName,
      isSplit: !!splitItems,
      splitItems: splitItems
    };

    try {
      const response = await fetch(`${API_URL}/api/sales/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saleData)
      });
      const result = await response.json();
      if (result.success) {
        setTimeout(() => {
          router.push({
            pathname: "/payment_success" as any,
            params: {
              total: total.toFixed(2),
              paidNum: paidNum.toFixed(2),
              change: change.toFixed(2),
              method,
              orderId: result.billNo || result.orderId || displayOrderId || "",
              tableNo: context?.tableNo ?? "",
              section: context?.section ?? "",
              orderType: context?.orderType ?? "",
              discountInfo: JSON.stringify(
                discount?.applied && discountAmount > 0
                  ? { ...discount, amount: discountAmount, subtotal }
                  : {}
              ),
              items: JSON.stringify(finalItems || []),
              roundOff: roundOff.toFixed(2),
              isSplit: splitItems ? "true" : "false",
              waiterName: context?.serverName ?? "",
            },
          });
          if (context) {
            if (splitItems) {
              const { carts, currentContextId, setCartItems } = useCartStore.getState();
              if (currentContextId) {
                const updated = (carts[currentContextId] || []).map(o => {
                  const s = splitItems.find((si: any) => si.lineItemId === o.lineItemId);
                  return s ? { ...o, qty: o.qty - s.qty } : o;
                }).filter(i => i.qty > 0);
                setCartItems(currentContextId, updated);
              }
              // Do not clean table context if items remain. 
              // If empty, backend socket handles cleanup automatically.
            } else {
              if (context.orderType === "DINE_IN") {
                  clearTable(context.section!, context.tableNo!);
              }
              
              if (context.tableId) {
                useCartStore.getState().clearTableSession(context.tableId);
                closeActiveOrder(displayOrderId || "");
              }
              
              useOrderContextStore.getState().clearOrderContext();
            }
          }
        }, 100);
      } else {
        showToast({ type: "error", message: "Failed", subtitle: result.error });
      }
    } catch (e: any) {
      showToast({ type: "error", message: "Error", subtitle: e.message });
    } finally {
      setProcessing(false);
    }
  };

  const getDisplayUrl = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.location.origin + '/customer-display';
    }
    if (API_URL && API_URL.startsWith('http')) {
      const match = API_URL.match(/^https?:\/\/([^:/]+)/);
      if (match && match[1]) {
        const host = match[1];
        if (host.includes('railway') || host.includes('production')) {
          return 'http://localhost:8081/customer-display';
        }
        return `http://${host}:8081/customer-display`;
      }
    }
    return 'http://localhost:8081/customer-display';
  };

  const openCustomerDisplay = () => {
    const url = getDisplayUrl();
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      const { Linking } = require('react-native');
      Linking.openURL(url).catch((err: any) => {
        Alert.alert("Error", "Could not open browser: " + err.message);
      });
    }
  };

  const triggerTestSync = (type: 'current' | 'large_mock' | 'success' | 'idle') => {
    if (type === 'current') {
      if (context && finalItems.length > 0) {
        CustomerDisplaySync.syncCart({
          orderContext: context,
          cart: finalItems,
          discountInfo: discount,
          gstPercentage: settingsStore.gstPercentage || 0,
          roundOff: roundOff,
          active: true,
          orderId: displayOrderId,
          paymentMethod: method
        });
        showToast({ type: "info", message: "Synced Current Cart", subtitle: "Sent checkout state to customer display" });
      } else {
        showToast({ type: "warning", message: "Cart is Empty", subtitle: "Cannot sync empty cart to checkout" });
      }
    } else if (type === 'large_mock') {
      const mockItems = [
        { id: "m1", name: "Premium Wagyu Beef Burger", qty: 2, price: 18.90, status: "SERVED", discountAmount: 10, discountType: "percentage" },
        { id: "m2", name: "Truffle Parmesan Fries", qty: 1, price: 8.50, status: "SERVED" },
        { id: "m3", name: "Classic Caesar Salad", qty: 1, price: 12.00, status: "SERVED", discountAmount: 2, discountType: "fixed" },
        { id: "m4", name: "Craft IPA Beer Pint", qty: 3, price: 14.50, status: "SERVED" },
        { id: "m5", name: "Salted Caramel Milkshake", qty: 1, price: 7.90, status: "SERVED" },
        { id: "m6", name: "New York Cheesecake", qty: 2, price: 9.00, status: "SERVED" },
        { id: "m7", name: "Espresso Macchiato", qty: 1, price: 4.50, status: "SERVED" },
        { id: "m8", name: "Sparkling Mineral Water", qty: 2, price: 3.50, status: "SERVED" },
      ];
      CustomerDisplaySync.syncCart({
        orderContext: {
          tableNo: "T12",
          orderType: "DINE_IN",
          section: "Main Dining",
          serverName: "Alex"
        },
        cart: mockItems,
        discountInfo: { applied: true, type: "percentage", value: 10, label: "10% Grand Opening" },
        gstPercentage: settingsStore.gstPercentage || 9,
        roundOff: 0.05,
        active: true,
        orderId: "MOCK-889"
      });
      showToast({ type: "info", message: "Synced Mock Large Cart", subtitle: "Sent mock checkout state to customer display" });
    } else if (type === 'success') {
      CustomerDisplaySync.syncPaymentSuccess({
        orderId: "BILL-2026-987",
        total: 125.80,
        paid: 150.00,
        change: 24.20,
        method: "CASH"
      });
      showToast({ type: "info", message: "Synced Payment Success", subtitle: "Sent payment success state to customer display" });
    } else if (type === 'idle') {
      CustomerDisplaySync.syncIdle();
      showToast({ type: "info", message: "Synced Idle State", subtitle: "Customer display set to idle attract loop" });
    }
    setIsTestModalVisible(false);
  };

  const renderTestDisplayModal = () => (
    <Modal visible={isTestModalVisible} transparent animationType="fade" onRequestClose={() => setIsTestModalVisible(false)}>
      <TouchableWithoutFeedback onPress={() => setIsTestModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.adjustModalContent, { maxHeight: '90%' }]}>
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>Customer Display Tester</Text>
                <TouchableOpacity onPress={() => setIsTestModalVisible(false)}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
                <Text style={{ fontSize: 13, color: Theme.textSecondary, fontFamily: Fonts.medium, marginBottom: 16 }}>
                  Simulate different screens on the customer display to test responsiveness, scrolling, and layouts.
                </Text>
                <View style={styles.adjustPresets}>
                  <TouchableOpacity 
                    style={styles.presetItem} 
                    onPress={() => triggerTestSync('current')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="cart-outline" size={20} color={Theme.primary} />
                      <View>
                        <Text style={styles.presetLabel}>Sync Current Cart</Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>Send active bill detail</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Theme.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.presetItem} 
                    onPress={() => triggerTestSync('large_mock')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="list-outline" size={20} color={Theme.primary} />
                      <View>
                        <Text style={styles.presetLabel}>Sync Mock Large Cart</Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>Test list scrolling & totals</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Theme.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.presetItem} 
                    onPress={() => triggerTestSync('success')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="checkmark-done-circle-outline" size={20} color={Theme.success || "#10B981"} />
                      <View>
                        <Text style={styles.presetLabel}>Sync Payment Success</Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>Test thank you & QR code</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Theme.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.presetItem} 
                    onPress={() => triggerTestSync('idle')}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="images-outline" size={20} color={Theme.warning || "#F59E0B"} />
                      <View>
                        <Text style={styles.presetLabel}>Reset to Idle State</Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>Test attract animation loop</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Theme.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.separator} />
                
                <View style={styles.linkSection}>
                  <Text style={styles.linkTitle}>Test on Another Device</Text>
                  <Text style={styles.linkSub}>Scan this QR code with your phone/tablet on the same Wi-Fi, or click the button below to view the customer screen.</Text>
                  
                  <View style={styles.qrContainer}>
                    <QRCode
                      value={getDisplayUrl()}
                      size={120}
                      color={Theme.textPrimary}
                      backgroundColor="#fff"
                    />
                  </View>
                  
                  <Text style={styles.urlText} selectable>{getDisplayUrl()}</Text>
                  
                  <TouchableOpacity style={styles.openBtn} onPress={openCustomerDisplay} activeOpacity={0.7}>
                    <Ionicons name="open-outline" size={16} color="#fff" />
                    <Text style={styles.openBtnText}>Open Customer Display</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  const renderAdjustmentModal = () => (
    <Modal visible={isAdjustmentModalVisible} transparent animationType="fade" onRequestClose={() => setIsAdjustmentModalVisible(false)}>
      <TouchableWithoutFeedback onPress={() => setIsAdjustmentModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.adjustModalContent}>
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>Bill Adjustment</Text>
                <TouchableOpacity onPress={() => setIsAdjustmentModalVisible(false)}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={styles.adjustPresets}>
                {[
                  { label: "Singapore Standard", value: "Nearest .05", mode: "five" as const, target: Math.round(baseTotal * 20) / 20 },
                  { label: "Quick Round", value: "Nearest .10", mode: "ten" as const, target: Math.round(baseTotal * 10) / 10 },
                  { label: "Premium Nett", value: "Whole Dollar", mode: "whole" as const, target: Math.round(baseTotal) }
                ].map((p) => (
                  <TouchableOpacity key={p.mode} style={styles.presetItem} onPress={() => { setRoundOff(p.target - baseTotal); setRoundType(p.mode); if (method === "CAS") setCashInput(p.target.toFixed(2)); setIsAdjustmentModalVisible(false); }}>
                    <Text style={styles.presetLabel}>{p.label}</Text>
                    <Text style={styles.presetValue}>{p.value}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.customInputSection}>
                <Text style={styles.inputLabel}>Custom Adjustment Amount</Text>
                <View style={styles.customInputRow}>
                  <TextInput style={styles.adjustTextInput} placeholder="0.00" keyboardType="numeric" value={customValue} onChangeText={setCustomValue} />
                  <TouchableOpacity style={styles.applyBtn} onPress={() => { const n = parseFloat(customValue); if (!isNaN(n)) { setRoundOff(n); setRoundType("custom"); if (method === "CAS") setCashInput((baseTotal + n).toFixed(2)); setIsAdjustmentModalVisible(false); } }}>
                    <Text style={styles.applyBtnText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity style={styles.resetBtnFull} onPress={() => { setRoundOff(0); setRoundType(null); if (method === "CAS") setCashInput(baseTotal.toFixed(2)); setIsAdjustmentModalVisible(false); }}>
                <Text style={styles.resetBtnText}>Reset to Original Bill</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.itemRow}>
      <Text style={styles.itemQty}>{item.qty}x</Text>
      <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.itemPrice}>${(item.price * item.qty).toFixed(2)}</Text>
    </View>
  );

  if (!context) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.orderInfo}>
            <Text style={styles.orderTitle}>Checkout</Text>
            <View style={styles.orderBadgeRow}>
              <View style={[styles.typeBadge, { backgroundColor: context!.orderType === 'DINE_IN' ? Theme.primaryLight : Theme.warningBg }]}>
                <Text style={[styles.typeBadgeText, { color: context!.orderType === 'DINE_IN' ? Theme.primary : Theme.warning }]}>
                  {context!.orderType === 'DINE_IN' ? 'DINE-IN' : 'TAKEAWAY'}
                </Text>
              </View>
              {context!.orderType === 'DINE_IN' && (
                <View style={styles.tableBadge}>
                   <Text style={styles.tableBadgeText}>{formatSection(context!.section || "")} • T{context!.tableNo}</Text>
                </View>
              )}
              <Text style={styles.orderSub}>#{displayOrderId || "NEW"}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity 
              style={[styles.backBtn, { borderColor: Theme.primaryBorder }]} 
              onPress={openCustomerDisplay}
              activeOpacity={0.7}
            >
              <Ionicons name="open-outline" size={20} color={Theme.primary} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.backBtn, { borderColor: Theme.primaryBorder }]} 
              onPress={() => setIsTestModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="desktop-outline" size={20} color={Theme.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[styles.mainLayout, isLandscape && { flexDirection: "row" }]}>
                <View style={[styles.leftPane, isLandscape && { flex: 1.2, paddingRight: 20 }]}>
                  {/* Summary for Mobile */}
                  {!showOrderPanel && (
                    <View style={styles.mobileSummaryCard}>
                      <View style={styles.mobileSummaryRow}>
                        <View>
                          <Text style={styles.mobileSummaryLabel}>AMOUNT DUE</Text>
                          <Text style={styles.mobileSummaryTotal}>{currencySymbol}{total.toFixed(2)}</Text>
                        </View>
                        {isCashMethod(method) && (
                          <TouchableOpacity style={styles.mobileAdjustBtn} onPress={() => setIsAdjustmentModalVisible(true)}>
                            <Ionicons name="options-outline" size={20} color={Theme.primary} />
                            <Text style={styles.mobileAdjustText}>Adjust</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {(discount?.applied || discountAmount > 0) && (
                        <View style={[styles.mobileSummaryRow, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Theme.border + '40' }]}>
                          <Text style={[styles.mobileSummaryLabel, { color: Theme.danger }]}>DISCOUNT</Text>
                          <Text style={[styles.mobileSummaryTotal, { fontSize: 18, color: Theme.danger }]}>
                            -{currencySymbol}{discountAmount.toFixed(2)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Select Payment Method</Text></View>
                  {loadingMethods ? (
                    <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator size="large" color={Theme.primary} />
                      <Text style={{ marginTop: 8, fontSize: 13, fontFamily: Fonts.medium, color: Theme.textSecondary }}>Loading methods...</Text>
                    </View>
                  ) : (
                    <View style={styles.methodsGrid}>
                      {paymentMethods.map((m) => (
                        <TouchableOpacity key={m.payMode} style={[styles.methodCard, method === m.payMode && styles.activeMethodCard, isMobile && { width: '30%', height: 75 }]} onPress={() => handleSelectMethod(m)}>
                          <View style={[styles.methodIconBox, method === m.payMode && styles.activeIconBox, isMobile && { width: 30, height: 30 }]}>
                            <FontAwesome5 name={m.icon} size={isMobile ? 16 : 20} color={method === m.payMode ? "#fff" : Theme.primary} />
                          </View>
                          <Text style={[styles.methodLabel, method === m.payMode && styles.activeMethodLabel, isMobile && { fontSize: 10 }]}>{m.description}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {isCashMethod(method) && (
                    <View style={styles.cashSection}>
                      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Cash Received</Text></View>
                      <View style={styles.cashInputBox}>
                        <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                        <TextInput style={styles.cashInput} value={cashInput} onChangeText={setCashInput} keyboardType="numeric" placeholder="0.00" />
                      </View>
                      <View style={styles.quickCashContainer}>
                        {quickCash.map((v) => {
                          const isSelected = parseFloat(cashInput) === v;
                          return (
                            <TouchableOpacity 
                              key={v} 
                              style={[styles.quickCashBtn, isSelected && styles.activeQuickCashBtn]} 
                              onPress={() => setCashInput(v.toString())}
                            >
                              <Text style={[styles.quickCashText, isSelected && styles.activeQuickCashText]}>
                                {currencySymbol}{v}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                        {(() => {
                          const isExact = Math.abs(parseFloat(cashInput) - total) < 0.01;
                          return (
                            <TouchableOpacity 
                              style={[styles.quickCashBtn, isExact && styles.activeQuickCashBtn]} 
                              onPress={() => setCashInput(total.toFixed(2))}
                            >
                              <Text style={[styles.quickCashText, isExact && styles.activeQuickCashText]}>Exact</Text>
                            </TouchableOpacity>
                          );
                        })()}
                      </View>
                      {paidNum > 0 && (
                        <View style={styles.changeBox}>
                          <Text style={styles.changeLabel}>Change to Return</Text>
                          <Text style={styles.changeValue}>{currencySymbol}{change.toFixed(2)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <TouchableOpacity style={[styles.completeBtn, processing && { opacity: 0.7 }]} onPress={confirmPayment} disabled={processing}>
                    {processing ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={24} color="#fff" /><Text style={styles.completeBtnText}>Complete Settlement</Text></>}
                  </TouchableOpacity>
                </View>

                {showOrderPanel && (
                  <View style={styles.rightPane}>
                    <View style={styles.summaryCard}>
                      <View style={styles.summaryHeader}><Text style={styles.summaryTitle}>Amount Due</Text><Text style={styles.summaryTotal}>{currencySymbol}{total.toFixed(2)}</Text></View>
                      <View style={styles.breakdown}>
                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>Subtotal</Text>
                          <Text style={styles.breakValue}>{currencySymbol}{payItemDiscount > 0 ? payGrossTotal.toFixed(2) : subtotal.toFixed(2)}</Text>
                        </View>

                        {payItemDiscount > 0 && (
                          <View style={styles.breakRow}>
                            <Text style={[styles.breakLabel, { color: Theme.danger }]}>Item Discounts</Text>
                            <Text style={[styles.breakValue, { color: Theme.danger }]}>-{currencySymbol}{payItemDiscount.toFixed(2)}</Text>
                          </View>
                        )}
                        
                        {(discount?.applied || discountAmount > 0) && (
                          <View style={styles.breakRow}>
                            <Text style={[styles.breakLabel, { color: Theme.danger }]}>Discount</Text>
                            <Text style={[styles.breakValue, { color: Theme.danger }]}>
                              -{currencySymbol}{discountAmount.toFixed(2)}
                            </Text>
                          </View>
                        )}

                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>GST</Text>
                          <Text style={styles.breakValue}>${tax.toFixed(2)}</Text>
                        </View>

                        {roundOff !== 0 && (
                          <View style={styles.breakRow}>
                            <Text style={[styles.breakLabel, { color: Theme.primary }]}>Rounding</Text>
                            <Text style={[styles.breakValue, { color: Theme.primary }]}>
                              {roundOff > 0 ? "+" : ""}${roundOff.toFixed(2)}
                            </Text>
                          </View>
                        )}
                        {isCashMethod(method) && (
                          <>
                            <View style={styles.receiptDivider} />
                            <View style={styles.roundingContainer}>
                              <View style={styles.roundingHeader}>
                                <Text style={styles.roundingLabel}>Rounding</Text>
                                {roundType && (
                                  <TouchableOpacity onPress={() => {
                                    setRoundOff(0);
                                    setRoundType(null);
                                    if (method === "CAS") setCashInput(baseTotal.toFixed(2));
                                  }}>
                                    <Text style={styles.resetTextLink}>Reset</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                              
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TouchableOpacity 
                                  style={[styles.roundingToggleBtn, roundType === 'ten' && styles.activeRoundingBtn]}
                                  onPress={() => {
                                    if (roundType === 'ten') {
                                      setRoundOff(0);
                                      setRoundType(null);
                                      if (method === "CAS") setCashInput(baseTotal.toFixed(2));
                                    } else {
                                      const target = Math.round(baseTotal * 10) / 10;
                                      setRoundOff(target - baseTotal);
                                      setRoundType('ten');
                                      if (method === "CAS") setCashInput(target.toFixed(2));
                                    }
                                  }}
                                >
                                  <Ionicons 
                                    name={roundType === 'ten' ? "checkmark-circle" : "radio-button-off"} 
                                    size={18} 
                                    color={roundType === 'ten' ? "#fff" : Theme.primary} 
                                  />
                                  <Text style={[styles.roundingToggleText, roundType === 'ten' && styles.activeRoundingText]}>
                                    {roundType === 'ten' ? "Rounded to .10" : "Round to .10"}
                                  </Text>
                                </TouchableOpacity>

                                <TouchableOpacity 
                                  style={styles.moreAdjustBtn}
                                  onPress={() => setIsAdjustmentModalVisible(true)}
                                >
                                  <Ionicons name="options" size={18} color={Theme.primary} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                    <View style={styles.orderItemsCard}>
                      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Order Items</Text></View>
                      <FlatList data={finalItems} keyExtractor={(_, index) => index.toString()} renderItem={renderItem} scrollEnabled={false} />
                    </View>
                  </View>
                )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {renderAdjustmentModal()}
      {renderTestDisplayModal()}
      <UPIPaymentModal visible={isUPIVisible} onClose={() => setIsUPIVisible(false)} amount={total} onSuccess={() => executeFinalPayment()} />
      <PayNowPaymentModal visible={isPayNowVisible} onClose={() => setIsPayNowVisible(false)} amount={total} onSuccess={() => executeFinalPayment()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Theme.bgMain },
  container: { flex: 1, padding: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Theme.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: Theme.bgMuted, borderRadius: 10, borderWidth: 1, borderColor: Theme.border },
  orderInfo: { alignItems: "center", flex: 1 },
  orderTitle: { color: Theme.textPrimary, fontFamily: Fonts.black, fontSize: 16 },
  orderBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  typeBadgeText: { fontSize: 9, fontFamily: Fonts.black },
  tableBadge: { backgroundColor: Theme.bgMuted, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: Theme.border },
  tableBadgeText: { fontSize: 9, fontFamily: Fonts.bold, color: Theme.textPrimary },
  orderSub: { color: Theme.textSecondary, fontSize: 10, fontFamily: Fonts.bold },
  mainLayout: { flex: 1, gap: 15 },
  leftPane: { padding: 15, borderRadius: 20, backgroundColor: Theme.bgCard, ...Theme.shadowMd, borderWidth: 1, borderColor: Theme.border },
  methodsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 },
  methodCard: { width: '31.8%', height: 70, backgroundColor: Theme.bgMuted, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Theme.border, gap: 4 },
  activeMethodCard: { backgroundColor: Theme.primary, borderColor: Theme.primary, ...Theme.shadowMd },
  methodIconBox: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  activeIconBox: { backgroundColor: 'rgba(255,255,255,0.2)' },
  methodLabel: { fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, textAlign: 'center', paddingHorizontal: 2 },
  activeMethodLabel: { color: '#fff' },
  cashSection: { marginTop: 5 },
  sectionHeader: { marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontFamily: Fonts.black, color: Theme.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  cashInputBox: { flexDirection: 'row', alignItems: 'center', height: 56, backgroundColor: Theme.bgMuted, borderRadius: 12, paddingHorizontal: 16, borderWidth: 2, borderColor: Theme.border, marginBottom: 12 },
  currencyPrefix: { fontSize: 20, fontFamily: Fonts.black, color: Theme.primary, marginRight: 8 },
  cashInput: { flex: 1, fontSize: 24, fontFamily: Fonts.black, color: Theme.textPrimary },
  quickCashContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 15 },
  quickCashBtn: { minWidth: 54, height: 38, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: Theme.border, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10 },
  activeQuickCashBtn: { backgroundColor: Theme.primaryLight, borderColor: Theme.primaryBorder },
  quickCashText: { fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary },
  activeQuickCashText: { color: Theme.primary },
  changeBox: { padding: 12, backgroundColor: Theme.primaryLight, borderRadius: 14, borderWidth: 1, borderColor: Theme.primaryBorder, marginBottom: 15 },
  changeLabel: { fontSize: 9, fontFamily: Fonts.black, color: Theme.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  changeValue: { fontSize: 26, fontFamily: Fonts.black, color: Theme.primary },
  completeBtn: { height: 50, backgroundColor: Theme.primary, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, ...Theme.shadowLg },
  completeBtnText: { fontSize: 16, fontFamily: Fonts.black, color: '#fff' },
  rightPane: { flex: 0.7, gap: 15 },
  summaryCard: { padding: 18, backgroundColor: Theme.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  summaryHeader: { marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryTitle: { fontSize: 10, fontFamily: Fonts.black, color: Theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryTotal: { fontSize: 30, fontFamily: Fonts.black, color: Theme.primary, lineHeight: 34 },
  breakdown: { gap: 8 },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakLabel: { fontSize: 13, fontFamily: Fonts.semiBold, color: Theme.textSecondary },
  breakValue: { fontSize: 14, fontFamily: Fonts.extraBold, color: Theme.textPrimary },
  receiptDivider: { height: 1, backgroundColor: Theme.border, marginVertical: 12 },
  roundingContainer: { marginTop: 8 },
  roundingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  roundingLabel: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary, textTransform: 'uppercase' },
  resetTextLink: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.danger },
  roundingToggleBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: "#fff", borderWidth: 2, borderColor: Theme.primaryBorder, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  activeRoundingBtn: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  roundingToggleText: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.primary },
  activeRoundingText: { color: "#fff" },
  moreAdjustBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: Theme.bgMuted, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Theme.border },
  orderItemsCard: { flex: 1, padding: 20, backgroundColor: Theme.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Theme.border },
  itemRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Theme.border },
  itemQty: { width: 30, fontSize: 13, fontFamily: Fonts.black, color: Theme.primary },
  itemName: { flex: 1, fontSize: 13, fontFamily: Fonts.medium, color: Theme.textPrimary },
  itemPrice: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  adjustModalContent: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 24, padding: 24, ...Theme.shadowLg },
  adjustModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  adjustModalTitle: { fontSize: 18, fontFamily: Fonts.black, color: Theme.textPrimary },
  adjustPresets: { gap: 10, marginBottom: 20 },
  presetItem: { backgroundColor: Theme.bgMuted, padding: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Theme.border },
  presetLabel: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary },
  presetValue: { fontSize: 13, fontFamily: Fonts.black, color: Theme.primary },
  customInputSection: { marginBottom: 20 },
  inputLabel: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 6, textTransform: 'uppercase' },
  customInputRow: { flexDirection: 'row', gap: 8 },
  adjustTextInput: { flex: 1, height: 46, backgroundColor: Theme.bgMuted, borderRadius: 10, paddingHorizontal: 14, fontSize: 15, fontFamily: Fonts.bold },
  applyBtn: { backgroundColor: Theme.primary, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center' },
  applyBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 13 },
  resetBtnFull: { height: 44, justifyContent: 'center', alignItems: 'center' },
  resetBtnText: { color: Theme.danger, fontFamily: Fonts.bold, fontSize: 13 },
  mobileSummaryCard: {
    backgroundColor: Theme.primary + "10",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Theme.primary + "20",
  },
  mobileSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mobileSummaryLabel: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    letterSpacing: 0.5,
  },
  mobileSummaryTotal: {
    fontSize: 28,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  mobileAdjustBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  mobileAdjustText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  mobileDiscountText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.danger,
    marginTop: 4,
  },
  separator: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 16,
  },
  linkSection: {
    alignItems: 'center',
    marginTop: 5,
  },
  linkTitle: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  linkSub: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 12,
    alignSelf: 'flex-start',
    lineHeight: 15,
  },
  qrContainer: {
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  urlText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  openBtn: {
    backgroundColor: Theme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    width: '100%',
  },
  openBtnText: {
    color: '#fff',
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
});
