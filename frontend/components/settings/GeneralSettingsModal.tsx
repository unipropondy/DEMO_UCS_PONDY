import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "@/constants/theme";
import { Fonts } from "@/constants/Fonts";
import { useGeneralSettingsStore } from "@/stores/generalSettingsStore";
import { useToast } from "../Toast";

interface GeneralSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

// ── CUSTOM ANIMATED SWITCH COMPONENT ──
interface CustomSwitchProps {
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
}

const CustomSwitch = ({ value, onValueChange, disabled = false }: CustomSwitchProps) => {
  const animatedValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false, // Animating backgroundColor requires false
    }).start();
  }, [value]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 28], // Switch is 58px wide, Thumb is 26px. Slide range: 4px to 28px.
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["#E2E8F0", Theme.primary],
  });

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={() => !disabled && onValueChange(!value)}
      style={styles.switchTouchArea}
    >
      <Animated.View
        style={[
          styles.switchContainer,
          { backgroundColor },
          disabled && { opacity: 0.5 },
        ]}
      >
        <Animated.View
          style={[
            styles.switchThumb,
            { transform: [{ translateX }] },
          ]}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

// ── MAIN MODAL COMPONENT ──
export default function GeneralSettingsModal({
  visible,
  onClose,
}: GeneralSettingsModalProps) {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 500;
  
  const { settings, loading, updateSettings } = useGeneralSettingsStore();

  const [enableKOT, setEnableKOT] = useState(settings.enableKOT);
  const [enableKDS, setEnableKDS] = useState(settings.enableKDS);
  const [enableCheckoutBill, setEnableCheckoutBill] = useState(settings.enableCheckoutBill);
  
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  const { showToast } = useToast();

  // Entrance animations
  const modalScale = useRef(new Animated.Value(0.95)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;
  
  // Confirmation Overlay animations
  const confirmScale = useRef(new Animated.Value(0.95)).current;
  const confirmOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setEnableKOT(settings.enableKOT);
      setEnableKDS(settings.enableKDS);
      setEnableCheckoutBill(settings.enableCheckoutBill);
      
      Animated.parallel([
        Animated.timing(modalScale, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.back(1.1)),
          useNativeDriver: true,
        }),
        Animated.timing(modalOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      modalScale.setValue(0.95);
      modalOpacity.setValue(0);
    }
  }, [visible, settings]);

  useEffect(() => {
    if (showConfirmDialog) {
      Animated.parallel([
        Animated.timing(confirmScale, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.back(1.0)),
          useNativeDriver: true,
        }),
        Animated.timing(confirmOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      confirmScale.setValue(0.95);
      confirmOpacity.setValue(0);
    }
  }, [showConfirmDialog]);

  const handleSave = () => {
    setShowConfirmDialog(true);
  };

  const performSave = async () => {
    setShowConfirmDialog(false);
    setIsSaving(true);
    
    const success = await updateSettings({
      enableKOT,
      enableKDS,
      enableCheckoutBill,
    });
    
    setIsSaving(false);

    if (success) {
      showToast({ type: "success", message: "POS Settings updated successfully." });
      onClose();
    } else {
      showToast({ type: "error", message: "Failed to update settings. Please try again." });
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: modalOpacity }]}>
        <Animated.View
          style={[
            styles.modalContent,
            isTablet && { width: "65%", maxWidth: 640 },
            { transform: [{ scale: modalScale }] }
          ]}
        >
          {/* Top Brand Stripe */}
          <View style={styles.topAccentBar} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <View style={styles.settingsIconBg}>
                <Ionicons name="settings" size={20} color={Theme.primary} />
              </View>
              <View>
                <Text style={styles.headerTitle}>General Settings</Text>
                <Text style={styles.headerSubtitle}>Configure global system preferences and feature toggles</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={Theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View style={styles.body}>
            {/* CARD 1: KOT */}
            <View style={[styles.settingCard, enableKOT && styles.settingCardActive]}>
              <View style={styles.cardLeft}>
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.iconWrapper, enableKOT ? styles.iconWrapperActive : styles.iconWrapperInactive]}>
                    <Ionicons name="receipt-outline" size={20} color={enableKOT ? Theme.primary : Theme.textSecondary} />
                  </View>
                  <Text style={styles.settingTitle}>KOT (Kitchen Order Ticket)</Text>
                  <View style={[styles.statusBadge, enableKOT ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                    <View style={[styles.statusDot, enableKOT ? styles.statusDotActive : styles.statusDotInactive]} />
                    <Text style={[styles.statusBadgeText, enableKOT ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive]}>
                      {enableKOT ? "Active" : "Disabled"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.settingDesc}>
                  Enable or disable Kitchen Order Ticket printing and generation globally for all tables. When OFF, orders are sent to kitchen digitally without physical receipts.
                </Text>
              </View>
              <CustomSwitch value={enableKOT} onValueChange={setEnableKOT} />
            </View>

            {/* CARD 2: KDS */}
            <View style={[styles.settingCard, enableKDS && styles.settingCardActive]}>
              <View style={styles.cardLeft}>
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.iconWrapper, enableKDS ? styles.iconWrapperActive : styles.iconWrapperInactive]}>
                    <Ionicons name="desktop-outline" size={20} color={enableKDS ? Theme.primary : Theme.textSecondary} />
                  </View>
                  <Text style={styles.settingTitle}>KDS (Kitchen Display System)</Text>
                  <View style={[styles.statusBadge, enableKDS ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                    <View style={[styles.statusDot, enableKDS ? styles.statusDotActive : styles.statusDotInactive]} />
                    <Text style={[styles.statusBadgeText, enableKDS ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive]}>
                      {enableKDS ? "Active" : "Disabled"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.settingDesc}>
                  Show or hide incoming order tickets on the Kitchen Display System (KDS) screen. When OFF, the KDS tab is dynamically hidden from the navigation bar.
                </Text>
              </View>
              <CustomSwitch value={enableKDS} onValueChange={setEnableKDS} />
            </View>

            {/* CARD 3: Checkout Bill */}
            <View style={[styles.settingCard, enableCheckoutBill && styles.settingCardActive]}>
              <View style={styles.cardLeft}>
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.iconWrapper, enableCheckoutBill ? styles.iconWrapperActive : styles.iconWrapperInactive]}>
                    <Ionicons name="wallet-outline" size={20} color={enableCheckoutBill ? Theme.primary : Theme.textSecondary} />
                  </View>
                  <Text style={styles.settingTitle}>Checkout Bill</Text>
                  <View style={[styles.statusBadge, enableCheckoutBill ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                    <View style={[styles.statusDot, enableCheckoutBill ? styles.statusDotActive : styles.statusDotInactive]} />
                    <Text style={[styles.statusBadgeText, enableCheckoutBill ? styles.statusBadgeTextActive : styles.statusBadgeTextInactive]}>
                      {enableCheckoutBill ? "Active" : "Disabled"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.settingDesc}>
                  Control final guest receipt printing during checkout. When OFF, checking out a table completes the transaction and skips printing the receipt copy.
                </Text>
              </View>
              <CustomSwitch value={enableCheckoutBill} onValueChange={setEnableCheckoutBill} />
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSaving || loading}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.saveBtn, (isSaving || loading) && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={isSaving || loading}
              activeOpacity={0.8}
            >
              {isSaving || loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={styles.saveBtnText}>Save Settings</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ── CUSTOM CONFIRMATION OVERLAY ── */}
          {showConfirmDialog && (
            <Animated.View style={[styles.confirmOverlay, { opacity: confirmOpacity }]}>
              <Animated.View
                style={[
                  styles.confirmCard,
                  { transform: [{ scale: confirmScale }] }
                ]}
              >
                <View style={styles.confirmIconContainer}>
                  <Ionicons name="alert-circle" size={36} color={Theme.warning} />
                </View>
                
                <Text style={styles.confirmTitle}>Confirm Global Changes</Text>
                
                <Text style={styles.confirmDesc}>
                  Are you sure you want to update the general settings? These changes will apply globally to all users and printers in the system.
                </Text>
                
                <View style={styles.confirmActions}>
                  <TouchableOpacity
                    style={styles.confirmBtnCancel}
                    onPress={() => setShowConfirmDialog(false)}
                    disabled={isSaving}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.confirmBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.confirmBtnSave}
                    onPress={performSave}
                    disabled={isSaving}
                    activeOpacity={0.8}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.confirmBtnSaveText}>Save Changes</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Overlay & Modal Card
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)", // Modern Slate dim
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 24,
    width: "100%",
    maxWidth: 480,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  topAccentBar: {
    height: 4,
    backgroundColor: Theme.primary,
    width: "100%",
  },
  
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  headerTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  settingsIconBg: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Theme.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  
  // Body & Setting Cards
  body: {
    padding: 24,
    gap: 16,
  },
  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: "#FAF9F6", // Light clean cream
    gap: 16,
  },
  settingCardActive: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
  },
  cardLeft: {
    flex: 1,
    gap: 8,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  iconWrapperActive: {
    backgroundColor: "rgba(249,115,22,0.18)",
  },
  iconWrapperInactive: {
    backgroundColor: "#E2E8F0",
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
  },
  settingDesc: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    lineHeight: 18,
  },
  
  // Status Badges & Dots
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeActive: {
    backgroundColor: "rgba(34,197,94,0.08)",
    borderColor: "rgba(34,197,94,0.2)",
  },
  statusBadgeInactive: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: "#22C55E",
  },
  statusDotInactive: {
    backgroundColor: "#94A3B8",
  },
  statusBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  statusBadgeTextActive: {
    color: "#16A34A",
  },
  statusBadgeTextInactive: {
    color: "#64748B",
  },

  // Custom Switch Styles
  switchTouchArea: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  switchContainer: {
    width: 58,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 3,
  },
  
  // Footer
  footer: {
    flexDirection: "row",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    backgroundColor: Theme.bgCard,
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: Theme.primary,
    ...Theme.shadowSm,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },

  // ── Custom Confirmation Alert Overlay ──
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.65)", // Dark Slate Backdrop
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 100,
  },
  confirmCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    width: "90%",
    maxWidth: 360,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 15,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  confirmIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginBottom: 8,
    textAlign: "center",
  },
  confirmDesc: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  confirmBtnCancelText: {
    fontSize: 13,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
  },
  confirmBtnSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Theme.primary,
    alignItems: "center",
    ...Theme.shadowSm,
  },
  confirmBtnSaveText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
});
