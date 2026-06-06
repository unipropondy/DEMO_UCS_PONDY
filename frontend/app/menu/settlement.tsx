import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import axios from "axios";
import * as Print from "expo-print";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettlementScreen() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [loading, setLoading] = useState(false);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("");
  const [showLov, setShowLov] = useState(false);

  const [totalSales, setTotalSales] = useState<any>({});
  const [payments, setPayments] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);

  // Cash Out State
  const [cashOutEntries, setCashOutEntries] = useState<any[]>([]);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [cashOutForm, setCashOutForm] = useState({
    CashOutId: '',
    Amount: '',
    Reason: '',
    Remarks: '',
    PaymentMode: 'Cash',
    ReferenceNo: ''
  });

  const [lovMode, setLovMode] = useState<"OPEN" | "CLOSE">("OPEN");

  const [openingCash, setOpeningCash] = useState<string>("0");

  const [fromDate, setFromDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [toDate, setToDate] = useState<Date>(new Date());

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const userId = user?.userId || "0";

  // Hardcoded denominations
  const denominations = [100.00, 50.00, 20.00, 10.00, 5.00, 2.00, 1.00, 0.50, 0.20, 0.10, 0.05, 0.01];

  const initialCounts: Record<string, string> = {
    "100.00": "", "50.00": "", "20.00": "", "10.00": "", "5.00": "", "2.00": "",
    "1.00": "", "0.50": "", "0.20": "", "0.10": "", "0.05": "", "0.01": ""
  };

  const [openingCounts, setOpeningCounts] = useState<Record<string, string>>(initialCounts);
  const [closingCounts, setClosingCounts] = useState<Record<string, string>>(initialCounts);

  const handleCountChange = (denomStr: string, val: string) => {
    const cleaned = val.replace(/[^0-9]/g, "");
    if (lovMode === "OPEN") {
      setOpeningCounts(prev => ({ ...prev, [denomStr]: cleaned }));
    } else {
      setClosingCounts(prev => ({ ...prev, [denomStr]: cleaned }));
    }
  };

  const computeTotal = (counts: Record<string, string>) => Object.entries(counts).reduce((sum, [denom, count]) => {
    const val = parseFloat(denom);
    const qty = parseInt(count, 10) || 0;
    return sum + val * qty;
  }, 0);

  const totalOpening = computeTotal(openingCounts);
  const totalClosing = computeTotal(closingCounts);

  useEffect(() => {
    loadTerminals();
  }, []);

  const loadTerminals = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/settlement/terminals`);
      const termData = res.data || [];
      setTerminals(termData);
      if (termData.length > 0) {
        setSelectedTerminal(termData[0].TerminalCode);
      } else {
        setSelectedTerminal("ALL");
      }
    } catch (err) {
      console.error("❌ TERMINAL LOAD ERROR", err);
      setSelectedTerminal("ALL");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedTerminal) fetchData();
  }, [selectedTerminal, fromDate, toDate]);

  const fetchData = async () => {
    try {
      setLoading(true);

      const pad = (n: number) => n.toString().padStart(2, '0');
      const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

      const fromStr = formatLocal(fromDate);
      const toStr = formatLocal(toDate);

      const totalRes = await axios.get(`${API_URL}/api/settlement/total-sales/${selectedTerminal}?fromDate=${fromStr}&toDate=${toStr}`).catch(() => ({ data: {} }));
      const payRes = await axios.get(`${API_URL}/api/settlement/payment/${selectedTerminal}/${userId}?fromDate=${fromStr}&toDate=${toStr}`).catch(() => ({ data: [] }));
      const transRes = await axios.get(`${API_URL}/api/settlement/transactions/${selectedTerminal}/${userId}?fromDate=${fromStr}&toDate=${toStr}`).catch(() => ({ data: [] }));
      const salesRes = await axios.get(`${API_URL}/api/settlement/sales-summary/${selectedTerminal}?fromDate=${fromStr}&toDate=${toStr}`).catch(() => ({ data: [] }));

      const outId = selectedTerminal === "ALL" ? 1 : selectedTerminal;
      const dateStr = fromDate.toISOString().split("T")[0]; // Fetch opening cash for the fromDate
      const openRes = await axios.get(`${API_URL}/api/settlement/opening-cash?outletId=${outId}&date=${dateStr}`, { headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } }).catch(() => ({ data: null }));
      const denomsRes = await axios.get(`${API_URL}/api/settlement/denominations?type=OPEN`, { headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } }).catch(() => ({ data: null }));
      const closeDenomsRes = await axios.get(`${API_URL}/api/settlement/denominations?type=CLOSE`, { headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } }).catch(() => ({ data: null }));
      const cashOutRes = await axios.get(`${API_URL}/api/settlement/cash-out/${selectedTerminal}?fromDate=${fromStr}&toDate=${toStr}`, { headers: { Authorization: `Bearer ${useAuthStore.getState().token}` } }).catch(() => ({ data: null }));

      setTotalSales(totalRes.data || {});
      setPayments(payRes.data || []);
      setTransactions(transRes.data || []);
      setSales(salesRes.data || []);
      setCashOutEntries(cashOutRes.data?.data || []);

      if (openRes.data?.data?.total) {
        setOpeningCash(openRes.data.data.total.toString());
      } else if (openRes.data?.total) {
        setOpeningCash(openRes.data.total.toString());
      } else {
        setOpeningCash("0");
      }

      if (denomsRes.data?.success && Array.isArray(denomsRes.data.data)) {
        const newCounts: Record<string, string> = { ...initialCounts };
        denomsRes.data.data.forEach((d: any) => {
          const valStr = parseFloat(d.CurrencyValue).toFixed(2);
          if (newCounts[valStr] !== undefined) {
            newCounts[valStr] = d.NoteCount > 0 ? d.NoteCount.toString() : "";
          }
        });
        setOpeningCounts(newCounts);
      }

      if (closeDenomsRes.data?.success && Array.isArray(closeDenomsRes.data.data)) {
        const newCounts: Record<string, string> = { ...initialCounts };
        closeDenomsRes.data.data.forEach((d: any) => {
          const valStr = parseFloat(d.CurrencyValue).toFixed(2);
          if (newCounts[valStr] !== undefined) {
            newCounts[valStr] = d.NoteCount > 0 ? d.NoteCount.toString() : "";
          }
        });
        setClosingCounts(newCounts);
      }
    } catch (err) {
      console.error("❌ FETCH DATA ERROR", err);
      Alert.alert("Error", "Failed to load settlement data.");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: any) => {
    const val = parseFloat(amount);
    if (isNaN(val)) return "0.00";
    return val.toFixed(2);
  };

  const netSales =
    (parseFloat(totalSales.SubTotal) || 0) +
    (parseFloat(totalSales.ServiceCharge) || 0) +
    (parseFloat(totalSales.TotalTax) || 0) -
    (parseFloat(totalSales.DiscountAmount) || 0);

  const salesTotal = sales.reduce((sum, s) => sum + (parseFloat(s.Amount) || 0), 0);
  const paymentsTotal = payments.reduce((sum, p) => sum + (parseFloat(p.Amount) || 0), 0);
  const displayOpeningAmount = totalOpening > 0 ? totalOpening : (parseFloat(openingCash) || 0);
  const totalCashOut = cashOutEntries.reduce((sum, entry) => sum + (parseFloat(entry.Amount) || 0), 0);

  const baseTransactionsTotal = transactions.reduce((sum, t) => {
    const amt = parseFloat(t.Amount) || 0;
    return sum + (t.TransactionType === "IN" ? amt : -amt);
  }, 0);

  const transactionsTotal = baseTransactionsTotal + displayOpeningAmount - totalCashOut;
  const salesCash = parseFloat(payments.find(p => p.PaymodeName?.toUpperCase() === 'CASH')?.Amount) || 0;

  const sysCash = salesCash + transactionsTotal;

  const totalCashIn = paymentsTotal + displayOpeningAmount + transactions.filter(t => t.TransactionType === "IN").reduce((sum, t) => sum + (parseFloat(t.Amount) || 0), 0);
  const totalCashOutSum = totalCashOut + transactions.filter(t => t.TransactionType === "OUT").reduce((sum, t) => sum + (parseFloat(t.Amount) || 0), 0);

  const handleFinalize = async () => {
    try {
      setLoading(true);

      const payload = {
        outletId: 1, // Fallback, backend handles this based on user
        settlementDate: new Date().toISOString().split("T")[0],
        cashierName: user?.userName || "Admin",
        totalSales: totalSales.SubTotal || 0,
        totalDiscount: totalSales.DiscountAmount || 0,
        voidAmount: 0,
        netSales: netSales,
        cashReceived: totalClosing,
        expectedClosing: sysCash,
        variance: totalClosing - sysCash,
        varianceStatus: totalClosing === sysCash ? "BALANCED" : (totalClosing > sysCash ? "SURPLUS" : "SHORTAGE"),
        openingCash: displayOpeningAmount,
        cashAmount: totalClosing,
        cardAmount: payments.find(p => p.PaymodeName?.toUpperCase() === 'CARD')?.Amount || 0,
        upiAmount: payments.find(p => p.PaymodeName?.toUpperCase() === 'UPI')?.Amount || 0,
        paynowAmount: payments.find(p => p.PaymodeName?.toUpperCase() === 'PAYNOW')?.Amount || 0,
        valueCardAmount: payments.find(p => p.PaymodeName?.toUpperCase() === 'VALUE CARD')?.Amount || 0,
      };

      const res = await axios.post(`${API_URL}/api/settlement/finalize`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        Alert.alert("Success", "Settlement finalized successfully!");
        router.back();
      } else {
        Alert.alert("Error", res.data.error || "Failed to finalize settlement");
      }
    } catch (err: any) {
      console.error("❌ FINALIZE ERROR", err);
      Alert.alert("Error", err.response?.data?.error || "Failed to finalize settlement");
    } finally {
      setLoading(false);
    }
  };

  const handleClearDenominations = () => {
    if (lovMode === "OPEN") {
      setOpeningCounts(initialCounts);
    } else {
      setClosingCounts(initialCounts);
    }
  };

  const handleSaveDenominations = async () => {
    try {
      setLoading(true);
      const counts = lovMode === "OPEN" ? openingCounts : closingCounts;
      const totalVal = lovMode === "OPEN" ? totalOpening : totalClosing;
      
      const denomsPayload = Object.entries(counts).map(([denom, count]) => ({
        value: parseFloat(denom),
        count: parseInt(count, 10) || 0
      }));

      const res = await axios.post(`${API_URL}/api/settlement/save-denominations`, {
        denominations: denomsPayload,
        type: lovMode
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        const outId = selectedTerminal === "ALL" ? 1 : selectedTerminal;
        const dateStr = fromDate.toISOString().split("T")[0];

        if (lovMode === "OPEN") {
          await axios.post(`${API_URL}/api/settlement/opening-cash`, {
            outletId: outId,
            settlementDate: dateStr,
            notes: openingCounts,
            coins: {},
            total: totalOpening,
            cashierName: user?.userName || "Admin"
          }, {
            headers: { Authorization: `Bearer ${token}` }
          }).catch(err => console.error("Error saving opening cash total:", err));

          setOpeningCash(totalOpening.toString());
          setShowLov(false);
          Alert.alert("Success", "Opening cash denominations saved.");
        } else {
          await axios.post(`${API_URL}/api/settlement/physical-cash`, {
            outletId: outId,
            settlementDate: dateStr,
            notes: closingCounts,
            coins: {},
            total: totalClosing
          }, {
            headers: { Authorization: `Bearer ${token}` }
          }).catch(err => console.error("Error saving physical cash total:", err));

          setShowLov(false);
          Alert.alert("Success", "Closing cash denominations saved.");
        }
      } else {
        Alert.alert("Error", res.data.error || "Failed to save denominations");
      }
    } catch (err: any) {
      console.error("❌ SAVE DENOMINATIONS ERROR", err);
      Alert.alert("Error", err.response?.data?.error || "Failed to save denominations");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCashOut = async () => {
    if (!cashOutForm.Amount || parseFloat(cashOutForm.Amount) <= 0) {
      Alert.alert("Validation", "Please enter a valid amount");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        amount: parseFloat(cashOutForm.Amount),
        reason: cashOutForm.Reason,
        remarks: cashOutForm.Remarks,
        paymentMode: cashOutForm.PaymentMode,
        referenceNo: cashOutForm.ReferenceNo,
        terminalCode: selectedTerminal === "ALL" ? "" : selectedTerminal
      };

      let res;
      if (cashOutForm.CashOutId) {
        res = await axios.put(`${API_URL}/api/settlement/cash-out/${cashOutForm.CashOutId}`, payload, {
          headers: { Authorization: `Bearer ${useAuthStore.getState().token}` }
        });
      } else {
        res = await axios.post(`${API_URL}/api/settlement/cash-out`, payload, {
          headers: { Authorization: `Bearer ${useAuthStore.getState().token}` }
        });
      }

      if (res.data.success) {
        setCashOutForm({ CashOutId: '', Amount: '', Reason: '', Remarks: '', PaymentMode: 'Cash', ReferenceNo: '' });
        setShowCashOutModal(false);
        setToDate(new Date()); // Auto-update the "To" date so the new record falls within the filter range
        // Since setToDate triggers a re-fetch via useEffect, we don't strictly need fetchData() here,
        // but we'll leave it to guarantee a refresh.
        fetchData();
        Alert.alert("Success", "Cash Out entry saved");
      }
    } catch (err: any) {
      console.error("❌ SAVE CASH OUT ERROR", err);
      Alert.alert("Error", err.response?.data?.error || "Failed to save cash out entry");
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteCashOut = async (id: string) => {
    try {
      setLoading(true);
      const res = await axios.delete(`${API_URL}/api/settlement/cash-out/${id}`, {
        headers: { Authorization: `Bearer ${useAuthStore.getState().token}` }
      });
      if (res.data.success) {
        fetchData();
      }
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Failed to delete entry");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCashOut = async (id: string) => {
    if (!id) {
      Alert.alert("Error", "Invalid entry ID");
      return;
    }

    if (Platform.OS === 'web') {
      if (window.confirm("Are you sure you want to delete this cash out entry?")) {
        executeDeleteCashOut(id);
      }
    } else {
      Alert.alert("Confirm", "Are you sure you want to delete this cash out entry?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => executeDeleteCashOut(id) }
      ]);
    }
  };

  const handlePrintReport = async () => {
    try {
      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Inter', -apple-system, sans-serif; padding: 20px; color: #1F2937; }
              h1 { text-align: center; font-size: 22px; margin-bottom: 5px; color: #1F2937; font-weight: 900; }
              .header { text-align: center; margin-bottom: 20px; font-size: 13px; color: #6B7280; }
              .section { margin-bottom: 20px; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; }
              .section-title { font-size: 14px; font-weight: bold; background: #fff; color: #111827; padding: 12px; border-bottom: 1px solid #E5E7EB; text-transform: uppercase; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
              th { background: #F8FAFC; color: #475569; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #E5E7EB; }
              td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #F3F4F6; font-size: 13px; color: #4B5563; font-weight: 500; }
              th.right, td.right { text-align: right; }
              .bold { font-weight: bold; }
              .total-row td { background: #FAFAFA; font-weight: bold; font-size: 14px; color: #111827; }
              .highlight-row td { background: #FAFAFA; color: #C2410C; font-weight: 800; font-size: 14px; border-top: 1px solid #E5E7EB; border-bottom: none; }
              .success { color: #10B981 !important; }
              .danger { color: #EF4444 !important; }
              .label-total { color: #C2410C; font-size: 14px; font-weight: bold; }
            </style>
          </head>
          <body>
            <h1>Settlement Report</h1>
            <div class="header">
              ${selectedTerminal !== "ALL" ? `Terminal: ${selectedTerminal} <br>` : ""}
              Date: ${fromDate.toLocaleString()} to ${toDate.toLocaleString()}
            </div>

            <div class="section">
              <div class="section-title">Summary</div>
              <table>
                <tr><td>Opening Amount</td><td class="right">${formatCurrency(displayOpeningAmount)}</td></tr>
                <tr><td>Cash Out</td><td class="right">${formatCurrency(totalCashOut)}</td></tr>
                <tr><td>Total Expected Cash</td><td class="right">${formatCurrency(sysCash)}</td></tr>
                <tr><td>Counted Cash</td><td class="right">${formatCurrency(totalClosing)}</td></tr>
                <tr class="total-row"><td>Variance</td><td class="right">${formatCurrency(totalClosing - sysCash)}</td></tr>
              </table>
            </div>

            <div class="section">
              <div class="section-title">Sales Summary</div>
              <table>
                <tr><td>Sales Total</td><td class="right">${formatCurrency(totalSales.SubTotal)}</td></tr>
                <tr><td>Total Discount</td><td class="right">${formatCurrency(totalSales.DiscountAmount)}</td></tr>
                <tr><td>Service Charge</td><td class="right">${formatCurrency(totalSales.ServiceCharge)}</td></tr>
                <tr><td>GST</td><td class="right">${formatCurrency(totalSales.TotalTax)}</td></tr>
                <tr><td>Round Off</td><td class="right">${formatCurrency(totalSales.RoundedBy)}</td></tr>
                <tr><td>Tips</td><td class="right">${formatCurrency(totalSales.Tips)}</td></tr>
                <tr class="highlight-row"><td>Net Sales</td><td class="right">${formatCurrency(netSales)}</td></tr>
              </table>
            </div>

            <div class="section">
              <div class="section-title">Sales & Transactions</div>
              <table>
                <tr><th>Paymode</th><th class="right">Cash In</th><th class="right">Cash Out</th></tr>
                <tr><td>Opening Balance</td><td class="right success">${formatCurrency(displayOpeningAmount)}</td><td class="right">0.00</td></tr>
                ${payments.map(p => `
                  <tr>
                    <td>${p.PaymodeName}</td>
                    <td class="right success">${formatCurrency(p.Amount)}</td>
                    <td class="right"></td>
                  </tr>
                `).join('')}
                ${transactions.map(t => `
                  <tr>
                    <td>${t.TransactionMode}</td>
                    <td class="right ${t.TransactionType === "IN" ? "success" : ""}">${t.TransactionType === "IN" ? formatCurrency(t.Amount) : ""}</td>
                    <td class="right ${t.TransactionType === "OUT" ? "danger" : ""}">${t.TransactionType === "OUT" ? formatCurrency(t.Amount) : ""}</td>
                  </tr>
                `).join('')}
                ${cashOutEntries.map(co => `
                  <tr>
                    <td>${co.Reason || 'Cash Out'}</td>
                    <td class="right"></td>
                    <td class="right danger">${formatCurrency(co.Amount)}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td><span class="label-total">TOTAL</span></td>
                  <td class="right success">${formatCurrency(totalCashIn)}</td>
                  <td class="right danger">${formatCurrency(totalCashOutSum)}</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      if (Platform.OS === 'web') {
        const frame = document.createElement("iframe");
        frame.style.display = "none";
        document.body.appendChild(frame);
        frame.contentWindow?.document.open();
        frame.contentWindow?.document.write(html);
        frame.contentWindow?.document.close();
        setTimeout(() => {
          frame.contentWindow?.print();
          document.body.removeChild(frame);
        }, 500);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        }
      }
    } catch (err) {
      console.error("Print Error", err);
      Alert.alert("Error", "Failed to print report");
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color={Theme.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Settlement</Text>

          {/* <View style={styles.verticalDivider} /> */}

          {/* <View style={styles.filterWrapper}>
            <Text style={styles.filterTitle}>Terminal</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {terminals.map((t, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.filterBtn,
                    selectedTerminal === t.TerminalCode && styles.filterBtnActive,
                  ]}
                  onPress={() => setSelectedTerminal(t.TerminalCode)}
                >
                  <Text
                    style={[
                      styles.filterBtnText,
                      selectedTerminal === t.TerminalCode && styles.filterBtnTextActive,
                    ]}
                  >
                    {t.TerminalName || t.TerminalCode}
                  </Text>
                </TouchableOpacity>
              ))}
              {terminals.length === 0 && (
                <TouchableOpacity
                  style={[styles.filterBtn, selectedTerminal === "ALL" && styles.filterBtnActive]}
                  onPress={() => setSelectedTerminal("ALL")}
                >
                  <Text style={[styles.filterBtnText, selectedTerminal === "ALL" && styles.filterBtnTextActive]}>
                    ALL
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          {/* <View style={styles.verticalDivider} /> */}

          <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 20, alignItems: 'center', marginRight: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12, color: Theme.textSecondary, fontFamily: Fonts.medium }}>From:</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="datetime-local"
                  value={new Date(fromDate.getTime() - fromDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={(e) => setFromDate(new Date(e.target.value))}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: `1px solid ${Theme.border}`,
                    fontFamily: Fonts.medium,
                    fontSize: 13,
                    color: Theme.textPrimary,
                    backgroundColor: '#fff',
                    outline: 'none',
                  }}
                />
              ) : (
                <TouchableOpacity
                  style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: Theme.border, backgroundColor: '#fff' }}
                  onPress={() => setShowFromPicker(true)}
                >
                  <Text style={{ fontFamily: Fonts.medium, color: Theme.textPrimary, fontSize: 13 }}>
                    {fromDate.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              )}
              {showFromPicker && Platform.OS !== 'web' && (
                <DateTimePicker
                  value={fromDate}
                  mode="datetime"
                  display="default"
                  onChange={(event: any, selectedDate?: Date) => {
                    setShowFromPicker(false);
                    if (selectedDate) setFromDate(selectedDate);
                  }}
                />
              )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12, color: Theme.textSecondary, fontFamily: Fonts.medium }}>To:</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="datetime-local"
                  value={new Date(toDate.getTime() - toDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={(e) => setToDate(new Date(e.target.value))}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: `1px solid ${Theme.border}`,
                    fontFamily: Fonts.medium,
                    fontSize: 13,
                    color: Theme.textPrimary,
                    backgroundColor: '#fff',
                    outline: 'none',
                  }}
                />
              ) : (
                <TouchableOpacity
                  style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: Theme.border, backgroundColor: '#fff' }}
                  onPress={() => setShowToPicker(true)}
                >
                  <Text style={{ fontFamily: Fonts.medium, color: Theme.textPrimary, fontSize: 13 }}>
                    {toDate.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              )}
              {showToPicker && Platform.OS !== 'web' && (
                <DateTimePicker
                  value={toDate}
                  mode="datetime"
                  display="default"
                  onChange={(event: any, selectedDate?: Date) => {
                    setShowToPicker(false);
                    if (selectedDate) setToDate(selectedDate);
                  }}
                />
              )}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.confirmBtn, { paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 }]}
              onPress={handlePrintReport}
            >
              <Ionicons name="print-outline" size={18} color="#fff" />
              <Text style={styles.confirmBtnText}>Print Report</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={Theme.primary} />
            <Text style={styles.loadingText}>Fetching Settlement...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* Top Overview Cards */}
            <View style={{ flexDirection: 'row', gap: 15, marginBottom: 15 }}>
              <TouchableOpacity
                style={[styles.card, { flex: 1, padding: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}
                onPress={() => {
                  setLovMode("OPEN");
                  setShowLov(true);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="wallet-outline" size={16} color="#3B82F6" />
                  <Text style={{ fontFamily: Fonts.bold, color: '#1E3A8A', fontSize: 12 }}>Opening Amount</Text>
                </View>
                <Text style={{ fontFamily: Fonts.black, fontSize: 24, color: '#1D4ED8', marginTop: 5 }}>{formatCurrency(displayOpeningAmount)}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.card, { flex: 1, padding: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1 }]}
                onPress={() => setShowCashOutModal(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="remove-circle-outline" size={16} color="#EF4444" />
                  <Text style={{ fontFamily: Fonts.bold, color: '#991B1B', fontSize: 12 }}>Cash Out</Text>
                </View>
                <Text style={{ fontFamily: Fonts.black, fontSize: 24, color: '#B91C1C', marginTop: 5 }}>{formatCurrency(totalCashOut)}</Text>
              </TouchableOpacity>

              {/* <View style={[styles.card, { flex: 1, padding: 15, alignItems: 'center', justifyContent: 'center' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="receipt-outline" size={16} color={Theme.textSecondary} />
                  <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 12 }}>Total Amount</Text>
                </View>
                <Text style={{ fontFamily: Fonts.black, fontSize: 24, color: Theme.primary, marginTop: 5 }}>{formatCurrency(sysCash)}</Text>
              </View> */}

              <View style={[styles.card, { flex: 1, padding: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', borderWidth: 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="trending-up-outline" size={16} color="#10B981" />
                  <Text style={{ fontFamily: Fonts.bold, color: '#166534', fontSize: 12 }}>Net Sales</Text>
                </View>
                <Text style={{ fontFamily: Fonts.black, fontSize: 24, color: '#15803D', marginTop: 5 }}>{formatCurrency(netSales)}</Text>
              </View>

              <TouchableOpacity
                style={[styles.card, { flex: 1, padding: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED', borderColor: '#FED7AA', borderWidth: 1 }]}
                onPress={() => {
                  setLovMode("CLOSE");
                  setShowLov(true);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="calculator-outline" size={16} color="#F97316" />
                  <Text style={{ fontFamily: Fonts.bold, color: '#9A3412', fontSize: 12 }}>Count Cash</Text>
                </View>
                <Text style={{ fontFamily: Fonts.black, fontSize: 24, color: '#C2410C', marginTop: 5 }}>{formatCurrency(totalClosing)}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.grid, isTablet && styles.gridTablet]}>
              {/* === SUMMARY === */}
              <View style={[styles.card, isTablet && styles.cardTablet]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardHeaderTitle}>SUMMARY</Text>
                </View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 1 }]}>Details</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Amount</Text>
                </View>
                <View style={[styles.cardBody, { flex: 1 }]}>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Sales Total</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.SubTotal)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Total Discount</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.DiscountAmount)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Service Charge</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.ServiceCharge)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>GST</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.TotalTax)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Round Off</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.RoundedBy)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Tips</Text>
                    <Text style={styles.rowValue}>{formatCurrency(totalSales.Tips)}</Text>
                  </View>
                  <View style={[styles.row, styles.highlightRow, { marginTop: 'auto' }]}>
                    <Text style={[styles.rowLabel, styles.highlightText]}>Net Sales</Text>
                    <Text style={[styles.rowValue, styles.highlightText]}>{formatCurrency(netSales)}</Text>
                  </View>
                </View>
              </View>

              {/* === SALES SUMMARY === */}
              {/* <View style={[styles.card, isTablet && styles.cardTablet]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardHeaderTitle}>SALES SUMMARY</Text>
                </View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 2 }]}>Paymode</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Sys Amount</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Manual Amount</Text>
                </View>
                <ScrollView style={styles.cardBodyScroll} nestedScrollEnabled> */}
              {/* Opening Cash Row */}
              {/* <TouchableOpacity
                    style={[styles.tableRow, styles.clickableRow, { alignItems: "center" }]}
                    onPress={() => {
                      setLovMode("OPEN");
                      setShowLov(true);
                    }}
                  >
                    <View style={{ flex: 2, flexDirection: "row", alignItems: "center" }}>
                      <Text style={[styles.tableCellText, { fontFamily: Fonts.bold, color: Theme.textSecondary }]}>OPENING AMOUNT</Text>
                      <Ionicons name="create-outline" size={14} color={Theme.textSecondary} style={{ marginLeft: 6 }} />
                    </View>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}></Text>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", fontFamily: Fonts.bold, color: Theme.textSecondary }]}>
                      {formatCurrency(displayOpeningAmount)}
                    </Text>
                  </TouchableOpacity> */}

              {/* Hardcoded CASH Row */}
              {/* <TouchableOpacity
                    style={[styles.tableRow, styles.clickableRow, { alignItems: "center" }]}
                    onPress={() => {
                      setLovMode("CLOSE");
                      setShowLov(true);
                    }}
                  >
                    <View style={{ flex: 2, flexDirection: "row", alignItems: "center" }}>
                      <Text style={[styles.tableCellText, { fontFamily: Fonts.bold, color: Theme.primary }]}>CASH</Text>
                      <Ionicons name="create-outline" size={14} color={Theme.primary} style={{ marginLeft: 6 }} />
                    </View>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}>
                      {formatCurrency(sysCash)}
                    </Text>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", fontFamily: Fonts.bold }]}>
                      {formatCurrency(totalClosing)}
                    </Text>
                  </TouchableOpacity> */}

              {/* Cash Out Row */}
              {/* <TouchableOpacity
                    style={[styles.tableRow, styles.clickableRow, { alignItems: "center" }]}
                    onPress={() => setShowCashOutModal(true)}
                  >
                    <View style={{ flex: 2, flexDirection: "row", alignItems: "center" }}>
                      <Text style={[styles.tableCellText, { fontFamily: Fonts.bold, color: Theme.danger }]}>CASH OUT</Text>
                      <Ionicons name="create-outline" size={14} color={Theme.danger} style={{ marginLeft: 6 }} />
                    </View>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}></Text>
                    <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", fontFamily: Fonts.bold, color: Theme.danger }]}>
                      {formatCurrency(totalCashOut)}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
                <View style={styles.cardFooter}>
                  <Text style={styles.footerLabel}>Total</Text>
                  <Text style={styles.footerValue}>{formatCurrency(totalClosing)}</Text>
                </View>
                </View>
              </View> */}

              {/* === SALES === */}
              <View style={[styles.card, isTablet && styles.cardTablet]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardHeaderTitle}>SALES</Text>
                </View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 2 }]}>Paymode</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Cash In</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>Cash Out</Text>
                </View>
                <ScrollView style={styles.cardBodyScroll} nestedScrollEnabled>
                  {displayOpeningAmount > 0 && (
                    <View style={styles.tableRow}>
                      <Text style={[styles.tableCellText, { flex: 2 }]}>Opening Balance</Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", color: Theme.success }]}>
                        +{formatCurrency(displayOpeningAmount)}
                      </Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}>
                        0.00
                      </Text>
                    </View>
                  )}
                  {cashOutEntries.map((co, i) => (
                    <TouchableOpacity
                      key={`co-${i}`}
                      style={[styles.tableRow, { alignItems: 'center' }]}
                      activeOpacity={0.7}
                      onPress={() => {
                        setCashOutForm({ ...co, CashOutId: co.CashOutId || co.cashOutId, Amount: co.Amount?.toString() || '' });
                        setShowCashOutModal(true);
                      }}
                    >
                      <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.tableCellText}>{co.Reason || 'Cash Out'}</Text>
                        <Ionicons name="create-outline" size={14} color={Theme.textPrimary} style={{ marginLeft: 6 }} />
                      </View>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}>
                        0.00
                      </Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", color: Theme.danger }]}>
                        -{formatCurrency(co.Amount)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {transactions.map((t, i) => (
                    <View key={`trans-${i}`} style={styles.tableRow}>
                      <Text style={[styles.tableCellText, { flex: 2 }]}>{t.TransactionMode}</Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", color: t.TransactionType === "IN" ? Theme.success : undefined }]}>
                        {t.TransactionType === "IN" ? `+${formatCurrency(t.Amount)}` : "0.00"}
                      </Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", color: t.TransactionType === "OUT" ? Theme.danger : undefined }]}>
                        {t.TransactionType === "OUT" ? `-${formatCurrency(t.Amount)}` : "0.00"}
                      </Text>
                    </View>
                  ))}
                  {payments.map((p, i) => (
                    <View key={`pay-${i}`} style={styles.tableRow}>
                      <Text style={[styles.tableCellText, { flex: 2 }]}>{p.PaymodeName}</Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right", color: Theme.success }]}>+{formatCurrency(p.Amount)}</Text>
                      <Text style={[styles.tableCellText, { flex: 1, textAlign: "right" }]}></Text>
                    </View>
                  ))}
                  {payments.length === 0 && displayOpeningAmount === 0 && transactions.length === 0 && cashOutEntries.length === 0 && <Text style={styles.emptyText}>No sales</Text>}
                </ScrollView>
                <View style={{ flexDirection: "row", paddingVertical: 12, paddingHorizontal: 12, backgroundColor: "#FAFAFA", borderTopWidth: 1, borderTopColor: Theme.border, alignItems: "center" }}>
                  <View style={{ flex: 2, alignItems: 'flex-end', paddingRight: 15 }}>
                    <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.primaryDark }}>TOTAL</Text>
                  </View>
                  <Text style={{ flex: 1, textAlign: "right", fontFamily: Fonts.black, fontSize: 14, color: Theme.success }}>
                    {formatCurrency(totalCashIn)}
                  </Text>
                  <Text style={{ flex: 1, textAlign: "right", fontFamily: Fonts.black, fontSize: 14, color: Theme.danger }}>
                    {formatCurrency(totalCashOutSum)}
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Cash Denominations Modal */}
      <Modal
        visible={showLov}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLov(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={() => setShowLov(false)}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Denomination</Text>
              <TouchableOpacity onPress={() => setShowLov(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalDivider} />

            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { flex: 1 }]}>Currency Value</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "right" }]}>No.Of Currencies</Text>
            </View>

            <ScrollView style={styles.modalList} nestedScrollEnabled>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>
                  {lovMode === "OPEN" ? "Opening Cash Notes" : "Count All Cash Notes"}
                </Text>
              </View>
              {denominations.filter(d => d >= 1).map((denom, i) => {
                const denomStr = denom.toFixed(2);
                const val = lovMode === "OPEN" ? openingCounts[denomStr] : closingCounts[denomStr];
                return (
                  <View key={`note-${i}`} style={[styles.tableRow, { alignItems: "center" }]}>
                    <Text style={[styles.tableCellText, { flex: 1 }]}>{denomStr}</Text>
                    <TextInput
                      style={styles.currencyInput}
                      keyboardType="numeric"
                      value={val || ""}
                      onChangeText={(v) => handleCountChange(denomStr, v)}
                      placeholder="0"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>
                );
              })}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>
                  {lovMode === "OPEN" ? "Opening Cash Coins" : "Count All Cash Coins"}
                </Text>
              </View>
              {denominations.filter(d => d < 1).map((denom, i) => {
                const denomStr = denom.toFixed(2);
                const val = lovMode === "OPEN" ? openingCounts[denomStr] : closingCounts[denomStr];
                return (
                  <View key={`coin-${i}`} style={[styles.tableRow, { alignItems: "center" }]}>
                    <Text style={[styles.tableCellText, { flex: 1 }]}>{denomStr}</Text>
                    <TextInput
                      style={styles.currencyInput}
                      keyboardType="numeric"
                      value={val || ""}
                      onChangeText={(v) => handleCountChange(denomStr, v)}
                      placeholder="0"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.modalDivider} />

            <View style={styles.modalFooter}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary }}>Total Cash:</Text>
                <Text style={{ fontFamily: Fonts.black, fontSize: 18, color: Theme.primary }}>
                  {formatCurrency(lovMode === "OPEN" ? totalOpening : totalClosing)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={[styles.confirmBtn, { flex: 1, backgroundColor: Theme.bgMuted }]}
                  onPress={handleClearDenominations}
                >
                  <Text style={[styles.confirmBtnText, { color: Theme.textPrimary }]}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, { flex: 1 }]}
                  onPress={handleSaveDenominations}
                >
                  <Text style={styles.confirmBtnText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cash Out Modal */}
      <Modal
        visible={showCashOutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCashOutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowCashOutModal(false)}
          />
          <View style={[styles.modalContent, { maxWidth: 600, width: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Manage Cash Out</Text>
              <TouchableOpacity onPress={() => setShowCashOutModal(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalDivider} />

            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingVertical: 5 }} showsVerticalScrollIndicator={false}>
              {/* List of Today's Cash Out */}
              <View style={{ marginBottom: 15 }}>
                {/* <Text style={{ fontFamily: Fonts.bold, marginBottom: 8, color: Theme.textPrimary }}>Today's Entries</Text> */}
                {cashOutEntries.length > 0 ? (
                  <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                    {cashOutEntries.map((co, idx) => (
                      <View key={idx} style={[styles.tableRow, { alignItems: 'center' }]}>
                        <Text style={[styles.tableCellText, { flex: 2 }]}>{co.Reason || 'Cash Out'}</Text>
                        <Text style={[styles.tableCellText, { flex: 1, textAlign: 'right', paddingRight: 15 }]}>{formatCurrency(co.Amount)}</Text>
                        <View style={{ flexDirection: 'row', gap: 15, width: 60, justifyContent: 'flex-end' }}>
                          <TouchableOpacity onPress={() => setCashOutForm({ ...co, CashOutId: co.CashOutId || co.cashOutId, Amount: co.Amount?.toString() || '' })}>
                            <Ionicons name="create-outline" size={18} color={Theme.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteCashOut(co.CashOutId || co.cashOutId)}>
                            <Ionicons name="trash-outline" size={18} color={Theme.danger} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={{ paddingVertical: 15, alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: 8, borderWidth: 1, borderColor: Theme.border }}>
                    <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textMuted }}>No cash out entries found for the selected time period.</Text>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 15, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 13, marginBottom: 6, color: Theme.textSecondary }}>Amount *</Text>
                  <TextInput
                    style={[styles.premiumInput, { textAlign: 'right', fontSize: 18 }]}
                    keyboardType="numeric"
                    value={cashOutForm.Amount}
                    onChangeText={(v) => setCashOutForm({ ...cashOutForm, Amount: v })}
                    placeholder="0.00"
                    placeholderTextColor={Theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 13, marginBottom: 6, color: Theme.textSecondary }}>Payment Mode</Text>
                  <TextInput
                    style={[styles.premiumInput, { fontFamily: Fonts.medium }]}
                    value={cashOutForm.PaymentMode}
                    onChangeText={(v) => setCashOutForm({ ...cashOutForm, PaymentMode: v })}
                    placeholder="Cash"
                    placeholderTextColor={Theme.textMuted}
                  />
                </View>
              </View>

              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontFamily: Fonts.bold, fontSize: 13, marginBottom: 6, color: Theme.textSecondary }}>Reason</Text>
                <TextInput
                  style={[styles.premiumInput, { fontFamily: Fonts.medium }]}
                  value={cashOutForm.Reason}
                  onChangeText={(v) => setCashOutForm({ ...cashOutForm, Reason: v })}
                  // placeholder="e.g. Supplier Payment"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>

              {/* <View style={{ marginBottom: 15 }}>
                <Text style={{ fontFamily: Fonts.medium, fontSize: 12, marginBottom: 4 }}>Remarks</Text>
                <TextInput
                  style={[styles.currencyInput, { height: 60, textAlignVertical: 'top', textAlign: 'left', fontFamily: Fonts.medium }]}
                  multiline
                  value={cashOutForm.Remarks}
                  onChangeText={(v) => setCashOutForm({ ...cashOutForm, Remarks: v })}
                  placeholder="Additional notes..."
                />
              </View> */}
            </ScrollView>

            <View style={[styles.modalFooter, { flexDirection: 'row', gap: 10 }]}>
              <TouchableOpacity
                style={[styles.confirmBtn, { flex: 1, backgroundColor: Theme.bgMuted }]}
                onPress={() => setCashOutForm({ CashOutId: '', Amount: '', Reason: '', Remarks: '', PaymentMode: 'Cash', ReferenceNo: '' })}
              >
                <Text style={[styles.confirmBtnText, { color: Theme.textPrimary }]}>Clear Form</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { flex: 1 }]}
                onPress={handleSaveCashOut}
              >
                <Text style={styles.confirmBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Theme.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  verticalDivider: {
    width: 1,
    height: 20,
    backgroundColor: Theme.border,
  },
  filterWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterTitle: {
    fontSize: 11,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    textTransform: "uppercase",
  },
  filterScroll: {
    gap: 6,
    alignItems: "center",
  },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  filterBtnActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  filterBtnText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  filterBtnTextActive: {
    color: "#fff",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  content: {
    padding: 12,
  },
  grid: {
    flexDirection: "column",
    gap: 12,
  },
  gridTablet: {
    flexDirection: "row",
    gap: 12,
  },
  card: {
    backgroundColor: Theme.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    overflow: "hidden",
    width: "100%",
  },
  cardTablet: {
    flex: 1, // Distribute evenly in a single row
  },
  cardHeader: {
    backgroundColor: Theme.bgCard,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  cardHeaderTitle: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  cardBody: {
    padding: 12,
  },
  cardBodyScroll: {
    height: 280,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  rowLabel: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  rowValue: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  highlightRow: {
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    borderBottomWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginHorizontal: -12,
    marginBottom: -12,
  },
  highlightText: {
    color: Theme.primaryDark,
    fontFamily: Fonts.black,
    fontSize: 14,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: '#F8FAFC', // Very subtle cool gray
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  tableHeaderText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  tableCellText: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  currencyInput: {
    flex: 1,
    height: 32,
    borderWidth: 1,
    borderColor: Theme.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    backgroundColor: Theme.bgInput,
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    textAlign: "right",
  },
  premiumInput: {
    height: 52,
    backgroundColor: '#F4F5F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    width: "90%",
    maxWidth: 400,
    maxHeight: "80%",
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    padding: 16,
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  modalDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 12,
  },
  modalList: {
    maxHeight: 300,
  },
  sectionHeader: {
    backgroundColor: Theme.bgMuted,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 4,
  },
  sectionHeaderText: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: Theme.textSecondary,
    textTransform: "uppercase",
  },
  modalFooter: {
    marginTop: 8,
  },
  confirmBtn: {
    backgroundColor: Theme.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    ...Theme.shadowMd,
  },
  confirmBtnText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 14,
  },
  clickableRow: {
    backgroundColor: Theme.primaryLight,
    borderLeftWidth: 4,
    borderLeftColor: Theme.primary,
    paddingHorizontal: 8,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: 20,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    fontStyle: "italic",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: 8,
    backgroundColor: "#FAFAFA",
    borderTopWidth: 1,
    borderTopColor: Theme.border,
  },
  footerLabel: {
    backgroundColor: Theme.bgMuted,
    paddingVertical: 4,
    paddingHorizontal: 12,
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.primaryDark,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  footerValue: {
    backgroundColor: Theme.bgCard,
    paddingVertical: 4,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.primaryDark,
    borderWidth: 1,
    borderColor: Theme.border,
    borderLeftWidth: 0,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    minWidth: 80,
    textAlign: "right",
  },
});
