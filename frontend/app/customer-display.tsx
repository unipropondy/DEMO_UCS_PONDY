import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  useWindowDimensions,
  Animated,
  Platform,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { socket } from "../constants/socket";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { usePaymentSettingsStore } from "../stores/paymentSettingsStore";
import { API_URL } from "../constants/Config";

interface DisplayState {
  active: boolean;
  paymentSuccess: boolean;
  orderId?: string;
  tableNo?: string;
  orderType?: "DINE_IN" | "TAKEAWAY" | "MANUAL";
  section?: string;
  items: any[];
  grossTotal: number;
  itemDiscounts: number;
  subTotal: number;
  orderDiscountAmount: number;
  gstAmount: number;
  roundOff: number;
  netTotal: number;
  waiterName?: string;
  paid?: number;
  change?: number;
  paymentMethod?: string;
}

const DEFAULT_STATE: DisplayState = {
  active: false,
  paymentSuccess: false,
  items: [],
  grossTotal: 0,
  itemDiscounts: 0,
  subTotal: 0,
  orderDiscountAmount: 0,
  gstAmount: 0,
  roundOff: 0,
  netTotal: 0,
};

export default function CustomerDisplayScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const companySettings = useCompanySettingsStore((s) => s.settings);
  const paymentSettings = usePaymentSettingsStore((s) => s.settings);

  const [displayState, setDisplayState] = useState<DisplayState>(DEFAULT_STATE);
  const [floatingFoods, setFloatingFoods] = useState<any[]>([]);
  
  // Animation value for success screen fade/scale
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  // 1. Initialize settings & socket listener
  useEffect(() => {
    usePaymentSettingsStore.getState().fetchSettings();
    useCompanySettingsStore.getState().fetchSettings("1");

    const handleSync = (data: any) => {
      console.log("🖥️ [CustomerDisplay] Received sync event:", data.paymentSuccess ? "SUCCESS" : (data.active ? "CART" : "IDLE"));
      setDisplayState(data);
    };

    socket.on("customer_display_sync", handleSync);

    return () => {
      socket.off("customer_display_sync", handleSync);
    };
  }, []);

  // 2. Success screen trigger and auto-timeout back to attract loop
  useEffect(() => {
    if (displayState.paymentSuccess) {
      // Animate success screen entrance
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          tension: 40,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Automatically reset to attract loop after 4 seconds
      const timer = setTimeout(() => {
        setDisplayState(DEFAULT_STATE);
        successScale.setValue(0);
        successOpacity.setValue(0);
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [displayState.paymentSuccess]);

  // 3. Spawning popping food animations for Attract Loop
  useEffect(() => {
    if (displayState.active) {
      setFloatingFoods([]);
      return;
    }

    const icons = [
      "pizza-outline",
      "cafe-outline",
      "ice-cream-outline",
      "restaurant-outline",
      "beer-outline",
      "fast-food-outline",
    ];

    const interval = setInterval(() => {
      const id = Math.random().toString();
      const icon = icons[Math.floor(Math.random() * icons.length)];
      // Spawn coordinates (percentage of screen viewport)
      const x = Math.random() * 80 + 10; 
      const y = Math.random() * 70 + 15; 

      const scale = new Animated.Value(0);
      const translateY = new Animated.Value(0);
      const opacity = new Animated.Value(1);

      const newItem = { id, icon, x, y, scale, translateY, opacity };
      setFloatingFoods((prev) => [...prev, newItem].slice(-15)); // Keep max 15 on screen

      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.3,
          tension: 30,
          friction: 4,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -80 - Math.random() * 50,
          duration: 3500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          delay: 2200,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Clean up from state once finished
        setFloatingFoods((prev) => prev.filter((item) => item.id !== id));
      });

    }, 900);

    return () => clearInterval(interval);
  }, [displayState.active]);

  // 4. Generate UPI QR URL
  const upiUrl = (() => {
    if (!paymentSettings.upiId) return "";
    const cleanUpiId = paymentSettings.upiId.trim();
    const cleanShopName = paymentSettings.shopName.replace(/[&?=]/g, "").trim();
    return `upi://pay?pa=${cleanUpiId}&pn=${encodeURIComponent(cleanShopName)}&am=${displayState.netTotal.toFixed(2)}&cu=INR`;
  })();

  // ─── RENDERS ───

  // Success view
  if (displayState.paymentSuccess) {
    return (
      <View style={styles.successContainer}>
        <Animated.View
          style={[
            styles.successCard,
            {
              transform: [{ scale: successScale }],
              opacity: successOpacity,
            },
          ]}
        >
          <View style={styles.successIconWrapper}>
            <Ionicons name="checkmark-circle" size={100} color={Theme.success} />
          </View>
          <Text style={styles.successTitle}>Payment Successful</Text>
          <Text style={styles.successOrderText}>
            Order #{displayState.orderId}
          </Text>

          <View style={styles.dashedDivider} />

          <View style={styles.successDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Settlement Mode</Text>
              <Text style={styles.detailValue}>{displayState.paymentMethod || "CARD/UPI"}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Amount Paid</Text>
              <Text style={[styles.detailValue, { color: Theme.primary }]}>
                {companySettings.currencySymbol || "$"}{displayState.paid?.toFixed(2) || displayState.netTotal.toFixed(2)}
              </Text>
            </View>
            {displayState.change && displayState.change > 0 ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Change Given</Text>
                <Text style={styles.detailValue}>
                  {companySettings.currencySymbol || "$"}{displayState.change.toFixed(2)}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.successFooter}>Thank you! Visit us again.</Text>
        </Animated.View>
      </View>
    );
  }

  // Active checkout view
  if (displayState.active) {
    const isUPI = /UPI|GPAY|PHONE|PAYTM/i.test(displayState.paymentMethod || "") || (displayState.paymentMethod === undefined && paymentSettings.upiId);
    const isPayNow = /PAYNOW|QR|PAY-NOW/i.test(displayState.paymentMethod || "") || (displayState.paymentMethod === undefined && paymentSettings.payNowQrUrl);

    return (
      <View style={styles.checkoutContainer}>
        <View style={[styles.checkoutLayout, isLandscape && styles.checkoutLayoutLandscape]}>
          
          {/* Left Pane: Payment QR & Instructions */}
          <View style={[styles.paymentPane, isLandscape && { flex: 1 }]}>
            <View style={styles.shopHeader}>
              <Text style={styles.shopName} numberOfLines={1}>
                {paymentSettings.shopName || companySettings.name || "Smart Cafe"}
              </Text>
              {companySettings.address ? (
                <Text style={styles.shopAddress} numberOfLines={1}>
                  {companySettings.address}
                </Text>
              ) : null}
            </View>

            <View style={styles.qrCard}>
              {isUPI && paymentSettings.upiId ? (
                <>
                  <Text style={styles.qrTitle}>Scan to Pay via UPI</Text>
                  <View style={styles.qrImageContainer}>
                    {Platform.OS === "web" ? (
                      <Image
                        source={{
                          uri: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUrl)}`,
                        }}
                        style={styles.webQrImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <QRCode value={upiUrl} size={180} color="#000" backgroundColor="#fff" />
                    )}
                  </View>
                  <Text style={styles.qrSubtitle}>GPay, PhonePe, Paytm, BHIM</Text>
                </>
              ) : isPayNow && paymentSettings.payNowQrUrl ? (
                <>
                  <Text style={styles.qrTitle}>Scan to Pay via PayNow</Text>
                  <View style={styles.qrImageContainer}>
                    <Image
                      source={{
                        uri: paymentSettings.payNowQrUrl.startsWith("data:")
                          ? paymentSettings.payNowQrUrl
                          : `${API_URL}${paymentSettings.payNowQrUrl}`,
                      }}
                      style={styles.webQrImage}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.qrSubtitle}>Scan QR code with your mobile banking app</Text>
                </>
              ) : (
                <View style={styles.noQrContainer}>
                  <Ionicons name="card" size={80} color={Theme.primary} />
                  <Text style={styles.noQrTitle}>Please pay at the cashier counter</Text>
                  <Text style={styles.noQrSubtitle}>Cash, Card, Nets accepted</Text>
                </View>
              )}
            </View>

            <View style={styles.grandTotalBanner}>
              <Text style={styles.bannerLabel}>Total to Pay</Text>
              <Text style={styles.bannerValue}>
                {companySettings.currencySymbol || "$"}{displayState.netTotal.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Right Pane: Cart & Totals Summary */}
          <View style={[styles.summaryPane, isLandscape && { flex: 1.1 }]}>
            <View style={styles.summaryTitleRow}>
              <Ionicons name="receipt-outline" size={24} color={Theme.primary} />
              <Text style={styles.summaryTitleText}>Order Summary</Text>
              {displayState.tableNo ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{displayState.tableNo}</Text>
                </View>
              ) : null}
            </View>

            {/* Itemized List */}
            <ScrollView showsVerticalScrollIndicator={false} style={styles.itemsScroll}>
              {displayState.items.map((item, idx) => (
                <View key={`${item.lineItemId}-${idx}`} style={[styles.itemRow, item.isVoided && styles.voidedRow]}>
                  <View style={styles.itemQtyBadge}>
                    <Text style={styles.itemQtyText}>{item.qty}x</Text>
                  </View>
                  <View style={styles.itemInfoCol}>
                    <Text style={[styles.itemNameText, item.isVoided && styles.voidedText]}>
                      {item.name}
                      {item.isVoided && " (VOIDED)"}
                    </Text>
                    {item.note ? <Text style={styles.itemNoteText}>📝 {item.note}</Text> : null}
                    {item.modifiers && item.modifiers.map((m: any, mIdx: number) => (
                      <Text key={mIdx} style={styles.itemModifierText}>
                        + {m.ModifierName}
                      </Text>
                    ))}
                  </View>
                  <Text style={[styles.itemPriceText, item.isVoided && styles.voidedText]}>
                    {companySettings.currencySymbol || "$"}{item.finalPrice.toFixed(2)}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.totalsSection}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>
                  {companySettings.currencySymbol || "$"}{displayState.grossTotal.toFixed(2)}
                </Text>
              </View>

              {displayState.itemDiscounts > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: Theme.danger }]}>Item Discounts</Text>
                  <Text style={[styles.totalsValue, { color: Theme.danger }]}>
                    -{companySettings.currencySymbol || "$"}{displayState.itemDiscounts.toFixed(2)}
                  </Text>
                </View>
              ) : null}

              {displayState.orderDiscountAmount > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: Theme.danger }]}>Order Discount</Text>
                  <Text style={[styles.totalsValue, { color: Theme.danger }]}>
                    -{companySettings.currencySymbol || "$"}{displayState.orderDiscountAmount.toFixed(2)}
                  </Text>
                </View>
              ) : null}

              {displayState.gstAmount > 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>GST ({companySettings.gstPercentage || 0}%)</Text>
                  <Text style={styles.totalsValue}>
                    {companySettings.currencySymbol || "$"}{displayState.gstAmount.toFixed(2)}
                  </Text>
                </View>
              ) : null}

              {displayState.roundOff !== 0 ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Rounding</Text>
                  <Text style={styles.totalsValue}>
                    {displayState.roundOff > 0 ? "+" : ""}{companySettings.currencySymbol || "$"}{displayState.roundOff.toFixed(2)}
                  </Text>
                </View>
              ) : null}

              <View style={styles.finalTotalRow}>
                <Text style={styles.finalTotalLabel}>Grand Total</Text>
                <Text style={styles.finalTotalValue}>
                  {companySettings.currencySymbol || "$"}{displayState.netTotal.toFixed(2)}
                </Text>
              </View>
            </View>

            {displayState.waiterName ? (
              <View style={styles.waiterFooter}>
                <Ionicons name="person-circle-outline" size={18} color={Theme.textSecondary} />
                <Text style={styles.waiterText}>Served by: {displayState.waiterName}</Text>
              </View>
            ) : null}

          </View>
        </View>
      </View>
    );
  }

  // 5. Idle attract loop view
  return (
    <View style={styles.idleContainer}>
      
      {/* Floating popping food animations */}
      {floatingFoods.map((item) => (
        <Animated.View
          key={item.id}
          style={[
            styles.floatingFood,
            {
              left: `${item.x}%`,
              top: `${item.y}%`,
              transform: [
                { scale: item.scale },
                { translateY: item.translateY },
              ],
              opacity: item.opacity,
            },
          ]}
        >
          <Ionicons name={item.icon} size={48} color={Theme.primary + "30"} />
        </Animated.View>
      ))}

      {/* Main Branding Card */}
      <View style={styles.brandingCard}>
        {companySettings.companyLogo ? (
          <Image
            source={{ uri: `${API_URL}${companySettings.companyLogo}` }}
            style={styles.logoImage}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.fallbackLogoContainer}>
            <Ionicons name="restaurant" size={60} color="#fff" />
          </View>
        )}

        <Text style={styles.welcomeTitle}>
          {companySettings.name || "Welcome to our Restaurant!"}
        </Text>
        <Text style={styles.welcomeSubtitle}>
          Order details will appear here during checkout.
        </Text>

        <View style={styles.halalContainer}>
          {companySettings.showHalalLogo && companySettings.halalLogo ? (
            <Image
              source={{ uri: `${API_URL}${companySettings.halalLogo}` }}
              style={styles.halalImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idleContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  floatingFood: {
    position: "absolute",
    zIndex: 1,
  },
  brandingCard: {
    backgroundColor: "#fff",
    padding: 40,
    borderRadius: 30,
    alignItems: "center",
    maxWidth: 550,
    width: "90%",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    zIndex: 2,
    borderWidth: 1.5,
    borderColor: Theme.border,
  },
  logoImage: {
    width: 150,
    height: 150,
    marginBottom: 20,
  },
  fallbackLogoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  welcomeTitle: {
    fontSize: 28,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    marginBottom: 10,
  },
  welcomeSubtitle: {
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  halalContainer: {
    marginTop: 20,
    height: 50,
  },
  halalImage: {
    width: 80,
    height: 50,
  },

  // Checkout layout
  checkoutContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  checkoutLayout: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  checkoutLayoutLandscape: {
    flexDirection: "row",
  },
  paymentPane: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1.5,
    borderColor: Theme.border,
    justifyContent: "space-between",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  shopHeader: {
    alignItems: "center",
    marginBottom: 15,
  },
  shopName: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  shopAddress: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  qrCard: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 10,
  },
  qrTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginBottom: 15,
  },
  qrImageContainer: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  webQrImage: {
    width: 180,
    height: 180,
  },
  qrSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 15,
    textAlign: "center",
  },
  noQrContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  noQrTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginTop: 15,
    textAlign: "center",
  },
  noQrSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 6,
  },
  grandTotalBanner: {
    backgroundColor: Theme.primaryLight,
    borderWidth: 1.5,
    borderColor: Theme.primaryBorder,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bannerLabel: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  bannerValue: {
    fontSize: 26,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },

  // Summary pane
  summaryPane: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1.5,
    borderColor: Theme.border,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  summaryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: Theme.border,
    paddingBottom: 12,
    marginBottom: 12,
    gap: 8,
  },
  summaryTitleText: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    flex: 1,
  },
  badge: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  itemsScroll: {
    flex: 1,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 10,
  },
  voidedRow: {
    backgroundColor: Theme.dangerBg || "#FEF2F2",
    opacity: 0.6,
  },
  itemQtyBadge: {
    backgroundColor: Theme.bgMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 32,
    alignItems: "center",
  },
  itemQtyText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  itemInfoCol: {
    flex: 1,
  },
  itemNameText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  voidedText: {
    textDecorationLine: "line-through",
    color: Theme.textMuted,
  },
  itemNoteText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  itemModifierText: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    marginTop: 2,
    paddingLeft: 6,
  },
  itemPriceText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    textAlign: "right",
  },
  totalsSection: {
    borderTopWidth: 1.5,
    borderTopColor: Theme.border,
    paddingTop: 12,
    marginTop: 12,
    gap: 8,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalsLabel: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  totalsValue: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  finalTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    paddingTop: 10,
    marginTop: 6,
  },
  finalTotalLabel: {
    fontSize: 16,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
  },
  finalTotalValue: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  waiterFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 15,
    gap: 6,
    opacity: 0.8,
  },
  waiterText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },

  // Success Container
  successContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  successCard: {
    backgroundColor: "#fff",
    borderRadius: 32,
    padding: 40,
    width: "90%",
    maxWidth: 450,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    borderWidth: 1.5,
    borderColor: Theme.border,
  },
  successIconWrapper: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 26,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
  },
  successOrderText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.success,
    marginTop: 5,
  },
  dashedDivider: {
    height: 1,
    borderWidth: 1,
    borderColor: Theme.border,
    borderStyle: "dashed",
    width: "100%",
    marginVertical: 20,
  },
  successDetails: {
    width: "100%",
    gap: 12,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  detailValue: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  successFooter: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginTop: 10,
    textAlign: "center",
  },
});
