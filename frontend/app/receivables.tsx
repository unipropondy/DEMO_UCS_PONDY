import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  Platform,
  StatusBar,
  Linking,
  Dimensions,
  BackHandler,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { useCompanySettingsStore } from "@/stores/companySettingsStore";

type CustomerAgingType = {
  MemberId: string;
  Name: string;
  Phone: string;
  OutstandingBalance: number;
  Bucket0to30: number;
  Bucket31to60: number;
  Bucket61to90: number;
  Bucket90Plus: number;
};

type CreditTransactionType = {
  TransactionId: string;
  SettlementId?: string;
  BillNo?: string;
  TransactionType: "DEBIT" | "CREDIT" | "ADJUSTMENT";
  Amount: number;
  PaymentMethod?: string;
  Remarks?: string;
  CreatedDate: string;
  runningBalance: number;
};

type OutstandingBillType = {
  SettlementId: string;
  BillNo: string;
  GrossAmount: number;
  PaidAmount: number;
  OutstandingAmount: number;
  InvoiceDate: string;
};

type DashboardStats = {
  totalOutstanding: number;
  totalOverdue: number;
  totalCustomersWithCredit: number;
  collectionsToday: number;
  collectionsThisMonth: number;
};

export default function ReceivablesScreen() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const isFocused = useIsFocused();
  const settingsStore = useCompanySettingsStore((state) => state.settings);
  const currencySymbol = settingsStore?.currencySymbol || "$";
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isMobile = screenWidth < 768;

  // Diagnostics states
  const [sheetDiagHeight, setSheetDiagHeight] = useState<number>(0);
  const [footerDiagHeight, setFooterDiagHeight] = useState<number>(0);

  // Tab state
  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "AGING">("DASHBOARD");

  // Data states
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [agingData, setAgingData] = useState<CustomerAgingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerAgingType | null>(null);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<"LEDGER" | "BILLS">("LEDGER");

  // Runtime diagnostics logging
  useEffect(() => {
    if (showLedgerModal) {
      console.log(`[DIAGNOSTICS] showLedgerModal=true. Screen dims: ${screenWidth}x${screenHeight}. isMobile: ${isMobile}. sheetHeight: ${sheetDiagHeight}, footerHeight: ${footerDiagHeight}`);
    }
  }, [showLedgerModal, screenWidth, screenHeight, isMobile, sheetDiagHeight, footerDiagHeight]);

  // Ledger and Outstanding details
  const [transactions, setTransactions] = useState<CreditTransactionType[]>([]);
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBillType[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Fetch Dashboard Stats and Aging data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      // 1. Fetch dashboard stats
      const statsRes = await fetch(`${API_URL}/api/credit-customers/receivables/dashboard`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const statsJson = await statsRes.json();
      if (statsJson.success && statsJson.stats) {
        setStats({
          totalOutstanding: Number(statsJson.stats.totalOutstanding || 0),
          totalOverdue: Number(statsJson.stats.totalOverdue || 0),
          totalCustomersWithCredit: Number(statsJson.stats.totalCustomersWithCredit || 0),
          collectionsToday: Number(statsJson.stats.collectionsToday || 0),
          collectionsThisMonth: Number(statsJson.stats.collectionsThisMonth || 0)
        });
      }

      // 2. Fetch customer aging report
      const agingRes = await fetch(`${API_URL}/api/credit-customers/receivables/aging`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const agingJson = await agingRes.json();
      if (agingJson.success) {
        const parsed = (agingJson.customers || []).map((c: any) => ({
          ...c,
          OutstandingBalance: Number(c.OutstandingBalance || 0),
          Bucket0to30: Number(c.Bucket0to30 || 0),
          Bucket31to60: Number(c.Bucket31to60 || 0),
          Bucket61to90: Number(c.Bucket61to90 || 0),
          Bucket90Plus: Number(c.Bucket90Plus || 0)
        }));
        setAgingData(parsed);
      }
    } catch (err) {
      console.error("[FETCH RECEIVABLES DATA ERROR]", err);
      Alert.alert("Error", "Could not fetch credit statement dashboard.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isFocused) {
      fetchData();
    }
  }, [isFocused, fetchData]);

  // Handle hardware back button on Android
  useEffect(() => {
    const backAction = () => {
      if (showLedgerModal) {
        setShowLedgerModal(false);
        setSelectedCustomer(null);
        setTransactions([]);
        setOutstandingBills([]);
        return true;
      }
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/category");
      }
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  }, [showLedgerModal]);

  // Fetch individual customer statements and unpaid bills
  const fetchCustomerDetails = async (customer: CustomerAgingType) => {
    setLoadingDetails(true);
    setLedgerTab("LEDGER");
    try {
      // 1. Fetch ledger statement
      const ledgerRes = await fetch(`${API_URL}/api/credit-customers/statement/${customer.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const ledgerJson = await ledgerRes.json();
      if (ledgerJson.success) {
        const parsedTx = (ledgerJson.transactions || []).map((t: any) => ({
          ...t,
          Amount: Number(t.Amount || 0),
          runningBalance: Number(t.runningBalance || 0)
        }));
        setTransactions(parsedTx);
      }

      // 2. Fetch outstanding bills
      const billsRes = await fetch(`${API_URL}/api/credit-customers/outstanding/${customer.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const billsJson = await billsRes.json();
      if (billsJson.success) {
        const parsedBills = (billsJson.outstandingBills || []).map((b: any) => ({
          ...b,
          GrossAmount: Number(b.GrossAmount || 0),
          PaidAmount: Number(b.PaidAmount || 0),
          OutstandingAmount: Number(b.OutstandingAmount || 0)
        }));
        setOutstandingBills(parsedBills);
      }
    } catch (err) {
      console.error("[FETCH CUSTOMER DETAILS ERROR]", err);
      Alert.alert("Error", "Failed to fetch statement details.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleOpenCustomer = (customer: CustomerAgingType) => {
    setSelectedCustomer(customer);
    setShowLedgerModal(true);
    fetchCustomerDetails(customer);
  };



  // Send WhatsApp Reminder Link
  const handleSendWhatsAppReminder = () => {
    if (!selectedCustomer) return;
    
    // Clean phone number (remove spaces, symbols)
    const hasPlus = selectedCustomer.Phone.trim().startsWith("+");
    const cleanPhone = selectedCustomer.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    
    let message = `Hi ${selectedCustomer.Name},\n\nThis is a friendly reminder that you have a pending outstanding balance of *${currencySymbol}${selectedCustomer.OutstandingBalance.toFixed(2)}* with us.`;
    
    if (outstandingBills.length > 0) {
      message += `\n\nPending Bills Breakdown:\n`;
      outstandingBills.forEach((bill) => {
        const dateStr = new Date(bill.InvoiceDate).toLocaleDateString([], { day: "numeric", month: "short" });
        message += `• *${bill.BillNo}* (${dateStr}) : ${currencySymbol}${bill.OutstandingAmount.toFixed(2)}\n`;
      });
    }
    
    message += `\nKindly settle the pending dues at your earliest convenience. Thank you!`;

    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        // Fallback to web link
        const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        Linking.openURL(webUrl);
      }
    });
  };

  // Filter customers by search query
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return agingData;
    return agingData.filter((c) =>
      c.Name.toLowerCase().includes(query) || c.Phone.includes(query)
    );
  }, [agingData, searchQuery]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* --- Header --- */}
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/category");
              }
            }}
            style={styles.circularBack}
          >
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>Credit & Receivables</Text>
            <Text style={styles.screenSubtitle}>Ledger-based accounting & collections</Text>
          </View>
          <TouchableOpacity onPress={fetchData} style={styles.refreshBtn} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color={Theme.primary} />
            ) : (
              <Ionicons name="refresh" size={20} color={Theme.textPrimary} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Theme.primary} />
          }
        >
          {/* --- KPI Stats section --- */}
          {isMobile ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 15 }}
            >
              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.bgDark, borderColor: Theme.borderDark }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.textMuted }]}>TOTAL OUTSTANDING</Text>
                  <Ionicons name="alert-circle" size={18} color={Theme.warning} />
                </View>
                <Text style={[styles.kpiVal, { color: "#FFF" }]}>
                  {currencySymbol}{(stats?.totalOutstanding || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 4 }}>
                  Active Accounts: {stats?.totalCustomersWithCredit || 0}
                </Text>
              </View>

              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.danger + "10", borderColor: Theme.danger }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.danger }]}>OVERDUE (30+ DAYS)</Text>
                  <Ionicons name="warning" size={18} color={Theme.danger} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.danger }]}>
                  {currencySymbol}{(stats?.totalOverdue || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Action required immediately
                </Text>
              </View>

              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.success + "10", borderColor: Theme.success }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.success }]}>COLLECTED THIS MONTH</Text>
                  <Ionicons name="checkmark-done" size={18} color={Theme.success} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.success }]}>
                  {currencySymbol}{(stats?.collectionsThisMonth || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Today: {currencySymbol}{(stats?.collectionsToday || 0).toFixed(2)}
                </Text>
              </View>
            </ScrollView>
          ) : (
            <View style={styles.kpiContainer}>
              <View style={[styles.kpiCard, { backgroundColor: Theme.bgDark, borderColor: Theme.borderDark }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.textMuted }]}>TOTAL OUTSTANDING</Text>
                  <Ionicons name="alert-circle" size={18} color={Theme.warning} />
                </View>
                <Text style={[styles.kpiVal, { color: "#FFF" }]}>
                  {currencySymbol}{(stats?.totalOutstanding || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 4 }}>
                  Active Accounts: {stats?.totalCustomersWithCredit || 0}
                </Text>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: Theme.danger + "10", borderColor: Theme.danger }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.danger }]}>OVERDUE (30+ DAYS)</Text>
                  <Ionicons name="warning" size={18} color={Theme.danger} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.danger }]}>
                  {currencySymbol}{(stats?.totalOverdue || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Action required immediately
                </Text>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: Theme.success + "10", borderColor: Theme.success }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.success }]}>COLLECTED THIS MONTH</Text>
                  <Ionicons name="checkmark-done" size={18} color={Theme.success} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.success }]}>
                  {currencySymbol}{(stats?.collectionsThisMonth || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Today: {currencySymbol}{(stats?.collectionsToday || 0).toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          {/* --- Navigation Tabs --- */}
          <View style={styles.tabsWrapper}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === "DASHBOARD" && styles.activeTabBtn]}
              onPress={() => setActiveTab("DASHBOARD")}
            >
              <Ionicons
                name="people"
                size={16}
                color={activeTab === "DASHBOARD" ? "#FFF" : Theme.textSecondary}
              />
              <Text style={[styles.tabText, activeTab === "DASHBOARD" && styles.activeTabText]}>
                Credit Accounts
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === "AGING" && styles.activeTabBtn]}
              onPress={() => setActiveTab("AGING")}
            >
              <Ionicons
                name="hourglass-outline"
                size={16}
                color={activeTab === "AGING" ? "#FFF" : Theme.textSecondary}
              />
              <Text style={[styles.tabText, activeTab === "AGING" && styles.activeTabText]}>
                Aging Analysis
              </Text>
            </TouchableOpacity>
          </View>

          {/* --- Search Bar --- */}
          <View style={styles.searchWrapper}>
            <View style={styles.searchInner}>
              <Ionicons name="search" size={20} color={Theme.textMuted} />
              <TextInput
                placeholder="Search customers..."
                placeholderTextColor={Theme.textMuted}
                style={styles.searchField}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>

          {/* --- Main Contents depending on Tab --- */}
          {activeTab === "DASHBOARD" ? (
            <View style={styles.listContainer}>
              {filteredCustomers.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="people-outline" size={48} color={Theme.textMuted} />
                  <Text style={styles.emptyText}>No customer credit records found</Text>
                </View>
              ) : (
                filteredCustomers.map((item) => (
                  <TouchableOpacity
                     key={item.MemberId}
                     style={styles.customerCard}
                     activeOpacity={0.8}
                     onPress={() => handleOpenCustomer(item)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarLetter}>{item.Name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.customerName}>{item.Name}</Text>
                        <Text style={styles.customerPhone}>{item.Phone}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.outstandingLabel}>OUTSTANDING</Text>
                        <Text style={styles.outstandingValue}>
                          {currencySymbol}{item.OutstandingBalance.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    {/* Aging summary preview bar */}
                    <View style={styles.agingBarContainer}>
                      <Text style={styles.agingBarTitle}>Aging Buckets:</Text>
                      <View style={styles.agingBarRow}>
                        {item.Bucket0to30 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket0to30, backgroundColor: Theme.success }]}>
                            <Text style={styles.segmentText}>0-30d</Text>
                          </View>
                        )}
                        {item.Bucket31to60 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket31to60, backgroundColor: Theme.warning }]}>
                            <Text style={styles.segmentText}>31-60d</Text>
                          </View>
                        )}
                        {item.Bucket61to90 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket61to90, backgroundColor: Theme.primary }]}>
                            <Text style={styles.segmentText}>61-90d</Text>
                          </View>
                        )}
                        {item.Bucket90Plus > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket90Plus, backgroundColor: Theme.danger }]}>
                            <Text style={styles.segmentText}>90d+</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>
          ) : (
            /* --- Aging Analysis View --- */
            <View style={styles.listContainer}>
              {filteredCustomers.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="hourglass-outline" size={48} color={Theme.textMuted} />
                  <Text style={styles.emptyText}>No aging metrics found</Text>
                </View>
              ) : (
                filteredCustomers.map((item) => (
                  <View key={item.MemberId} style={styles.agingCard}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => handleOpenCustomer(item)}
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
                    >
                      <View>
                        <Text style={styles.customerName}>{item.Name}</Text>
                        <Text style={styles.customerPhone}>{item.Phone}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.outstandingLabel}>TOTAL</Text>
                        <Text style={[styles.outstandingValue, { fontSize: 16 }]}>
                          {currencySymbol}{item.OutstandingBalance.toFixed(2)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.agingGrid}>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>0-30 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket0to30 > 0 && { color: Theme.success }]}>
                          {currencySymbol}{item.Bucket0to30.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>31-60 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket31to60 > 0 && { color: Theme.warning }]}>
                          {currencySymbol}{item.Bucket31to60.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>61-90 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket61to90 > 0 && { color: Theme.primary }]}>
                          {currencySymbol}{item.Bucket61to90.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>90+ days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket90Plus > 0 && { color: Theme.danger, fontFamily: Fonts.black }]}>
                          {currencySymbol}{item.Bucket90Plus.toFixed(0)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>

        {/* ================= LEDGER STATEMENT VIEW MODAL ================= */}
        <Modal 
          visible={showLedgerModal} 
          transparent 
          animationType="slide"
          onRequestClose={() => {
            setShowLedgerModal(false);
            setSelectedCustomer(null);
            setTransactions([]);
            setOutstandingBills([]);
          }}
        >
          <View style={styles.modalOverlay}>
            <View 
              onLayout={(e) => setSheetDiagHeight(e.nativeEvent.layout.height)}
              style={[
                styles.ledgerSheet,
                isMobile && {
                  maxHeight: "85%",
                  borderRadius: 16,
                  width: "95%",
                }
              ]}
            >
              {/* Header */}
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>Account Ledger</Text>
                  <Text style={styles.sheetSubtitle}>
                    {selectedCustomer?.Name} • {selectedCustomer?.Phone}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowLedgerModal(false);
                    setSelectedCustomer(null);
                    setTransactions([]);
                    setOutstandingBills([]);
                  }}
                  style={styles.sheetClose}
                >
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingDetails ? (
                <View style={[styles.centerBlock, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                  <Text style={{ marginTop: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
                    Fetching ledger rows...
                  </Text>
                </View>
              ) : (
                /* ── scrollable body: tabs + content ── flex:1 so footer stays below ── */
                <View style={{ flex: 1, minHeight: 0 }}>
                  {/* Ledger navigation tabs */}
                  <View style={styles.ledgerTabs}>
                    <TouchableOpacity
                      style={[styles.ledgerTabBtn, ledgerTab === "LEDGER" && styles.activeLedgerTabBtn]}
                      onPress={() => setLedgerTab("LEDGER")}
                    >
                      <Text style={[styles.ledgerTabText, ledgerTab === "LEDGER" && styles.activeLedgerTabText, isMobile && { fontSize: 11 }]}>
                        Transaction Statement
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ledgerTabBtn, ledgerTab === "BILLS" && styles.activeLedgerTabBtn]}
                      onPress={() => setLedgerTab("BILLS")}
                    >
                      <Text style={[styles.ledgerTabText, ledgerTab === "BILLS" && styles.activeLedgerTabText, isMobile && { fontSize: 11 }]}>
                        Open Invoices ({outstandingBills.length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ flex: 1, padding: isMobile ? 12 : 20 }} showsVerticalScrollIndicator={false}>
                    {ledgerTab === "LEDGER" ? (
                      /* --- Ledger transaction statement history --- */
                      <View style={{ paddingBottom: 20 }}>
                        {transactions.length === 0 ? (
                          <Text style={styles.noHistoryText}>No credit transaction history.</Text>
                        ) : (
                          <View style={styles.ledgerTable}>
                            {/* Table Header */}
                            <View style={styles.ledgerRowHeader}>
                              <Text style={[styles.ledgerColHeader, { flex: 1.1 }]} numberOfLines={1} adjustsFontSizeToFit>DATE/TIME</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 1.2 }]} numberOfLines={1} adjustsFontSizeToFit>REF/REMARKS</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 0.8, textAlign: "right" }]} numberOfLines={1} adjustsFontSizeToFit>AMT</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 0.9, textAlign: "right" }]} numberOfLines={1} adjustsFontSizeToFit>BAL</Text>
                            </View>

                            {/* Table Rows */}
                            {transactions.map((tx, idx) => {
                              const d = new Date(tx.CreatedDate);
                              const formattedDate = d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                              const isDebit = tx.TransactionType === "DEBIT" || (tx.TransactionType === "ADJUSTMENT" && tx.Amount > 0);
                              return (
                                <View key={tx.TransactionId || idx} style={styles.ledgerRow}>
                                  <Text style={[styles.ledgerCol, { flex: 1.1, fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>{formattedDate}</Text>
                                  <View style={{ flex: 1.2, paddingRight: 4 }}>
                                    <Text style={[styles.ledgerCol, { fontFamily: Fonts.bold, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                      {tx.TransactionType} {tx.BillNo ? `#${tx.BillNo}` : ""}
                                    </Text>
                                    {tx.Remarks && (
                                      <Text style={styles.ledgerRowRemarks} numberOfLines={1} adjustsFontSizeToFit>
                                        {tx.Remarks}
                                      </Text>
                                    )}
                                  </View>
                                  <Text style={[styles.ledgerCol, { flex: 0.8, textAlign: "right", fontFamily: Fonts.bold, color: isDebit ? Theme.danger : Theme.success, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {isDebit ? "+" : "-"}{currencySymbol}{tx.Amount.toFixed(2)}
                                  </Text>
                                  <Text style={[styles.ledgerCol, { flex: 0.9, textAlign: "right", fontFamily: Fonts.black, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {currencySymbol}{tx.runningBalance.toFixed(2)}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    ) : (
                      /* --- Outstanding Bills list --- */
                      <View style={{ paddingBottom: 20 }}>
                        {outstandingBills.length === 0 ? (
                          <Text style={styles.noHistoryText}>No pending invoices found.</Text>
                        ) : (
                          <View style={{ gap: 10 }}>
                            {outstandingBills.map((bill) => {
                              const bd = new Date(bill.InvoiceDate);
                              const formattedBillDate = bd.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
                              return (
                                <View key={bill.SettlementId} style={styles.billItemCard}>
                                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                                    <View style={{ flex: 1, paddingRight: 8 }}>
                                      <Text style={styles.billItemTitle} numberOfLines={1} adjustsFontSizeToFit>Bill #{bill.BillNo}</Text>
                                      <Text style={styles.billItemSub} numberOfLines={1} adjustsFontSizeToFit>{formattedBillDate}</Text>
                                    </View>
                                    <View style={styles.billItemBadge}>
                                      <Text style={styles.billItemBadgeText}>DUE</Text>
                                    </View>
                                  </View>
                                  <View style={styles.billDivider} />
                                  <View style={styles.billBreakdown}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>GROSS AMT</Text>
                                      <Text style={styles.billBreakValue} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{bill.GrossAmount.toFixed(2)}</Text>
                                    </View>
                                    <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 4 }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>PAID AMT</Text>
                                      <Text style={[styles.billBreakValue, { color: Theme.success }]} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{bill.PaidAmount.toFixed(2)}</Text>
                                    </View>
                                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>OUTSTANDING</Text>
                                      <Text style={[styles.billBreakValue, { color: Theme.danger, fontFamily: Fonts.black }]} numberOfLines={1} adjustsFontSizeToFit>
                                        {currencySymbol}{bill.OutstandingAmount.toFixed(2)}
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}

              {/* ── sticky action footer: direct child of ledgerSheet, NEVER clipped ── */}
              {!loadingDetails && (
                <View 
                  onLayout={(e) => setFooterDiagHeight(e.nativeEvent.layout.height)}
                  style={styles.ledgerActions}
                >
                  <TouchableOpacity
                    onPress={handleSendWhatsAppReminder}
                    style={[styles.actionButton, { backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border }]}
                  >
                    <Ionicons name="logo-whatsapp" size={20} color={Theme.success} />
                    <Text 
                      style={[styles.actionButtonText, { color: Theme.textPrimary }, isMobile && { fontSize: 11 }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      WhatsApp Reminder
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedCustomer) return;
                      setShowLedgerModal(false);
                      router.push({
                        pathname: "/payment",
                        params: {
                          memberId: selectedCustomer.MemberId,
                          collectAmount: String(Math.max(0, selectedCustomer.OutstandingBalance || 0)),
                          memberName: selectedCustomer.Name,
                          memberPhone: selectedCustomer.Phone,
                          isMember: "false"
                        }
                      });
                    }}
                    style={[styles.actionButton, { backgroundColor: Theme.primary }]}
                    disabled={!selectedCustomer || selectedCustomer.OutstandingBalance <= 0.01}
                  >
                    <Ionicons name="wallet-outline" size={20} color="#fff" />
                    <Text 
                      style={[styles.actionButtonText, { color: "#fff" }, isMobile && { fontSize: 11 }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      Record Collection
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>



      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 15 },
  circularBack: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  screenTitle: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  screenSubtitle: { color: Theme.textSecondary, fontSize: 11, fontFamily: Fonts.medium },
  refreshBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  
  // KPI Stats
  kpiContainer: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 12, marginBottom: 15 },
  kpiCard: { flex: 1, minWidth: 150, padding: 15, borderRadius: 16, borderWidth: 1, ...Theme.shadowSm },
  kpiLabel: { fontSize: 9, fontFamily: Fonts.black, letterSpacing: 0.5 },
  kpiVal: { fontSize: 18, fontFamily: Fonts.black, marginTop: 4 },

  // Tabs navigation
  tabsWrapper: { flexDirection: "row", paddingHorizontal: 20, gap: 10, marginVertical: 10 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: 12, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border },
  activeTabBtn: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  tabText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13 },
  activeTabText: { color: "#FFF" },

  // Search Bar
  searchWrapper: { marginHorizontal: 20, marginBottom: 15 },
  searchInner: { 
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 50, 
    borderRadius: 12, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm 
  },
  searchField: { flex: 1, color: Theme.textPrimary, fontFamily: Fonts.medium, fontSize: 14, marginLeft: 10, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  
  // Customer List
  listContainer: { paddingHorizontal: 20, gap: 12 },
  customerCard: { backgroundColor: Theme.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center" },
  avatarLetter: { color: Theme.primary, fontSize: 16, fontFamily: Fonts.black },
  customerName: { color: Theme.textPrimary, fontSize: 16, fontFamily: Fonts.bold },
  customerPhone: { color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.medium, marginTop: 2 },
  outstandingLabel: { color: Theme.textMuted, fontSize: 8, fontFamily: Fonts.black, letterSpacing: 0.5 },
  outstandingValue: { color: Theme.danger, fontSize: 16, fontFamily: Fonts.black, marginTop: 2 },
  
  // Aging segment bar
  agingBarContainer: { marginTop: 12, borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 10 },
  agingBarTitle: { fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 6 },
  agingBarRow: { flexDirection: "row", height: 18, borderRadius: 9, overflow: "hidden", backgroundColor: Theme.bgInput },
  agingBarSegment: { height: "100%", justifyContent: "center", alignItems: "center" },
  segmentText: { color: "#FFF", fontSize: 8, fontFamily: Fonts.black },

  // Aging Cards
  agingCard: { backgroundColor: Theme.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  agingGrid: { flexDirection: "row", borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 12, marginTop: 4 },
  agingGridItem: { flex: 1, alignItems: "center" },
  agingGridLabel: { fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted },
  agingGridValue: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary, marginTop: 4 },

  // Ledger sheets
  modalOverlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  ledgerSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: "100%", maxWidth: 650, flex: 1, flexShrink: 1, maxHeight: "90%", ...Theme.shadowLg, overflow: "hidden" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: Theme.border },
  sheetTitle: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  sheetSubtitle: { color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.medium, marginTop: 2 },
  sheetClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center" },
  
  // Ledger inner tabs
  ledgerTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Theme.border, backgroundColor: Theme.bgMain },
  ledgerTabBtn: { flex: 1, paddingVertical: 14, alignItems: "center" },
  activeLedgerTabBtn: { borderBottomWidth: 3, borderBottomColor: Theme.primary, backgroundColor: Theme.bgCard },
  ledgerTabText: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary },
  activeLedgerTabText: { color: Theme.primary },

  // Ledger statement list
  ledgerTable: { borderBottomWidth: 1, borderBottomColor: Theme.border },
  ledgerRowHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1.5, borderBottomColor: Theme.border, backgroundColor: Theme.bgInput, paddingHorizontal: 10 },
  ledgerColHeader: { color: Theme.textPrimary, fontSize: 10, fontFamily: Fonts.black },
  ledgerRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Theme.border, paddingHorizontal: 10, alignItems: "center" },
  ledgerCol: { color: Theme.textPrimary, fontSize: 12, fontFamily: Fonts.medium },
  ledgerRowRemarks: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.regular, marginTop: 2 },
  noHistoryText: { color: Theme.textMuted, fontSize: 13, fontFamily: Fonts.medium, textAlign: "center", paddingVertical: 40, fontStyle: "italic" },

  // Outstanding bill cards
  billItemCard: { backgroundColor: Theme.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  billItemTitle: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary },
  billItemSub: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  billItemBadge: { backgroundColor: Theme.danger + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: Theme.danger },
  billItemBadgeText: { fontSize: 9, fontFamily: Fonts.black, color: Theme.danger },
  billDivider: { height: 1, backgroundColor: Theme.border, marginVertical: 10 },
  billBreakdown: { flexDirection: "row", justifyContent: "space-between" },
  billBreakLabel: { fontSize: 8, fontFamily: Fonts.black, color: Theme.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  billBreakValue: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  
  // Ledger action footer
  ledgerActions: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    gap: 12,
    backgroundColor: Theme.bgCard,
    // Ensure footer is always visible and never clipped
    flexShrink: 0,
    minHeight: 72,
    zIndex: 10,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    // Explicit min dimensions so production builds can't collapse them
    minWidth: 120,
    minHeight: 52,
  },
  actionButtonText: { fontSize: 13, fontFamily: Fonts.bold },

  // Collection modal
  collectCard: { backgroundColor: Theme.bgCard, borderRadius: 24, width: "100%", maxWidth: 500, flexShrink: 1, maxHeight: "90%", ...Theme.shadowLg, overflow: "hidden" },
  adjustModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: Theme.border },
  adjustModalTitle: { color: Theme.textPrimary, fontSize: 18, fontFamily: Fonts.black },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, marginBottom: 8, letterSpacing: 0.5 },
  inputHelper: { fontSize: 11, color: Theme.textSecondary, fontFamily: Fonts.medium, marginTop: 4 },
  sheetInput: { 
    height: 50, backgroundColor: Theme.bgInput, borderRadius: 10, color: Theme.textPrimary, 
    paddingHorizontal: 16, fontSize: 14, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  
  // Payment methods selection
  methodGroup: { flexDirection: "row", gap: 10 },
  methodToggle: { flex: 1, height: 44, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: "center", alignItems: "center" },
  activeMethodToggle: { backgroundColor: Theme.primary + "15", borderColor: Theme.primary },
  methodToggleText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13 },
  activeMethodToggleText: { color: Theme.primary },
  
  // Allocation toggle selection
  allocToggle: { flex: 1, height: 44, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  activeAllocToggle: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  allocToggleText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 12 },
  activeAllocToggleText: { color: "#FFF" },

  // Manual allocation table
  manualAllocBlock: { marginTop: 10, borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 14 },
  manualAllocTitle: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary, marginBottom: 8 },
  liveAllocSummary: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, backgroundColor: Theme.bgInput, padding: 10, borderRadius: 8 },
  liveAllocText: { fontSize: 12, fontFamily: Fonts.medium, color: Theme.textSecondary },
  manualAllocRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Theme.border },
  manualRowBillNo: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  manualRowBillDue: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  
  cashInputBox: { 
    flexDirection: "row", alignItems: "center", height: 48, 
    borderRadius: 8, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border,
    paddingHorizontal: 12, marginVertical: 8 
  },
  currencyPrefix: { fontSize: 16, fontFamily: Fonts.bold, color: Theme.textSecondary, marginRight: 4 },
  cashInput: { flex: 1, fontSize: 16, fontFamily: Fonts.bold, color: Theme.textPrimary, padding: 0, ...Platform.select({ web: { outlineStyle: "none" } as any }) },

  // Button submits
  submitBtn: { backgroundColor: Theme.primary, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 20, ...Theme.shadowMd },
  submitBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 14 },

  centerBlock: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 40 },
  emptyText: { fontFamily: Fonts.medium, fontSize: 14, color: Theme.textMuted, marginTop: 10 }
});
