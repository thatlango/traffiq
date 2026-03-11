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

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [recentReports, setRecentReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);

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
    const updated = recentReports.map(r => r.id === reportId ? { ...r, confirmed: r.confirmed + 1 } : r);
    setRecentReports(updated);
    await AsyncStorage.setItem("@roadwatch_reports", JSON.stringify(updated));
  };

  const incidentType = INCIDENT_TYPES.find(t => t.key === selectedType);

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
          <Text style={styles.successSub}>Thank you for keeping roads safe. Nearby users have been alerted.</Text>
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
            <Feather name="send" size={20} color={selectedType ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.submitText, !selectedType && { color: Colors.textMuted }]}>
              {loading ? "Submitting..." : "Submit Report"}
            </Text>
          </Pressable>
        </>
      )}

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Reports</Text>
          {recentReports.slice(0, 8).map(report => {
            const type = INCIDENT_TYPES.find(t => t.key === report.type);
            return (
              <View key={report.id} style={styles.reportCard}>
                <View style={[styles.reportIcon, { backgroundColor: (type?.color ?? Colors.warning) + "22" }]}>
                  <Feather name={(type?.icon ?? "alert-triangle") as any} size={20} color={type?.color ?? Colors.warning} />
                </View>
                <View style={styles.reportInfo}>
                  <Text style={styles.reportType}>{type?.label ?? report.type}</Text>
                  {report.description ? <Text style={styles.reportDesc} numberOfLines={1}>{report.description}</Text> : null}
                  <Text style={styles.reportTime}>{new Date(report.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                </View>
                <Pressable onPress={() => handleConfirm(report.id)} style={styles.confirmBtn}>
                  <Feather name="thumbs-up" size={14} color={Colors.textSecondary} />
                  <Text style={styles.confirmCount}>{report.confirmed}</Text>
                </Pressable>
              </View>
            );
          })}
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
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
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
  successSub: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, textAlign: "center" },
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
