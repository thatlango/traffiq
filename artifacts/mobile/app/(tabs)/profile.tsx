import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useJourney } from "@/context/JourneyContext";
import SafetyScoreRing from "@/components/SafetyScoreRing";
import Colors from "@/constants/colors";

interface Badge {
  id: string;
  label: string;
  icon: string;
  color: string;
  earned: boolean;
  description: string;
}

function getBadges(trips: number, score: number, overspeedCount: number): Badge[] {
  return [
    { id: "first_trip", label: "First Trip", icon: "flag", color: Colors.accent, earned: trips >= 1, description: "Complete your first journey" },
    { id: "safe_driver", label: "Safe Driver", icon: "shield", color: Colors.success, earned: score >= 70 && trips >= 5, description: "Maintain 70+ score over 5 trips" },
    { id: "100_trips", label: "100 Trips", icon: "award", color: Colors.info, earned: trips >= 100, description: "Complete 100 journeys" },
    { id: "no_overspeed", label: "Speed Compliant", icon: "activity", color: Colors.success, earned: overspeedCount === 0 && trips >= 3, description: "Zero overspeed events in 3 trips" },
    { id: "trusted", label: "Community Trusted", icon: "users", color: Colors.purple, earned: trips >= 20 && score >= 80, description: "20 trips with 80+ safety score" },
    { id: "certified", label: "RW Certified", icon: "check-circle", color: Colors.accent, earned: score >= 90 && trips >= 10, description: "Top tier safety champion" },
  ];
}

const STAT_ITEMS = [
  { icon: "navigation", label: "Total Trips", key: "trips" as const, color: Colors.accent },
  { icon: "map-pin", label: "Distance (km)", key: "distance" as const, color: Colors.info },
  { icon: "clock", label: "Hours Tracked", key: "hours" as const, color: Colors.success },
  { icon: "alert-triangle", label: "Overspeed Events", key: "overspeed" as const, color: Colors.warning },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const { safetyScore, riskLevel, totalTrips, totalDistance, pastJourneys } = useJourney();

  const totalOverspeedEvents = pastJourneys.reduce((acc, j) => acc + j.overspeedEvents, 0);
  const totalDurationMs = pastJourneys.reduce((acc, j) => acc + ((j.endTime ?? 0) - j.startTime), 0);
  const totalHours = (totalDurationMs / 3600000).toFixed(1);

  const badges = getBadges(totalTrips, safetyScore, totalOverspeedEvents);
  const earnedBadges = badges.filter(b => b.earned);

  const getRiskColor = () => {
    switch (riskLevel) {
      case "excellent": return Colors.success;
      case "good": return Colors.scoreGood;
      case "moderate": return Colors.warning;
      case "high": return Colors.danger;
    }
  };

  const stats: Record<string, string | number> = {
    trips: totalTrips,
    distance: totalDistance.toFixed(1),
    hours: totalHours,
    overspeed: totalOverspeedEvents,
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile header */}
      <View style={styles.profileCard}>
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Feather name="user" size={32} color={Colors.accent} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Road Watcher</Text>
            <View style={[styles.riskBadge, { borderColor: getRiskColor() }]}>
              <View style={[styles.riskDot, { backgroundColor: getRiskColor() }]} />
              <Text style={[styles.riskText, { color: getRiskColor() }]}>
                {riskLevel === "excellent" ? "Excellent Driver" : riskLevel === "good" ? "Safe Driver" : riskLevel === "moderate" ? "Moderate Risk" : "High Risk"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.scoreSection}>
          <SafetyScoreRing score={safetyScore} size={130} showLabel />
          <Text style={styles.scoreCaption}>Safety Score</Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Statistics</Text>
        <View style={styles.statsGrid}>
          {STAT_ITEMS.map(item => (
            <View key={item.key} style={styles.statCard}>
              <Feather name={item.icon as any} size={20} color={item.color} />
              <Text style={styles.statValue}>{stats[item.key]}</Text>
              <Text style={styles.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Safety breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety Breakdown</Text>
        {[
          { label: "Speed Compliance", value: Math.max(0, 100 - totalOverspeedEvents * 3), icon: "activity" },
          { label: "Smooth Driving", value: 88, icon: "trending-up" },
          { label: "Route Safety", value: 92, icon: "map" },
          { label: "Passenger Ratings", value: 95, icon: "star" },
        ].map(item => (
          <View key={item.label} style={styles.breakdownRow}>
            <Feather name={item.icon as any} size={16} color={Colors.textSecondary} style={{ marginTop: 2 }} />
            <View style={styles.breakdownInfo}>
              <View style={styles.breakdownHeader}>
                <Text style={styles.breakdownLabel}>{item.label}</Text>
                <Text style={styles.breakdownValue}>{item.value}%</Text>
              </View>
              <View style={styles.progressBg}>
                <View
                  style={[styles.progressFill, {
                    width: `${item.value}%` as any,
                    backgroundColor: item.value >= 80 ? Colors.success : item.value >= 60 ? Colors.warning : Colors.danger,
                  }]}
                />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Badges */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <Text style={styles.badgeCount}>{earnedBadges.length}/{badges.length} Earned</Text>
        </View>
        <View style={styles.badgeGrid}>
          {badges.map(badge => (
            <View key={badge.id} style={[styles.badgeCard, !badge.earned && styles.badgeCardLocked]}>
              <View style={[styles.badgeIcon, { backgroundColor: badge.earned ? badge.color + "22" : Colors.border }]}>
                <Feather name={badge.icon as any} size={24} color={badge.earned ? badge.color : Colors.textMuted} />
              </View>
              <Text style={[styles.badgeLabel, !badge.earned && styles.badgeLabelLocked]}>{badge.label}</Text>
              <Text style={styles.badgeDesc} numberOfLines={2}>{badge.description}</Text>
              {!badge.earned && (
                <View style={styles.lockedOverlay}>
                  <Feather name="lock" size={14} color={Colors.textMuted} />
                </View>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Leaderboard teaser */}
      <View style={[styles.leaderCard, { borderColor: Colors.accent + "44" }]}>
        <View style={styles.leaderRow}>
          <View style={[styles.leaderIcon, { backgroundColor: Colors.accent + "22" }]}>
            <MaterialCommunityIcons name="trophy" size={24} color={Colors.accent} />
          </View>
          <View style={styles.leaderInfo}>
            <Text style={styles.leaderTitle}>Safe Driver Leaderboard</Text>
            <Text style={styles.leaderSub}>Top 15% in your region this month</Text>
          </View>
          <Feather name="chevron-right" size={20} color={Colors.accent} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 20, gap: 28 },
  profileCard: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatarSection: { gap: 12, flex: 1 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.accent + "22",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.accent + "44",
  },
  profileInfo: { gap: 8 },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.text },
  riskBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
    alignSelf: "flex-start",
  },
  riskDot: { width: 6, height: 6, borderRadius: 3 },
  riskText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  scoreSection: { alignItems: "center", gap: 6 },
  scoreCaption: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  section: { gap: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  badgeCount: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.accent },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.text },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, textAlign: "center" },
  breakdownRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  breakdownInfo: { flex: 1, gap: 6 },
  breakdownHeader: { flexDirection: "row", justifyContent: "space-between" },
  breakdownLabel: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.text },
  breakdownValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.text },
  progressBg: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  badgeCard: {
    width: "30%",
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    position: "relative",
    overflow: "hidden",
  },
  badgeCardLocked: { opacity: 0.5 },
  badgeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  badgeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.text, textAlign: "center" },
  badgeLabelLocked: { color: Colors.textMuted },
  badgeDesc: { fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted, textAlign: "center", lineHeight: 13 },
  lockedOverlay: { position: "absolute", top: 8, right: 8 },
  leaderCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
  },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  leaderIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  leaderInfo: { flex: 1, gap: 4 },
  leaderTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.text },
  leaderSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
});
