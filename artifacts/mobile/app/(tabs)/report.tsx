import React, { useState } from "react";
import {
  Alert,
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
import IncidentCard, { INCIDENT_TYPES } from "@/components/IncidentCard";
import Colors from "@/constants/colors";

interface Report {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  confirmed: number;
}

const ALL_FILTER = "all";

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [recentReports, setRecentReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

  React.useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const stored = await AsyncStorage.getItem("@roadwatch_reports");
      if (stored) setRecentReports(JSON.parse(stored));
    } catch {}
  };

  const handleSubmit = async () => {
    if (!selectedType) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Select Incident Type", "Please choose what you're reporting.");
      return;
    }
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const report: Report = {
      id: Date.now().toString(),
      type: selectedType,
      description: description.trim(),
      timestamp: Date.now(),
      confirmed: 0,
    };

    try {
      const stored = await AsyncStorage.getItem("@roadwatch_reports");
      const reports: Report[] = stored ? JSON.parse(stored) : [];
      const updated = [report, ...reports].slice(0, 30);
      await AsyncStorage.setItem("@roadwatch_reports", JSON.stringify(updated));
      setRecentReports(updated);
    } catch {}

    setSubmitted(true);
    setLoading(false);
    setTimeout(() => {
      setSubmitted(false);
      setSelectedType(null);
      setDescription("");
    }, 3000);
  };

  const handleConfirm = async (reportId: string) => {
    Haptics.selectionAsync();
    const updated = recentReports.map(r =>
      r.id === reportId ? { ...r, confirmed: r.confirmed + 1 } : r
    );
    setRecentReports(updated);
    await AsyncStorage.setItem("@roadwatch_reports", JSON.stringify(updated));
  };

  // Determine which filter types appear in recent reports
  const presentTypes = Array.from(new Set(recentReports.map(r => r.type)));

  const filteredReports =
    activeFilter === ALL_FILTER
      ? recentReports
      : recentReports.filter(r => r.type === activeFilter);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 100 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Report Incident</Text>
        <Text style={styles.subtitle}>Help keep roads safe for everyone</Text>
      </View>

      {submitted ? (
        <View style={styles.successCard}>
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={36} color={Colors.success} />
          </View>
          <Text style={styles.successTitle}>Report Submitted</Text>
          <Text style={styles.successSub}>
            Thank you for keeping roads safe. Nearby users have been alerted.
          </Text>
        </View>
      ) : (
        <>
          {/* Incident type grid */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Incident Type</Text>
            <View style={styles.grid}>
              {INCIDENT_TYPES.map(type => (
                <IncidentCard
                  key={type.key}
                  type={type}
                  selected={selectedType === type.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedType(selectedType === type.key ? null : type.key);
                  }}
                />
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Describe what you saw..."
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={loading || !selectedType}
            style={[styles.submitBtn, (!selectedType || loading) && styles.submitBtnDisabled]}
          >
            <Feather
              name="send"
              size={20}
              color={selectedType ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.submitText, !selectedType && { color: Colors.textMuted }]}>
              {loading ? "Submitting..." : "Submit Report"}
            </Text>
          </Pressable>
        </>
      )}

      {/* Recent reports with filter */}
      {recentReports.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Reports</Text>
            <View style={[styles.countBadge, { backgroundColor: Colors.accent + "22" }]}>
              <Text style={[styles.countText, { color: Colors.accent }]}>
                {filteredReports.length}
              </Text>
            </View>
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {/* All chip */}
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setActiveFilter(ALL_FILTER); }}
              style={[styles.filterChip, activeFilter === ALL_FILTER && styles.filterChipActive]}
            >
              <Text style={[styles.filterLabel, activeFilter === ALL_FILTER && styles.filterLabelActive]}>
                All
              </Text>
            </Pressable>

            {/* One chip per type that appears in reports */}
            {INCIDENT_TYPES.filter(t => presentTypes.includes(t.key)).map(type => {
              const isActive = activeFilter === type.key;
              return (
                <Pressable
                  key={type.key}
                  onPress={() => { Haptics.selectionAsync(); setActiveFilter(isActive ? ALL_FILTER : type.key); }}
                  style={[
                    styles.filterChip,
                    isActive && { backgroundColor: type.color + "22", borderColor: type.color },
                  ]}
                >
                  <Feather
                    name={type.icon as any}
                    size={12}
                    color={isActive ? type.color : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.filterLabel,
                      isActive && { color: type.color },
                    ]}
                  >
                    {type.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Report list */}
          {filteredReports.length === 0 ? (
            <View style={styles.emptyFilter}>
              <Feather name="filter" size={20} color={Colors.textMuted} />
              <Text style={styles.emptyFilterText}>No reports match this filter</Text>
            </View>
          ) : (
            filteredReports.slice(0, 10).map(report => {
              const type = INCIDENT_TYPES.find(t => t.key === report.type);
              return (
                <View key={report.id} style={styles.reportCard}>
                  <View
                    style={[
                      styles.reportIcon,
                      { backgroundColor: (type?.color ?? Colors.warning) + "22" },
                    ]}
                  >
                    <Feather
                      name={(type?.icon ?? "alert-triangle") as any}
                      size={20}
                      color={type?.color ?? Colors.warning}
                    />
                  </View>
                  <View style={styles.reportInfo}>
                    <Text style={styles.reportType}>{type?.label ?? report.type}</Text>
                    {report.description ? (
                      <Text style={styles.reportDesc} numberOfLines={1}>
                        {report.description}
                      </Text>
                    ) : null}
                    <Text style={styles.reportTime}>
                      {new Date(report.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleConfirm(report.id)}
                    style={styles.confirmBtn}
                    hitSlop={8}
                  >
                    <Feather name="thumbs-up" size={14} color={Colors.textSecondary} />
                    <Text style={styles.confirmCount}>{report.confirmed}</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 20, gap: 24 },
  header: { gap: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
  section: { gap: 14 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 4,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.accent + "22",
    borderColor: Colors.accent,
  },
  filterLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textSecondary,
  },
  filterLabelActive: {
    color: Colors.accent,
    fontFamily: "Inter_600SemiBold",
  },
  emptyFilter: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 24,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyFilterText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  submitBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 18,
    borderRadius: 20,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  submitBtnDisabled: { backgroundColor: Colors.card, shadowOpacity: 0 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.primary },
  successCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.success + "44",
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.success + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.text },
  successSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  reportCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reportIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  reportInfo: { flex: 1, gap: 2 },
  reportType: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.text },
  reportDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  reportTime: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8 },
  confirmCount: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary },
});
