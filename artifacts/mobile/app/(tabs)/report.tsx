import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { INCIDENT_TYPES } from "@/components/IncidentCard";
import Colors from "@/constants/colors";

const STORAGE_KEY = "@traffiq_reports";

interface Report {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  confirmed: number;
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [successId, setSuccessId] = useState<string | null>(null);

  const successAnim = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(s => {
      if (s) setReports(JSON.parse(s));
    });
  }, []);

  const saveReports = async (updated: Report[]) => {
    setReports(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  // When type is selected, animate the description box in
  const handleTypeSelect = (key: string) => {
    Haptics.selectionAsync();
    const isSame = selectedType === key;
    setSelectedType(isSame ? null : key);
    Animated.spring(expandAnim, {
      toValue: isSame ? 0 : 1,
      tension: 80,
      friction: 12,
      useNativeDriver: false,
    }).start();
    if (isSame) setDescription("");
  };

  const handleSubmit = async () => {
    if (!selectedType) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const report: Report = {
      id: Date.now().toString(),
      type: selectedType,
      description: description.trim(),
      timestamp: Date.now(),
      confirmed: 0,
    };

    const updated = [report, ...reports].slice(0, 30);
    await saveReports(updated);

    // Flash success then reset
    setSuccessId(report.id);
    Animated.sequence([
      Animated.timing(successAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(successAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setSuccessId(null));

    setSelectedType(null);
    setDescription("");
    expandAnim.setValue(0);
  };

  const handleConfirm = async (id: string) => {
    Haptics.selectionAsync();
    const updated = reports.map(r => r.id === id ? { ...r, confirmed: r.confirmed + 1 } : r);
    await saveReports(updated);
  };

  const descHeight = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 120] });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 100 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Report</Text>
        <Text style={styles.subtitle}>Tap an incident to report it instantly</Text>
      </View>

      {/* Success toast */}
      <Animated.View style={[styles.toast, { opacity: successAnim, transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <Feather name="check-circle" size={18} color={Colors.success} />
        <Text style={styles.toastText}>Report submitted — community alerted</Text>
      </Animated.View>

      {/* Incident type grid — 3 columns */}
      <View style={styles.grid}>
        {INCIDENT_TYPES.map(type => {
          const isSelected = selectedType === type.key;
          return (
            <Pressable
              key={type.key}
              onPress={() => handleTypeSelect(type.key)}
              style={({ pressed }) => [
                styles.typeCard,
                isSelected && { backgroundColor: type.color + "25", borderColor: type.color },
                pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
              ]}
            >
              <View style={[styles.typeIcon, { backgroundColor: type.color + "20" }]}>
                <Feather name={type.icon as any} size={24} color={type.color} />
              </View>
              <Text style={[styles.typeLabel, isSelected && { color: type.color }]} numberOfLines={1}>
                {type.label}
              </Text>
              {isSelected && (
                <View style={[styles.selectedDot, { backgroundColor: type.color }]} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Expandable description + submit */}
      <Animated.View style={[styles.expandBox, { height: descHeight, overflow: "hidden" }]}>
        {selectedType && (
          <View style={styles.expandInner}>
            <TextInput
              style={styles.input}
              placeholder="Add details (optional)..."
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Pressable
              onPress={handleSubmit}
              style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }]}
            >
              <Feather name="send" size={18} color={Colors.primary} />
              <Text style={styles.submitText}>Send Report</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>

      {/* Recent reports */}
      {reports.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent · {reports.length}</Text>
          {reports.slice(0, 10).map(report => {
            const type = INCIDENT_TYPES.find(t => t.key === report.type);
            return (
              <View key={report.id} style={[styles.reportRow, report.id === successId && { borderColor: Colors.success + "55" }]}>
                <View style={[styles.reportIcon, { backgroundColor: (type?.color ?? Colors.warning) + "20" }]}>
                  <Feather name={(type?.icon ?? "alert-triangle") as any} size={18} color={type?.color ?? Colors.warning} />
                </View>
                <View style={styles.reportMeta}>
                  <Text style={styles.reportType}>{type?.label ?? report.type}</Text>
                  {report.description ? (
                    <Text style={styles.reportDesc} numberOfLines={1}>{report.description}</Text>
                  ) : null}
                  <Text style={styles.reportTime}>{timeAgo(report.timestamp)}</Text>
                </View>
                <Pressable onPress={() => handleConfirm(report.id)} style={styles.confirmBtn} hitSlop={10}>
                  <Feather name="thumbs-up" size={14} color={report.confirmed > 0 ? Colors.accent : Colors.textMuted} />
                  {report.confirmed > 0 && (
                    <Text style={styles.confirmCount}>{report.confirmed}</Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {reports.length === 0 && (
        <View style={styles.empty}>
          <Feather name="map-pin" size={28} color={Colors.textMuted} />
          <Text style={styles.emptyText}>No reports yet. Be the first to report an incident.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 16, gap: 20 },
  header: { gap: 4, paddingHorizontal: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.success + "20",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.success + "40",
    marginHorizontal: 4,
  },
  toastText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.success, flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 4 },
  typeCard: {
    width: "31%",
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    position: "relative",
  },
  typeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  typeLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.text,
    textAlign: "center",
  },
  selectedDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  expandBox: { marginHorizontal: 4 },
  expandInner: { gap: 10, paddingTop: 4 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    flex: 1,
  },
  submitBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.primary },
  section: { gap: 10, paddingHorizontal: 4 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reportIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  reportMeta: { flex: 1, gap: 2 },
  reportType: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.text },
  reportDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  reportTime: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  confirmCount: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.accent },
  empty: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 21,
  },
});
