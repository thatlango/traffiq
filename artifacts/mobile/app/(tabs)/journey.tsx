import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useJourney, TransportMode } from "@/context/JourneyContext";
import SpeedMeter from "@/components/SpeedMeter";
import AlertBanner from "@/components/AlertBanner";
import Colors from "@/constants/colors";

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

const MODES: { key: TransportMode; mciIcon: string; label: string; limit: number; color: string }[] = [
  { key: "car",     mciIcon: "car",              label: "Car",     limit: 50, color: Colors.info },
  { key: "taxi",    mciIcon: "taxi",             label: "Taxi",    limit: 50, color: Colors.accent },
  { key: "bus",     mciIcon: "bus",              label: "Bus",     limit: 60, color: Colors.success },
  { key: "boda",    mciIcon: "motorbike",        label: "Boda",    limit: 45, color: Colors.warning },
  { key: "bicycle", mciIcon: "bicycle",          label: "Bicycle", limit: 30, color: Colors.purple ?? "#A78BFA" },
  { key: "walking", mciIcon: "walk",             label: "Walk",    limit: 10, color: Colors.textSecondary },
];

const MODE_MCI_ICON: Record<TransportMode, string> = {
  car: "car",
  taxi: "taxi",
  bus: "bus",
  boda: "motorbike",
  bicycle: "bicycle",
  walking: "walk",
};

export default function JourneyScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const {
    isTracking,
    currentSpeed,
    speedLimit,
    isOverspeed,
    selectedMode,
    setSelectedMode,
    startJourney,
    stopJourney,
    currentJourney,
    alerts,
    dismissAlert,
    emergencyMode,
    toggleEmergency,
    pastJourneys,
    currentRoadName,
    nextOfKin,
    sharingJourney,
    shareJourneyWithKin,
  } = useJourney();

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loading, setLoading] = useState(false);
  const btnScale = useRef(new Animated.Value(1)).current;
  const roadAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isTracking && currentJourney) {
      timerRef.current = setInterval(() => setElapsed(Date.now() - currentJourney.startTime), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTracking, currentJourney]);

  useEffect(() => {
    Animated.spring(roadAnim, {
      toValue: currentRoadName ? 1 : 0,
      tension: 80, friction: 10, useNativeDriver: true,
    }).start();
  }, [currentRoadName]);

  const handleStartStop = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setLoading(true);
    try {
      if (isTracking) await stopJourney();
      else await startJourney(selectedMode);
    } finally {
      setLoading(false);
    }
  };

  const overspeedAmt = Math.max(0, currentSpeed - speedLimit);
  const journeyDistance = currentJourney
    ? (currentJourney.route.length * 0.01).toFixed(2)
    : "0.00";

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 130 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Alert */}
        {alerts.slice(0, 1).map(a => (
          <AlertBanner key={a.id} alert={a} onDismiss={() => dismissAlert(a.id)} />
        ))}

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{isTracking ? "Journey Active" : "Start Journey"}</Text>
            <Text style={styles.subtitle}>
              {isTracking ? formatDuration(elapsed) : "Choose your mode and go"}
            </Text>
          </View>

          {isTracking && (
            <View style={styles.actions}>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); shareJourneyWithKin(); }}
                style={[styles.actionBtn, sharingJourney && styles.actionBtnOn]}
              >
                <Feather name="share-2" size={18} color={sharingJourney ? Colors.success : Colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); toggleEmergency(); }}
                style={[styles.actionBtn, styles.actionBtnRed, emergencyMode && styles.actionBtnRedOn]}
              >
                <Feather name="radio" size={18} color={emergencyMode ? "#fff" : Colors.danger} />
              </Pressable>
            </View>
          )}
        </View>

        {/* Road name strip */}
        {isTracking && currentRoadName && (
          <Animated.View style={[styles.roadStrip, {
            opacity: roadAnim,
            transform: [{ translateY: roadAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
          }]}>
            <View style={styles.roadLeft}>
              <View style={styles.roadDot} />
              <View>
                <Text style={styles.roadCaption}>Currently on</Text>
                <Text style={styles.roadName}>{currentRoadName}</Text>
              </View>
            </View>
            {sharingJourney && (
              <View style={styles.sharingPill}>
                <View style={styles.sharingDot} />
                <Text style={styles.sharingText}>Sharing{nextOfKin.length > 0 ? ` · ${nextOfKin.length}` : ""}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Transport mode selector — only when not tracking */}
        {!isTracking && (
          <View style={styles.modeSection}>
            <Text style={styles.modeSectionLabel}>Transport Mode</Text>
            <View style={styles.modeGrid}>
              {MODES.map(m => {
                const isSelected = selectedMode === m.key;
                const iconColor = isSelected ? Colors.primary : m.color;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => { Haptics.selectionAsync(); setSelectedMode(m.key); }}
                    style={({ pressed }) => [
                      styles.modeCard,
                      isSelected && [styles.modeCardSelected, { backgroundColor: m.color }],
                      pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
                    ]}
                  >
                    <View style={[
                      styles.modeIconWrap,
                      { backgroundColor: isSelected ? "rgba(255,255,255,0.18)" : m.color + "1A" },
                    ]}>
                      <MaterialCommunityIcons
                        name={m.mciIcon as any}
                        size={26}
                        color={iconColor}
                      />
                    </View>
                    <Text style={[styles.modeLabel, isSelected && styles.modeLabelSelected]}>{m.label}</Text>
                    <Text style={[styles.modeLimit, isSelected && { color: Colors.primary + "cc" }]}>
                      {m.limit} km/h
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Speed meter */}
        <View style={styles.speedSection}>
          <SpeedMeter speed={currentSpeed} limit={speedLimit} size={200} />
          {isOverspeed && (
            <View style={styles.overspeedBadge}>
              <Feather name="alert-octagon" size={14} color={Colors.danger} />
              <Text style={styles.overspeedText}>+{Math.round(overspeedAmt)} km/h over limit</Text>
            </View>
          )}
        </View>

        {/* Live stats while tracking */}
        {isTracking && currentJourney && (
          <View style={styles.statsRow}>
            {[
              { icon: "zap", value: `${Math.round(currentJourney.maxSpeed)}`, label: "Max km/h", color: Colors.accent },
              { icon: "trending-up", value: `${Math.round(currentJourney.avgSpeed)}`, label: "Avg km/h", color: Colors.success },
              { icon: "alert-triangle", value: `${currentJourney.overspeedEvents}`, label: "Overspeed", color: Colors.danger },
              { icon: "map-pin", value: journeyDistance, label: "Distance km", color: Colors.info },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <View style={styles.statItem}>
                  <Feather name={s.icon as any} size={15} color={s.color} />
                  <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={styles.statDivider} />}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Past journeys */}
        {!isTracking && pastJourneys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Journeys</Text>
            {pastJourneys.slice(0, 5).map(j => {
              const dur = j.endTime ? j.endTime - j.startTime : 0;
              const scoreColor =
                j.safetyScore >= 90 ? Colors.success :
                j.safetyScore >= 70 ? Colors.scoreGood :
                j.safetyScore >= 50 ? Colors.warning : Colors.danger;
              return (
                <View key={j.id} style={styles.journeyCard}>
                  <View style={styles.journeyModeIcon}>
                    <MaterialCommunityIcons
                      name={MODE_MCI_ICON[j.mode as TransportMode] as any}
                      size={22}
                      color={MODES.find(m => m.key === j.mode)?.color ?? Colors.accent}
                    />
                  </View>
                  <View style={styles.journeyMeta}>
                    <Text style={styles.journeyDate}>
                      {new Date(j.startTime).toLocaleDateString()} · {formatDuration(dur)}
                    </Text>
                    <Text style={styles.journeyStats}>
                      Max {Math.round(j.maxSpeed)} km/h · {j.overspeedEvents} overspeed
                    </Text>
                  </View>
                  <View style={[styles.scoreBadge, { backgroundColor: scoreColor + "20", borderColor: scoreColor }]}>
                    <Text style={[styles.scoreText, { color: scoreColor }]}>{j.safetyScore}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Start / Stop FAB */}
      <View style={[styles.fab, { bottom: bottomInset + 88 }]}>
        <Animated.View style={{ transform: [{ scale: btnScale }] }}>
          <Pressable
            onPress={handleStartStop}
            disabled={loading}
            style={[styles.startBtn, isTracking && styles.stopBtn, loading && { opacity: 0.7 }]}
          >
            <Feather
              name={isTracking ? "square" : "play"}
              size={26}
              color={isTracking ? Colors.danger : Colors.primary}
            />
            <Text style={[styles.startBtnText, isTracking && { color: Colors.danger }]}>
              {loading ? "…" : isTracking ? "Stop Journey" : "Start Journey"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 16, gap: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: 10 },
  actionBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: "center", justifyContent: "center",
  },
  actionBtnOn: { borderColor: Colors.success + "88", backgroundColor: Colors.success + "18" },
  actionBtnRed: { borderColor: Colors.danger },
  actionBtnRedOn: { backgroundColor: Colors.danger, borderColor: Colors.danger },

  // Road strip
  roadStrip: {
    backgroundColor: Colors.card,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: Colors.accent + "33",
  },
  roadLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  roadDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent, shadowRadius: 6, shadowOpacity: 0.6,
  },
  roadCaption: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  roadName: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.text, marginTop: 1 },
  sharingPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.success + "18",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.success + "44",
  },
  sharingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  sharingText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.success },

  // Mode selector
  modeSection: { gap: 12 },
  modeSectionLabel: {
    fontFamily: "Inter_600SemiBold", fontSize: 13,
    color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 1,
  },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  modeCard: {
    width: "31%",
    backgroundColor: Colors.card,
    borderRadius: 18, padding: 14,
    alignItems: "center", gap: 6,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  modeCardSelected: {
    borderColor: "transparent",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 5,
  },
  modeIconWrap: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center",
    marginBottom: 2,
  },
  modeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.text },
  modeLabelSelected: { color: Colors.primary },
  modeLimit: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },

  // Speed
  speedSection: { alignItems: "center", gap: 14 },
  overspeedBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.danger + "20",
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.danger + "44",
  },
  overspeedText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.danger },

  // Stats row
  statsRow: {
    backgroundColor: Colors.card,
    borderRadius: 20, flexDirection: "row",
    paddingVertical: 16, paddingHorizontal: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statVal: { fontFamily: "Inter_700Bold", fontSize: 20 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 6 },

  // Past journeys
  section: { gap: 10 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold", fontSize: 13,
    color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 1,
  },
  journeyCard: {
    backgroundColor: Colors.card,
    borderRadius: 16, padding: 14,
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  journeyModeIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.primary,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  journeyMeta: { flex: 1, gap: 2 },
  journeyDate: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.text },
  journeyStats: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  scoreBadge: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1.5, alignItems: "center",
  },
  scoreText: { fontFamily: "Inter_700Bold", fontSize: 16 },

  // FAB
  fab: { position: "absolute", left: 20, right: 20, alignItems: "center" },
  startBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 18, paddingHorizontal: 48,
    borderRadius: 30,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  stopBtn: { backgroundColor: Colors.danger + "20", borderWidth: 2, borderColor: Colors.danger, shadowOpacity: 0 },
  startBtnText: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.primary },
});
