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
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { INCIDENT_TYPES } from "@/components/IncidentCard";
import Colors from "@/constants/colors";

export const REPORTS_KEY = "@traffiq_reports";

export interface StoredReport {
  id: string;
  type: string;
  description: string;
  licensePlate?: string;
  timestamp: number;
  confirmed: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  locationLabel?: string;
}

function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function coordLabel(lat?: number, lng?: number) {
  if (!lat || !lng) return null;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "acquired" | "failed">("idle");
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  const successAnim = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(REPORTS_KEY).then(s => {
      if (s) setReports(JSON.parse(s));
    });
    // Pre-acquire GPS in background
    acquireGps();
  }, []);

  const acquireGps = async () => {
    try {
      if (Platform.OS === "web") { setGpsStatus("acquired"); return; }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setGpsStatus("failed"); return; }
      setGpsStatus("acquiring");
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setCurrentCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? 0 });
      setGpsStatus("acquired");
    } catch {
      setGpsStatus("failed");
    }
  };

  const saveReports = async (updated: StoredReport[]) => {
    setReports(updated);
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(updated));
  };

  const handleTypeSelect = (key: string) => {
    Haptics.selectionAsync();
    const isSame = selectedType === key;
    setSelectedType(isSame ? null : key);
    if (isSame) { setDescription(""); setLicensePlate(""); }
    Animated.spring(expandAnim, {
      toValue: isSame ? 0 : 1,
      tension: 80, friction: 12, useNativeDriver: false,
    }).start();
  };

  const selectedIncident = INCIDENT_TYPES.find(t => t.key === selectedType);

  const handleSubmit = async () => {
    if (!selectedType) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Refresh GPS coords if needed
    let coords = currentCoords;
    if (!coords && Platform.OS !== "web") {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        coords = { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? 0 };
        setCurrentCoords(coords);
      } catch {}
    }

    const report: StoredReport = {
      id: Date.now().toString(),
      type: selectedType,
      description: description.trim(),
      licensePlate: licensePlate.trim().toUpperCase() || undefined,
      timestamp: Date.now(),
      confirmed: 0,
      latitude: coords?.lat,
      longitude: coords?.lng,
      accuracy: coords?.accuracy,
    };

    const updated = [report, ...reports].slice(0, 50);
    await saveReports(updated);

    setSuccessId(report.id);
    Animated.sequence([
      Animated.timing(successAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(successAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setSuccessId(null));

    setSelectedType(null);
    setDescription("");
    setLicensePlate("");
    expandAnim.setValue(0);
  };

  const handleConfirm = async (id: string) => {
    Haptics.selectionAsync();
    const updated = reports.map(r => r.id === id ? { ...r, confirmed: r.confirmed + 1 } : r);
    await saveReports(updated);
  };

  const descHeight = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, selectedIncident?.requiresPlate ? 220 : 140] });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 100 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Report</Text>
          <Text style={styles.subtitle}>Tap to report — GPS coordinates captured automatically</Text>
        </View>
        {/* GPS indicator */}
        <View style={[styles.gpsPill, gpsStatus === "acquired" && styles.gpsPillOn, gpsStatus === "failed" && styles.gpsPillFail]}>
          <Feather
            name={gpsStatus === "acquired" ? "crosshair" : gpsStatus === "acquiring" ? "loader" : "map-pin"}
            size={12}
            color={gpsStatus === "acquired" ? Colors.success : gpsStatus === "failed" ? Colors.warning : Colors.textMuted}
          />
          <Text style={[styles.gpsPillText, gpsStatus === "acquired" && { color: Colors.success }, gpsStatus === "failed" && { color: Colors.warning }]}>
            {gpsStatus === "acquired" ? "GPS Ready" : gpsStatus === "acquiring" ? "Locating…" : "No GPS"}
          </Text>
        </View>
      </View>

      {/* Success toast */}
      <Animated.View style={[styles.toast, {
        opacity: successAnim,
        transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
        pointerEvents: "none",
      }]}>
        <Feather name="check-circle" size={18} color={Colors.success} />
        <Text style={styles.toastText}>Report submitted with GPS coordinates</Text>
      </Animated.View>

      {/* Incident type grid */}
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
                <Feather name={type.icon as any} size={22} color={type.color} />
              </View>
              <Text style={[styles.typeLabel, isSelected && { color: type.color }]} numberOfLines={1}>
                {type.label}
              </Text>
              {type.requiresPlate && (
                <View style={styles.plateTag}>
                  <Text style={styles.plateTagText}>+ Plate</Text>
                </View>
              )}
              {isSelected && (
                <View style={[styles.selectedDot, { backgroundColor: type.color }]} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Expandable: licence plate + description + send */}
      <Animated.View style={[styles.expandBox, { height: descHeight, overflow: "hidden" }]}>
        {selectedType && (
          <View style={styles.expandInner}>
            {selectedIncident?.requiresPlate && (
              <View>
                <Text style={styles.fieldLabel}>Licence Plate (if visible)</Text>
                <TextInput
                  style={[styles.input, styles.plateInput]}
                  placeholder="e.g. UAK 123B"
                  placeholderTextColor={Colors.textMuted}
                  value={licensePlate}
                  onChangeText={v => setLicensePlate(v.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={10}
                />
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder="Add details (optional)…"
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

      {/* GPS accuracy note */}
      {currentCoords && (
        <View style={styles.coordNote}>
          <Feather name="crosshair" size={12} color={Colors.success} />
          <Text style={styles.coordText}>
            Locked: {coordLabel(currentCoords.lat, currentCoords.lng)} · ±{Math.round(currentCoords.accuracy)}m
          </Text>
        </View>
      )}

      {/* Recent reports */}
      {reports.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent · {reports.length}</Text>
          {reports.slice(0, 15).map(report => {
            const type = INCIDENT_TYPES.find(t => t.key === report.type);
            const hasGps = report.latitude && report.longitude;
            return (
              <View key={report.id} style={[styles.reportRow, report.id === successId && { borderColor: Colors.success + "55" }]}>
                <View style={[styles.reportIcon, { backgroundColor: (type?.color ?? Colors.warning) + "20" }]}>
                  <Feather name={(type?.icon ?? "alert-triangle") as any} size={18} color={type?.color ?? Colors.warning} />
                </View>
                <View style={styles.reportMeta}>
                  <View style={styles.reportTitleRow}>
                    <Text style={styles.reportType}>{type?.label ?? report.type}</Text>
                    {hasGps && (
                      <View style={styles.gpsMini}>
                        <Feather name="crosshair" size={9} color={Colors.success} />
                      </View>
                    )}
                  </View>
                  {report.licensePlate ? (
                    <View style={styles.plateBadge}>
                      <Feather name="credit-card" size={10} color={Colors.warning} />
                      <Text style={styles.plateBadgeText}>{report.licensePlate}</Text>
                    </View>
                  ) : null}
                  {report.description ? (
                    <Text style={styles.reportDesc} numberOfLines={1}>{report.description}</Text>
                  ) : null}
                  <Text style={styles.reportTime}>
                    {timeAgo(report.timestamp)}
                    {hasGps ? ` · ${coordLabel(report.latitude, report.longitude)}` : ""}
                  </Text>
                </View>
                <Pressable onPress={() => handleConfirm(report.id)} style={styles.confirmBtn} hitSlop={10}>
                  <Feather name="thumbs-up" size={14} color={report.confirmed > 0 ? Colors.accent : Colors.textMuted} />
                  {report.confirmed > 0 && <Text style={styles.confirmCount}>{report.confirmed}</Text>}
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
  scroll: { paddingHorizontal: 16, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 3, maxWidth: 220 },
  gpsPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.card,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
    marginTop: 6,
  },
  gpsPillOn: { borderColor: Colors.success + "55", backgroundColor: Colors.success + "12" },
  gpsPillFail: { borderColor: Colors.warning + "55", backgroundColor: Colors.warning + "12" },
  gpsPillText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted },
  toast: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: Colors.success + "20",
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16,
    borderWidth: 1, borderColor: Colors.success + "40",
  },
  toastText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.success, flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "31%",
    backgroundColor: Colors.card,
    borderRadius: 18, padding: 12,
    alignItems: "center", gap: 6,
    borderWidth: 1.5, borderColor: Colors.border,
    position: "relative",
  },
  typeIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  typeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.text, textAlign: "center" },
  plateTag: {
    backgroundColor: Colors.warning + "22",
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  plateTagText: { fontFamily: "Inter_600SemiBold", fontSize: 9, color: Colors.warning },
  selectedDot: { position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 4 },
  expandBox: { marginHorizontal: 0 },
  expandInner: { gap: 10, paddingTop: 4 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 14, padding: 14,
    color: Colors.text,
    fontFamily: "Inter_400Regular", fontSize: 14,
    borderWidth: 1, borderColor: Colors.border,
    minHeight: 56,
  },
  plateInput: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    letterSpacing: 3,
    textAlign: "center",
    minHeight: 52,
  },
  submitBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, borderRadius: 16,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.primary },
  coordNote: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.success + "12",
    borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12,
    borderWidth: 1, borderColor: Colors.success + "30",
    alignSelf: "flex-start",
  },
  coordText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.success },
  section: { gap: 10 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold", fontSize: 13,
    color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 1,
  },
  reportRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  reportIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  reportMeta: { flex: 1, gap: 3 },
  reportTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reportType: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.text },
  gpsMini: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.success + "22",
    alignItems: "center", justifyContent: "center",
  },
  plateBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    backgroundColor: Colors.warning + "18",
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.warning + "44",
  },
  plateBadgeText: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.warning, letterSpacing: 1 },
  reportDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  reportTime: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 6, marginTop: 2 },
  confirmCount: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.accent },
  empty: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyText: {
    fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textMuted,
    textAlign: "center", maxWidth: 260, lineHeight: 21,
  },
});
