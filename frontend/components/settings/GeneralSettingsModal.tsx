import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "@/constants/theme";
import { useGeneralSettingsStore } from "@/stores/generalSettingsStore";

interface GeneralSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

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

  useEffect(() => {
    if (visible) {
      setEnableKOT(settings.enableKOT);
      setEnableKDS(settings.enableKDS);
      setEnableCheckoutBill(settings.enableCheckoutBill);
    }
  }, [visible, settings]);

  const handleSave = async () => {
    Alert.alert(
      "Confirm Changes",
      "Are you sure you want to update the general settings? These changes will apply globally to all users.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          style: "destructive",
          onPress: async () => {
            setIsSaving(true);
            const success = await updateSettings({
              enableKOT,
              enableKDS,
              enableCheckoutBill,
            });
            setIsSaving(false);

            if (success) {
              Alert.alert("Success", "Settings updated successfully.");
              onClose();
            } else {
              Alert.alert("Error", "Failed to update settings. Please try again.");
            }
          },
        },
      ]
    );
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[
            styles.modalContent,
            isTablet && { width: "60%", maxWidth: 600 },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Ionicons name="settings" size={24} color={Theme.primary} />
              <Text style={styles.headerTitle}>General Settings</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <View style={styles.body}>
            <View style={styles.settingItem}>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>KOT (Kitchen Order Ticket)</Text>
                <Text style={styles.settingDesc}>Enable or disable Kitchen Order Ticket printing and generation.</Text>
              </View>
              <Switch
                trackColor={{ false: "#d1d5db", true: Theme.primary }}
                thumbColor={Platform.OS === 'ios' ? undefined : enableKOT ? "#fff" : "#f4f3f4"}
                onValueChange={setEnableKOT}
                value={enableKOT}
              />
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>KDS (Kitchen Display System)</Text>
                <Text style={styles.settingDesc}>Show or hide orders on the Kitchen Display System screens.</Text>
              </View>
              <Switch
                trackColor={{ false: "#d1d5db", true: Theme.primary }}
                thumbColor={Platform.OS === 'ios' ? undefined : enableKDS ? "#fff" : "#f4f3f4"}
                onValueChange={setEnableKDS}
                value={enableKDS}
              />
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>Checkout Bill</Text>
                <Text style={styles.settingDesc}>Enable or disable the final Checkout Bill generation and printing.</Text>
              </View>
              <Switch
                trackColor={{ false: "#d1d5db", true: Theme.primary }}
                thumbColor={Platform.OS === 'ios' ? undefined : enableCheckoutBill ? "#fff" : "#f4f3f4"}
                onValueChange={setEnableCheckoutBill}
                value={enableCheckoutBill}
              />
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSaving || loading}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.saveBtn, (isSaving || loading) && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={isSaving || loading}
            >
              {isSaving || loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Save Settings</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: Theme.radiusLg,
    width: "100%",
    maxWidth: 450,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: Theme.bgNav,
  },
  headerTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: Theme.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    padding: 24,
    gap: 24,
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Theme.textPrimary,
    marginBottom: 4,
  },
  settingDesc: {
    fontSize: 13,
    color: Theme.textSecondary,
    lineHeight: 18,
  },
  footer: {
    flexDirection: "row",
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    backgroundColor: Theme.bgNav,
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Theme.radiusMd,
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: Theme.textSecondary,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: Theme.radiusMd,
    backgroundColor: Theme.primary,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#fff",
  },
});
