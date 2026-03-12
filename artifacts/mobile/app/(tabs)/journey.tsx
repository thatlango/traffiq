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
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useJourney, TransportMode } from "@/context/JourneyContext";
import SpeedMeter from "@/components/SpeedMeter";
import ModeSelector from "@/components/ModeSelector";
import AlertBanner from "@/components/AlertBanner";
import Colors from "@/constants/colors";

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

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
  const startBtnScale = useRef(new Animated.Value(1)).current;
  const [loading, setLoading] = useState(false);
  const roadAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isTracking && currentJourney) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - currentJourney.startTime);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTracking, currentJourney]);

  // Animate road name strip in when it appears
  useEffect(() => {
    if (currentRoadName) {
      Animated.spring(roadAnim, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }).start();
    } else {
      roadAnim.setValue(0);
    }
  }, [currentRoadName]);

  const handleStartStop = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.sequence([
      Animated.timing(startBtnScale, { toValue: 0.92, duration: 100, useNativeDriver: true }),
      Animated.timing(startBtnScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setLoading(true);
    try {
      if (isTracking) {
        await stopJourney();
      } else {
        await startJourney(selectedMode);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await shareJourneyWithKin();
  };

  const overspeedAmt = Math.max(0, currentSpeed - speedLimit);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Alerts */}
        {alerts.slice(0, 1).map(a => (
          <AlertBanner key={a.id} alert={a} onDismiss={() => dismissAlert(a.id)} />
        ))}

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{isTracking ? "Journey Active" : "Start Journey"}</Text>
            <Text style={styles.subtitle}>
              {isTracking ? formatDuration(elapsed) : "Select mode and begin tracking"}
            </Text>
          </View>

          {isTracking && (
            <View style={styles.headerActions}>
              {/* Share button */}
              <Pressable
                onPress={handleShare}
                style={[styles.actionBtn, sharingJourney && styles.actionBtnActive]}
              >
                <Feather
                  name="share-2"
                  size={18}
                  color={sharingJourney ? Colors.success : Colors.textSecondary}
                />
              </Pressable>

              {/* Emergency button */}
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  toggleEmergency();
                }}
                style={[styles.actionBtn, styles.emergencyBtn, emergencyMode && styles.emergencyBtnActive]}
              >
                <Feather name="radio" size={18} color={emergencyMode ? "#fff" : Colors.danger} />
              </Pressable>
            </View>
          )}
        </View>

        {/* Live road name strip */}
        {isTracking && currentRoadName && (
          <Animated.View
            style={[
              styles.roadStrip,
              {
                opacity: roadAnim,
                transform: [{ translateY: roadAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
              },
            ]}
          >
            <View style={styles.roadStripLeft}>
              <View style={styles.roadIconCircle}>
                <Feather name="map-pin" size={13} color={Colors.accent} />
              </View>
              <View>
                <Text style={styles.roadLabel}>Currently on</Text>
                <Text style={styles.roadName}>{currentRoadName}</Text>
              </View>
            </View>
            {sharingJourney && (
              <View style={styles.sharingBadge}>
                <View style={styles.sharingDot} />
                <Text style={styles.sharingText}>
                  Sharing{nextOfKin.length > 0 ? ` · ${nextOfKin.length}` : ""}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Sharing indicator when no road name yet */}
        {isTracking && !currentRoadName && sharingJourney && (
          <View style={[styles.roadStrip, { justifyContent: "center" }]}>
            <View style={styles.sharingBadge}>
              <View style={styles.sharingDot} />
              <Text style={styles.sharingText}>
                Journey being shared{nextOfKin.length > 0 ? ` with ${nextOfKin.length} contact${nextOfKin.length > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
          </View>
        )}

        {/* Mode selector */}
        {!isTracking && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Transport Mode</Text>
            <ModeSelector selected={selectedMode} onSelect={setSelectedMode} />
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
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Feather name="zap" size={18} color={Colors.accent} />
              <Text style={styles.statValue}>{Math.round(currentJourney.maxSpeed)}</Text>
              <Text style={styles.statLabel}>Max km/h</Text>
            </View>
            <View style={styles.statCard}>
              <Feather name="trending-up" size={18} color={Colors.success} />
              <Text style={styles.statValue}>{Math.round(currentJourney.avgSpeed)}</Text>
              <Text style={styles.statLabel}>Avg km/h</Text>
            </View>
            <View style={styles.statCard}>
              <Feather name="alert-triangle" size={18} color={Colors.danger} />
              <Text style={styles.statValue}>{currentJourney.overspeedEvents}</Text>
              <Text style={styles.statLabel}>Overspeed</Text>
            </View>
            <View style={styles.statCard}>
              <Feather name="map-pin" size={18} color={Colors.info} />
              <Text style={styles.statValue}>{currentJourney.route.length}</Text>
              <Text style={styles.statLabel}>GPS Points</Text>
            </View>
          </View>
        )}

        {/* Next of kin hint when no kin and not sharing */}
        {isTracking && nextOfKin.length === 0 && (
          <View style={styles.kinHint}>
            <Feather name="users" size={16} color={Colors.textMuted} />
            <Text style={styles.kinHintText}>
              Add next of kin in Profile to share your journey with them
            </Text>
          </View>
        )}

        {/* Recent journeys */}
        {!isTracking && pastJourneys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Journeys</Text>
            {pastJourneys.slice(0, 5).map((j) => {
              const dur = j.endTime ? j.endTime - j.startTime : 0;
              const scoreColor =
                j.safetyScore >= 90 ? Colors.success
                : j.safetyScore >= 70 ? Colors.scoreGood
                : j.safetyScore >= 50 ? Colors.warning
                : Colors.danger;
              return (
                <View key={j.id} style={styles.journeyCard}>
                  <View style={styles.journeyLeft}>
                    <View style={[styles.modeBadge, { backgroundColor: Colors.accent + "22" }]}>
                      <Text style={styles.modeText}>{j.mode.toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text style={styles.journeyDate}>
                        {new Date(j.startTime).toLocaleDateString()} · {formatDuration(dur)}
                      </Text>
                      <Text style={styles.journeyStats}>
                        Max {Math.round(j.maxSpeed)} km/h · {j.overspeedEvents} overspeed events
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.scoreBadge, { backgroundColor: scoreColor + "22", borderColor: scoreColor }]}>
                    <Text style={[styles.scoreText, { color: scoreColor }]}>{j.safetyScore}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Start/Stop button */}
      <View style={[styles.fab, { bottom: bottomInset + 90 }]}>
        <Animated.View style={{ transform: [{ scale: startBtnScale }] }}>
          <Pressable
            onPress={handleStartStop}
            disabled={loading}
            style={[styles.startBtn, isTracking && styles.stopBtn, loading && { opacity: 0.7 }]}
          >
            <Feather
              name={isTracking ? "square" : "play"}
              size={28}
              color={isTracking ? Colors.danger : Colors.primary}
            />
            <Text style={[styles.startBtnText, isTracking && { color: Colors.danger }]}>
              {loading ? "..." : isTracking ? "Stop Journey" : "Start Journey"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 20, gap: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnActive: {
    borderColor: Colors.success + "88",
    backgroundColor: Colors.success + "18",
  },
  emergencyBtn: { borderColor: Colors.danger },
  emergencyBtnActive: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  roadStrip: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  roadStripLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  roadIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accent + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  roadLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  roadName: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.text, marginTop: 1 },
  sharingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.success + "18",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.success + "44",
  },
  sharingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  sharingText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.success },
  section: { gap: 14 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  speedSection: { alignItems: "center", gap: 16 },
  overspeedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.danger + "22",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.danger + "44",
  },
  overspeedText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.danger },
  statsGrid: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.text },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  kinHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  kinHintText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },
  journeyCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  journeyLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  modeText: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.accent, letterSpacing: 0.5 },
  journeyDate: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.text },
  journeyStats: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  scoreBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
  scoreText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  fab: { position: "absolute", left: 20, right: 20, alignItems: "center" },
  startBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 30,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  stopBtn: { backgroundColor: Colors.danger + "22", borderWidth: 2, borderColor: Colors.danger },
  startBtnText: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.primary },
});
