import React, { useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useJourney } from "@/context/JourneyContext";
import { useAuth } from "@/context/AuthContext";
import SafetyScoreRing from "@/components/SafetyScoreRing";
import Colors from "@/constants/colors";

function getBadges(trips: number, score: number, overspeedCount: number) {
  return [
    { id: "first_trip", label: "First Trip", icon: "flag", color: Colors.accent, earned: trips >= 1 },
    { id: "safe_driver", label: "Safe Driver", icon: "shield", color: Colors.success, earned: score >= 70 && trips >= 5 },
    { id: "speed_ok", label: "Speed Compliant", icon: "activity", color: Colors.success, earned: overspeedCount === 0 && trips >= 3 },
    { id: "trusted", label: "Community Trusted", icon: "users", color: Colors.purple, earned: trips >= 20 && score >= 80 },
    { id: "100_trips", label: "100 Trips", icon: "award", color: Colors.info, earned: trips >= 100 },
    { id: "certified", label: "TQ Certified", icon: "check-circle", color: Colors.accent, earned: score >= 90 && trips >= 10 },
  ];
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const { safetyScore, riskLevel, totalTrips, totalDistance, pastJourneys, nextOfKin, addNextOfKin, removeNextOfKin } = useJourney();
  const { user, signOut } = useAuth();

  const [showKinForm, setShowKinForm] = useState(false);
  const [kinName, setKinName] = useState("");
  const [kinPhone, setKinPhone] = useState("");

  const totalOverspeed = pastJourneys.reduce((a, j) => a + j.overspeedEvents, 0);
  const totalHours = (pastJourneys.reduce((a, j) => a + ((j.endTime ?? 0) - j.startTime), 0) / 3600000).toFixed(1);
  const badges = getBadges(totalTrips, safetyScore, totalOverspeed);
  const earnedCount = badges.filter(b => b.earned).length;

  const riskColor =
    riskLevel === "excellent" ? Colors.success :
    riskLevel === "good" ? Colors.scoreGood :
    riskLevel === "moderate" ? Colors.warning : Colors.danger;

  const riskLabel =
    riskLevel === "excellent" ? "Excellent Driver" :
    riskLevel === "good" ? "Safe Driver" :
    riskLevel === "moderate" ? "Moderate Risk" : "High Risk";

  const handleAddKin = async () => {
    if (!kinName.trim() || !kinPhone.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await addNextOfKin({ name: kinName.trim(), phone: kinPhone.trim() });
    setKinName(""); setKinPhone(""); setShowKinForm(false);
  };

  const confirmSignOut = () => {
    Alert.alert("Sign Out", "Sign out of TraffIQ?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingTop: topInset + 12, paddingBottom: bottomInset + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero card: avatar + score in one card ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroLeft}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Feather name="user" size={28} color={Colors.accent} />
            </View>
          )}
          <View style={styles.heroInfo}>
            <Text style={styles.heroName} numberOfLines={1}>{user?.name ?? "TraffIQ User"}</Text>
            {user?.email ? (
              <Text style={styles.heroEmail} numberOfLines={1}>{user.email}</Text>
            ) : null}
            <View style={styles.accountBadge}>
              {user?.isGuest ? (
                <>
                  <Feather name="user" size={10} color={Colors.textMuted} />
                  <Text style={[styles.accountBadgeText, { color: Colors.textMuted }]}>Guest</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="google" size={10} color={Colors.info} />
                  <Text style={[styles.accountBadgeText, { color: Colors.info }]}>Google</Text>
                </>
              )}
            </View>
            <View style={[styles.riskChip, { borderColor: riskColor + "66" }]}>
              <View style={[styles.riskDot, { backgroundColor: riskColor }]} />
              <Text style={[styles.riskText, { color: riskColor }]}>{riskLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.heroRight}>
          <SafetyScoreRing score={safetyScore} size={110} showLabel />
          <Pressable onPress={confirmSignOut} style={styles.signOutBtn}>
            <Feather name="log-out" size={15} color={Colors.textSecondary} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Stats row ── */}
      <View style={styles.statsRow}>
        {[
          { value: totalTrips.toString(), label: "Trips", icon: "navigation", color: Colors.accent },
          { value: totalDistance.toFixed(0), label: "km", icon: "map-pin", color: Colors.info },
          { value: totalHours, label: "Hours", icon: "clock", color: Colors.success },
          { value: totalOverspeed.toString(), label: "Overspeed", icon: "zap", color: Colors.warning },
        ].map((s, i, arr) => (
          <React.Fragment key={s.label}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
            {i < arr.length - 1 && <View style={styles.statDivider} />}
          </React.Fragment>
        ))}
      </View>

      {/* ── Safety breakdown ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Safety Breakdown</Text>
        <View style={styles.card}>
          {[
            { label: "Speed Compliance", value: Math.max(0, 100 - totalOverspeed * 3) },
            { label: "Smooth Driving", value: 88 },
            { label: "Route Safety", value: 92 },
            { label: "Passenger Ratings", value: 95 },
          ].map(item => {
            const barColor = item.value >= 80 ? Colors.success : item.value >= 60 ? Colors.warning : Colors.danger;
            return (
              <View key={item.label} style={styles.breakdownRow}>
                <View style={styles.breakdownHeader}>
                  <Text style={styles.breakdownLabel}>{item.label}</Text>
                  <Text style={[styles.breakdownVal, { color: barColor }]}>{item.value}%</Text>
                </View>
                <View style={styles.progressBg}>
                  <View style={[styles.progressFill, { width: `${item.value}%` as any, backgroundColor: barColor }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Badges ── */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <Text style={styles.badgeCount}>{earnedCount}/{badges.length}</Text>
        </View>
        <View style={styles.badgeGrid}>
          {badges.map(b => (
            <View key={b.id} style={[styles.badgeCard, !b.earned && styles.badgeLocked]}>
              <View style={[styles.badgeIcon, { backgroundColor: b.earned ? b.color + "22" : Colors.border + "80" }]}>
                <Feather name={b.icon as any} size={22} color={b.earned ? b.color : Colors.textMuted} />
              </View>
              <Text style={[styles.badgeLabel, !b.earned && { color: Colors.textMuted }]}>{b.label}</Text>
              {!b.earned && <Feather name="lock" size={11} color={Colors.textMuted} style={styles.lockIcon} />}
            </View>
          ))}
        </View>
      </View>

      {/* ── Next of Kin ── */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Next of Kin</Text>
          <Pressable
            onPress={() => setShowKinForm(v => !v)}
            style={styles.addBtn}
          >
            <Feather name={showKinForm ? "x" : "plus"} size={14} color={Colors.accent} />
            <Text style={styles.addBtnText}>{showKinForm ? "Cancel" : "Add"}</Text>
          </Pressable>
        </View>

        {showKinForm && (
          <View style={styles.kinForm}>
            <TextInput
              style={styles.kinInput}
              placeholder="Name"
              placeholderTextColor={Colors.textMuted}
              value={kinName}
              onChangeText={setKinName}
            />
            <TextInput
              style={styles.kinInput}
              placeholder="Phone number"
              placeholderTextColor={Colors.textMuted}
              value={kinPhone}
              onChangeText={setKinPhone}
              keyboardType="phone-pad"
            />
            <Pressable
              onPress={handleAddKin}
              disabled={!kinName.trim() || !kinPhone.trim()}
              style={[styles.kinSaveBtn, (!kinName.trim() || !kinPhone.trim()) && { opacity: 0.5 }]}
            >
              <Text style={styles.kinSaveBtnText}>Save Contact</Text>
            </Pressable>
          </View>
        )}

        {nextOfKin.length === 0 && !showKinForm ? (
          <View style={styles.kinEmpty}>
            <Feather name="users" size={20} color={Colors.textMuted} />
            <Text style={styles.kinEmptyText}>Add contacts to share your live journey with them</Text>
          </View>
        ) : (
          nextOfKin.map(k => (
            <View key={k.id} style={styles.kinRow}>
              <View style={styles.kinAvatar}>
                <Text style={styles.kinAvatarText}>{k.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.kinInfo}>
                <Text style={styles.kinName}>{k.name}</Text>
                <Text style={styles.kinPhone}>{k.phone}</Text>
              </View>
              <Pressable
                onPress={() => Alert.alert("Remove", `Remove ${k.name}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => removeNextOfKin(k.id) },
                ])}
                hitSlop={10}
                style={styles.kinRemove}
              >
                <Feather name="trash-2" size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* ── Leaderboard teaser ── */}
      <Pressable style={styles.leaderCard}>
        <View style={[styles.leaderIcon, { backgroundColor: Colors.accent + "20" }]}>
          <MaterialCommunityIcons name="trophy" size={22} color={Colors.accent} />
        </View>
        <View style={styles.leaderInfo}>
          <Text style={styles.leaderTitle}>Safe Driver Leaderboard</Text>
          <Text style={styles.leaderSub}>Top 15% in your region this month</Text>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.accent} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  scroll: { paddingHorizontal: 16, gap: 20 },

  // Hero
  heroCard: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  heroLeft: { flexDirection: "row", alignItems: "flex-start", gap: 14, flex: 1 },
  avatar: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: Colors.accent + "44" },
  avatarPlaceholder: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.accent + "22",
    borderWidth: 2, borderColor: Colors.accent + "44",
    alignItems: "center", justifyContent: "center",
  },
  heroInfo: { flex: 1, gap: 5 },
  heroName: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.text },
  heroEmail: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  accountBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.border,
  },
  accountBadgeText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  riskChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start",
    borderRadius: 20, borderWidth: 1.5,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  riskDot: { width: 6, height: 6, borderRadius: 3 },
  riskText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  heroRight: { alignItems: "center", gap: 8 },
  signOutBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
  },
  signOutText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },

  // Stats row
  statsRow: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    flexDirection: "row",
    paddingVertical: 18,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 22 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 6 },

  // Section
  section: { gap: 12 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold", fontSize: 13,
    color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 1,
  },
  badgeCount: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.accent },
  card: { backgroundColor: Colors.card, borderRadius: 20, padding: 16, gap: 16, borderWidth: 1, borderColor: Colors.border },

  // Safety breakdown
  breakdownRow: { gap: 6 },
  breakdownHeader: { flexDirection: "row", justifyContent: "space-between" },
  breakdownLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.text },
  breakdownVal: { fontFamily: "Inter_700Bold", fontSize: 13 },
  progressBg: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  // Badges
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badgeCard: {
    width: "31%",
    backgroundColor: Colors.card,
    borderRadius: 18, padding: 14,
    alignItems: "center", gap: 7,
    borderWidth: 1, borderColor: Colors.border,
    position: "relative",
  },
  badgeLocked: { opacity: 0.45 },
  badgeIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  badgeLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.text, textAlign: "center" },
  lockIcon: { position: "absolute", top: 8, right: 8 },

  // Next of kin
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.accent + "18",
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.accent + "44",
  },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.accent },
  kinForm: { backgroundColor: Colors.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: Colors.border },
  kinInput: {
    backgroundColor: Colors.primary,
    borderRadius: 12, padding: 12,
    color: Colors.text,
    fontFamily: "Inter_400Regular", fontSize: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  kinSaveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 12, paddingVertical: 12,
    alignItems: "center",
  },
  kinSaveBtnText: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.primary },
  kinEmpty: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  kinEmptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, flex: 1, lineHeight: 19 },
  kinRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  kinAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.accent + "22",
    alignItems: "center", justifyContent: "center",
  },
  kinAvatarText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.accent },
  kinInfo: { flex: 1 },
  kinName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.text },
  kinPhone: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  kinRemove: { padding: 6 },

  // Leaderboard
  leaderCard: {
    backgroundColor: Colors.card,
    borderRadius: 20, padding: 16,
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 1.5, borderColor: Colors.accent + "40",
  },
  leaderIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  leaderInfo: { flex: 1, gap: 3 },
  leaderTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.text },
  leaderSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
});
